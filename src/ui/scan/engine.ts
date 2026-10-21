// Scanner plumbing on the main thread: decode photos, find the document, render pages in a worker.
import { detectKernels, luminance } from './detect';
import { orientKernels, type Orientation } from './orient';
import { aspectOf, dist, FORMATS, fullQuad, snapRatio, type Quad } from './geom';
import { scanKernels, type Filter, type JobResult, type Kernels } from './kernels';

export type ScanMode = 'doc' | 'id' | 'passport' | 'receipt';
export type Quality = 'small' | 'standard' | 'high';

export interface ScanPage {
  id: string;
  blob: Blob;
  /** decoded size (EXIF orientation applied) */
  w: number; h: number;
  quad: Quad;
  auto: Quad | null;
  /** the outline was found clearly; otherwise the page is flagged for a look */
  sure: boolean;
  /** extra quarter turns, clockwise */
  rot: number;
  filter: Filter;
  kind: ScanMode;
  side?: 'front' | 'back';
  /** detected sheet / card format (a4, letter, id1 …) and width / height of the unrotated crop */
  format: string | null;
  ratio: number;
  /** bumps on every change, so stale renders are dropped */
  ver: number;
}

export const DEFAULT_FILTER: Record<ScanMode, Filter> = { doc: 'auto', id: 'color', passport: 'color', receipt: 'auto' };
export const MODE_RATIOS: Record<ScanMode, number[] | undefined> = {
  doc: undefined, id: [FORMATS.id1.ratio], passport: [FORMATS.id3.ratio], receipt: undefined,
};
export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- decoding
const decoded = new Map<Blob, Promise<ImageBitmap | HTMLCanvasElement>>();

/** Photo → bitmap with its EXIF orientation applied. HEIC goes through a converter first. */
export function decode(blob: Blob): Promise<ImageBitmap | HTMLCanvasElement> {
  let p = decoded.get(blob);
  if (!p) {
    p = (async () => {
      let b = blob;
      if (/heic|heif/i.test(b.type) || /\.(heic|heif)$/i.test((b as File).name ?? '')) {
        const heic2any = (await import('heic2any')).default as any;
        const r = await heic2any({ blob: b, toType: 'image/jpeg', quality: 0.95 });
        b = Array.isArray(r) ? r[0] : r;
      }
      if (typeof createImageBitmap === 'function') {
        try { return await createImageBitmap(b, { imageOrientation: 'from-image' } as any); } catch { /* fall back */ }
      }
      const url = URL.createObjectURL(b);
      try {
        const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not a readable image')); i.src = url; });
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d')!.drawImage(im, 0, 0);
        return c;
      } finally { URL.revokeObjectURL(url); }
    })();
    decoded.set(blob, p);
    p.catch(() => decoded.delete(blob));
    // keep only a few decoded photos around (they are large)
    if (decoded.size > 4) {
      const first = decoded.keys().next().value as Blob;
      const old = decoded.get(first);
      decoded.delete(first);
      old?.then((b) => { if ('close' in b) b.close(); }).catch(() => null);
    }
  }
  return p;
}
export const forget = (blob: Blob) => { const p = decoded.get(blob); decoded.delete(blob); p?.then((b) => { if ('close' in b) b.close(); }).catch(() => null); };

const sizeOf = (b: ImageBitmap | HTMLCanvasElement | HTMLVideoElement) =>
  b instanceof HTMLVideoElement ? { w: b.videoWidth, h: b.videoHeight } : { w: b.width, h: b.height };

/** pixels of (a region of) an image, scaled down so the longest side is at most `max` */
export function pixelsOf(src: CanvasImageSource, max: number, region?: { x: number; y: number; w: number; h: number }): { w: number; h: number; data: Uint8ClampedArray; scale: number } {
  const full = sizeOf(src as any);
  const r = region ?? { x: 0, y: 0, w: full.w, h: full.h };
  const scale = Math.min(1, max / Math.max(r.w, r.h));
  const W = Math.max(1, Math.round(r.w * scale)), H = Math.max(1, Math.round(r.h * scale));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  c.width = c.height = 0;
  return { w: W, h: H, data, scale };
}

// ---------------------------------------------------------------- workers
// A small pool of workers does all pixel work (finding the page, cropping, cleaning, orientation),
// so the screen never freezes and two pages are processed at the same time. Photos are handed over
// as ImageBitmaps (resized off the main thread) when the browser can read them in a worker.

type Img = { w: number; h: number; data: Uint8ClampedArray };
type Src = { bmp: ImageBitmap } | { img: Img };
interface Task { msg: any; transfer: Transferable[]; ok: (r: any) => void; fail: (e: any) => void; low: boolean }

const workers: { w: Worker; busy: Task | null }[] = [];
let poolBroken = false;
const queue: Task[] = [];
let seq = 0;
let local: { K: Kernels; D: ReturnType<typeof detectKernels>; O: ReturnType<typeof orientKernels> } | null = null;
const canBitmap = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';

function workerCode() {
  return `var K=(${scanKernels.toString()})(),D=(${detectKernels.toString()})(),O=(${orientKernels.toString()})();
function px(s){if(s.img)return s.img;var b=s.bmp,c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d',{willReadFrequently:true});x.drawImage(b,0,0);b.close();return{w:c.width,h:c.height,data:x.getImageData(0,0,c.width,c.height).data};}
function shrink(im,max){var k=Math.max(1,Math.ceil(Math.max(im.w,im.h)/max));if(k===1)return im;var w=Math.floor(im.w/k),h=Math.floor(im.h/k),o=new Uint8ClampedArray(w*h*4);for(var y=0;y<h;y++)for(var x=0;x<w;x++){var i=((y*k)*im.w+x*k)*4,j=(y*w+x)*4;o[j]=im.data[i];o[j+1]=im.data[i+1];o[j+2]=im.data[i+2];o[j+3]=255;}return{w:w,h:h,data:o};}
self.onmessage=function(e){var m=e.data;try{
if(m.type==='process'){m.job.src=px(m.src);var r=K.process(m.job);var o=m.orient?O.textOrientation(shrink(r.img,1000)):undefined;self.postMessage({id:m.id,r:{img:r.img,blur:r.blur,times:r.times,orient:o}},[r.img.data.buffer]);}
else if(m.type==='find'){var s=px(m.small),d=D.detectQuad(s,m.opts),q=null;if(d){var md=px(m.mid),k=md.w/s.w;q=D.refineQuad(D.luminance(md),md.w,md.h,d.quad.map(function(p){return{x:p.x*k,y:p.y*k};}));q=q.map(function(p){return{x:p.x/md.w,y:p.y/md.h};});}else if(m.mid.bmp)m.mid.bmp.close();self.postMessage({id:m.id,r:{det:d,quad:q}});}
}catch(err){self.postMessage({id:m.id,err:String(err&&err.stack||err)});}};`;
}

function startPool() {
  if (workers.length || poolBroken) return;
  try {
    const url = URL.createObjectURL(new Blob([workerCode()], { type: 'application/javascript' }));
    const n = (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      const slot = { w, busy: null as Task | null };
      w.onmessage = (e) => {
        const t = slot.busy; slot.busy = null;
        if (t) { if (e.data.err) t.fail(new Error(e.data.err)); else t.ok(e.data.r); }
        pump();
      };
      w.onerror = (e) => {
        console.warn('scan worker failed', e.message);
        poolBroken = true;
        for (const s of workers) { s.w.terminate(); s.busy?.fail(new Error('worker')); }
        workers.length = 0;
        for (const t of queue.splice(0)) t.fail(new Error('worker'));
      };
      workers.push(slot);
    }
  } catch (e) { console.warn('scan workers unavailable', e); poolBroken = true; }
}

function pump() {
  for (const slot of workers) {
    if (slot.busy) continue;
    const i = queue.findIndex((t) => !t.low);
    const t = i >= 0 ? queue.splice(i, 1)[0] : queue.shift();
    if (!t) return;
    slot.busy = t;
    slot.w.postMessage(t.msg, t.transfer);
  }
}

function post<T>(msg: any, transfer: Transferable[], low = false): Promise<T> {
  startPool();
  if (!workers.length) return Promise.reject(new Error('no workers'));
  return new Promise<T>((ok, fail) => { queue.push({ msg: { ...msg, id: ++seq }, transfer, ok, fail, low }); pump(); });
}

const localKernels = () => (local ??= { K: scanKernels(), D: detectKernels(), O: orientKernels() });

/** a region of the photo at a given size, as a transferable bitmap (or pixels when that's not possible) */
async function sourceOf(bmp: ImageBitmap | HTMLCanvasElement, region: { x: number; y: number; w: number; h: number }, W: number, H: number): Promise<Src> {
  if (canBitmap && !workers.length && !poolBroken) startPool();
  if (canBitmap && workers.length) {
    try {
      const b = await createImageBitmap(bmp, region.x, region.y, region.w, region.h, { resizeWidth: W, resizeHeight: H, resizeQuality: 'high' } as any);
      return { bmp: b };
    } catch { /* fall back */ }
  }
  const p = pixelsOf(bmp, Math.max(W, H), region);
  return { img: { w: p.w, h: p.h, data: p.data } };
}
const transferOf = (s: Src): Transferable[] => ('bmp' in s ? [s.bmp] : [s.img.data.buffer]);

// ---------------------------------------------------------------- finding the page
export interface Found { quad: Quad; sure: boolean; format: string | null; ratio: number }

/** timing log for tuning (window.__scanDebug = 1) */
export const tlog = (label: string, t0: number) => { if ((window as any).__scanDebug) console.log(`scan ${label} ${Math.round(performance.now() - t0)}ms`); };

/** Finds the document in a photo (corners refined on a 1600 px copy), in a worker when possible. */
export async function findDocument(bmp: ImageBitmap | HTMLCanvasElement, mode: ScanMode): Promise<Found> {
  const { w, h } = sizeOf(bmp);
  const t0 = performance.now();
  const full = { x: 0, y: 0, w, h };
  const ks = Math.min(1, 512 / Math.max(w, h)), km = Math.min(1, 1600 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * ks)), sh = Math.max(1, Math.round(h * ks));
  const mw = Math.max(1, Math.round(w * km)), mh = Math.max(1, Math.round(h * km));
  let det: { score: number; support: number[] } | null = null, rel: { x: number; y: number }[] | null = null;
  try {
    const small = await sourceOf(bmp, full, sw, sh), mid = await sourceOf(bmp, full, mw, mh);
    const r = await post<{ det: any; quad: { x: number; y: number }[] | null }>({ type: 'find', small, mid, opts: { ratios: MODE_RATIOS[mode] } }, [...transferOf(small), ...transferOf(mid)]);
    det = r.det; rel = r.quad;
  } catch {
    // no workers: same work here
    const { D } = localKernels();
    const small = pixelsOf(bmp, 512);
    const d = D.detectQuad(small, { ratios: MODE_RATIOS[mode] });
    det = d;
    if (d) {
      const mid = pixelsOf(bmp, 1600), k = mid.w / small.w;
      const q = D.refineQuad(D.luminance(mid), mid.w, mid.h, d.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad);
      rel = q.map((p) => ({ x: p.x / mid.w, y: p.y / mid.h }));
    }
  }
  tlog('find', t0);
  if (!det || !rel) return { quad: fullQuad(w, h), sure: false, ...shapeOf(fullQuad(w, h), w, h, mode) };
  const quad = rel.map((p) => ({ x: p.x * w, y: p.y * h })) as Quad;
  const sure = det.score > 0.78 && Math.min(...det.support) > 0.45;
  return { quad, sure, ...shapeOf(quad, w, h, mode) };
}

/** True proportions of the crop and the format they match. */
export function shapeOf(quad: Quad, w: number, h: number, mode: ScanMode): { format: string | null; ratio: number } {
  const r = aspectOf(quad, w, h);
  if (mode === 'id' || mode === 'passport') {
    // the format is known: keep its shape whenever the measurement is anywhere near it
    const f = FORMATS[mode === 'id' ? 'id1' : 'id3'];
    const s = snapRatio(r, [f.id], 0.16);
    return s.format ? { format: f.id, ratio: s.ratio } : { format: null, ratio: r };
  }
  if (mode === 'receipt') return { format: null, ratio: r };
  const s = snapRatio(r, ['a4', 'letter', 'legal', 'a5', 'id1', 'id3']);
  // sheets lie in either orientation, but a "landscape legal" is far more likely an ID card
  if (s.format?.id === 'legal' && r > 1) {
    const c = snapRatio(r, ['id1'], 0.08);
    return { format: c.format?.id ?? null, ratio: c.format ? c.ratio : r };
  }
  return { format: s.format?.id ?? null, ratio: s.ratio };
}

/** Output size in pixels for a page (before its quarter turns). */
export function outputSize(p: ScanPage, quality: Quality): { w: number; h: number } {
  const q = p.quad;
  const srcW = Math.max(dist(q[0], q[1]), dist(q[3], q[2])), srcH = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const card = p.format === 'id1' || p.format === 'id3';
  const caps: Record<Quality, number> = card ? { small: 1000, standard: 1400, high: 2000 } : { small: 1650, standard: 2339, high: 3300 };
  let long = caps[quality];
  if (p.kind === 'receipt') long = Math.min(5200, (quality === 'small' ? 700 : quality === 'standard' ? 1000 : 1400) / Math.min(1, p.ratio));
  // no point in more pixels than the photo has (a little upsampling helps the sharpening)
  long = Math.min(long, Math.max(srcW, srcH) * 1.15);
  long = Math.max(320, long);
  return p.ratio >= 1 ? { w: Math.round(long), h: Math.round(long / p.ratio) } : { w: Math.round(long * p.ratio), h: Math.round(long) };
}

// ---------------------------------------------------------------- rendering
/** corners after `rot` clockwise quarter turns of the output */
export const turnQuad = (q: Quad, rot: number): Quad => {
  const r = ((rot % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i - r + 4) % 4]) as Quad;
};

export interface Rendered { blob: Blob; url: string; w: number; h: number; blur: number; orient?: Orientation | null }
export interface RenderOpt { quality: Quality; long?: number; filter?: Filter; jpeg?: number; orient?: boolean; low?: boolean }

/**
 * Crops, straightens and filters a page. `long` caps the output's longest side (previews);
 * otherwise the quality setting decides. `orient` also reads the text direction (on rot 0 only).
 */
export async function renderPage(p: ScanPage, opt: RenderOpt): Promise<Rendered> {
  const res = await renderRaw(p, opt);
  const card = p.format === 'id1' || p.format === 'id3';
  const filter = opt.filter ?? p.filter;
  const blob = await toJpeg(res.img, opt.jpeg ?? (card ? 0.9 : filter === 'bw' ? 0.82 : 0.85));
  return { blob, url: URL.createObjectURL(blob), w: res.img.w, h: res.img.h, blur: res.blur, orient: res.orient };
}

/** The cropped, filtered page as pixels. */
export async function renderRaw(p: ScanPage, opt: RenderOpt): Promise<JobResult & { orient?: Orientation | null }> {
  const t0 = performance.now();
  const bmp = await decode(p.blob);
  let { w: ow, h: oh } = outputSize(p, opt.quality);
  if (opt.long && Math.max(ow, oh) > opt.long) { const k = opt.long / Math.max(ow, oh); ow = Math.round(ow * k); oh = Math.round(oh * k); }
  // only the part of the photo under the page, at about the output's resolution
  const q = p.quad;
  const xs = q.map((c) => c.x), ys = q.map((c) => c.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
  const x1 = Math.min(p.w, Math.ceil(Math.max(...xs)) + 2), y1 = Math.min(p.h, Math.ceil(Math.max(...ys)) + 2);
  const srcLong = Math.max(dist(q[0], q[1]), dist(q[3], q[2]), dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, (Math.max(ow, oh) * 1.25) / srcLong);
  const region = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const RW = Math.max(1, Math.round(region.w * k)), RH = Math.max(1, Math.round(region.h * k));
  const sx = RW / region.w, sy = RH / region.h;
  const tq = turnQuad(q, p.rot);
  const odd = p.rot % 2 !== 0;
  const outW = odd ? oh : ow, outH = odd ? ow : oh;
  const filter = opt.filter ?? p.filter;
  // ISO ID-1 corner radius 3.18 mm on 85.6 mm; passport pages are square-cut
  const radius = p.format === 'id1' && filter !== 'original' ? (Math.max(outW, outH) * 3.18) / 85.6 : 0;
  const job = { quad: tq.flatMap((c) => [(c.x - x0) * sx, (c.y - y0) * sy]), outW, outH, filter, sharpen: 'auto' as const, radius };
  const orient = !!opt.orient && p.rot === 0;
  let res: JobResult & { orient?: Orientation | null };
  try {
    const src = await sourceOf(bmp, region, RW, RH);
    res = await post({ type: 'process', src, job, orient }, transferOf(src), opt.low);
  } catch {
    const { K, O } = localKernels();
    const px = pixelsOf(bmp, Math.max(RW, RH), region);
    await new Promise((r) => setTimeout(r, 0));
    const r = K.process({ ...job, src: { w: px.w, h: px.h, data: px.data } });
    res = { ...r, orient: orient ? O.textOrientation(r.img) : undefined };
  }
  tlog(`render ${opt.long ?? opt.quality} ${filter} ${outW}x${outH} ${JSON.stringify(res.times)}`, t0);
  return res;
}

/**
 * Quarter turns that put the page's text upright (null: leave it), from a reading of the text
 * direction. Cards and passport pages that came out portrait are turned to landscape.
 */
export function turnsFor(p: ScanPage, o: Orientation | null | undefined): number | null {
  const card = p.format === 'id1' || p.format === 'id3';
  if (o?.sure) {
    // a card's text may run sideways in places (vertical strips); trust only turns that make it landscape
    if (card && ((p.ratio < 1) !== (o.turns % 2 === 1))) return p.ratio < 1 ? 1 : 0;
    return o.turns || null;
  }
  return card && p.ratio < 1 ? 1 : null;
}

export async function toJpeg(img: { w: number; h: number; data: Uint8ClampedArray }, q: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  c.getContext('2d')!.putImageData(new ImageData(img.data as any, img.w, img.h), 0, 0);
  const b = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q));
  c.width = c.height = 0;
  if (!b) throw new Error('Could not encode the page');
  return b;
}

/** Sharpness of a frame (variance of the Laplacian on a small grey copy) — picks the best of a burst. */
export function sharpness(src: CanvasImageSource): number {
  const px = pixelsOf(src, 480);
  const L = luminance(px), w = px.w, h = px.h;
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    const i = y * w + x;
    const v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
    s += v; s2 += v * v; n++;
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
