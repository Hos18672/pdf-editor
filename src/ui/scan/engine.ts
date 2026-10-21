// Scanner plumbing on the main thread: decode photos, find the document, render pages in a worker.
import { detectQuad, luminance, refineQuad, type Rgba } from './detect';
import { aspectOf, dist, FORMATS, fullQuad, snapRatio, type Quad } from './geom';
import { scanKernels, type Filter, type Job, type JobResult, type Kernels } from './kernels';

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

// ---------------------------------------------------------------- finding the page
export interface Found { quad: Quad; sure: boolean; format: string | null; ratio: number }

/** Finds the document in a photo (corners refined on a 1600 px copy). */
export async function findDocument(bmp: ImageBitmap | HTMLCanvasElement, mode: ScanMode): Promise<Found> {
  const { w, h } = sizeOf(bmp);
  const small = pixelsOf(bmp, 512);
  const det = detectQuad(small, { ratios: MODE_RATIOS[mode] });
  if (!det) return { quad: fullQuad(w, h), sure: false, ...shapeOf(fullQuad(w, h), w, h, mode) };
  const mid = pixelsOf(bmp, 1600);
  const k = mid.w / small.w;
  const q = refineQuad(luminance(mid), mid.w, mid.h, det.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad);
  const quad = q.map((p) => ({ x: p.x / mid.scale, y: p.y / mid.scale })) as Quad;
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
let worker: Worker | null = null;
let workerBroken = false;
let local: Kernels | null = null;
let seq = 0;
const waiting = new Map<number, { ok: (r: JobResult) => void; fail: (e: any) => void }>();

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    const code = `var K=(${scanKernels.toString()})();self.onmessage=function(e){try{var r=K.process(e.data.job);self.postMessage({id:e.data.id,r:r},[r.img.data.buffer]);}catch(err){self.postMessage({id:e.data.id,err:String(err&&err.stack||err)});}};`;
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    worker = new Worker(url);
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.err) w.fail(new Error(e.data.err)); else w.ok(e.data.r);
    };
    worker.onerror = (e) => {
      console.warn('scan worker failed', e.message);
      workerBroken = true; worker?.terminate(); worker = null;
      for (const [, w] of waiting) w.fail(new Error('worker'));
      waiting.clear();
    };
  } catch (e) { console.warn('scan worker unavailable', e); workerBroken = true; worker = null; }
  return worker;
}

/** Runs one pixel job in the worker (or here, if workers can't start). */
export function runJob(job: Job): Promise<JobResult> {
  const w = getWorker();
  if (!w) {
    local ??= scanKernels();
    return new Promise((res) => setTimeout(() => res(local!.process(job)), 0));
  }
  return new Promise((ok, fail) => {
    const id = ++seq;
    waiting.set(id, { ok, fail });
    w.postMessage({ id, job }, [job.src.data.buffer]);
  }).catch(() => { local ??= scanKernels(); return local.process(job); }) as Promise<JobResult>;
}

/** corners after `rot` clockwise quarter turns of the output */
export const turnQuad = (q: Quad, rot: number): Quad => {
  const r = ((rot % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i - r + 4) % 4]) as Quad;
};

export interface Rendered { blob: Blob; url: string; w: number; h: number; blur: number }

/**
 * Crops, straightens and filters a page. `long` caps the output's longest side (previews);
 * otherwise the quality setting decides.
 */
export async function renderPage(p: ScanPage, opt: { quality: Quality; long?: number; filter?: Filter; jpeg?: number }): Promise<Rendered> {
  const res = await renderRaw(p, opt);
  const card = p.format === 'id1' || p.format === 'id3';
  const filter = opt.filter ?? p.filter;
  const blob = await toJpeg(res.img, opt.jpeg ?? (card ? 0.9 : filter === 'bw' ? 0.82 : 0.85));
  return { blob, url: URL.createObjectURL(blob), w: res.img.w, h: res.img.h, blur: res.blur };
}

/** The cropped, filtered page as pixels. */
export async function renderRaw(p: ScanPage, opt: { quality: Quality; long?: number; filter?: Filter }): Promise<JobResult> {
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
  const px = pixelsOf(bmp, Math.max(region.w, region.h) * k, region);
  const sx = px.w / region.w, sy = px.h / region.h;
  const tq = turnQuad(q, p.rot);
  const odd = p.rot % 2 !== 0;
  const outW = odd ? oh : ow, outH = odd ? ow : oh;
  const filter = opt.filter ?? p.filter;
  const card = p.format === 'id1' || p.format === 'id3';
  // ISO ID-1 corner radius 3.18 mm on 85.6 mm; passport pages are square-cut
  const radius = p.format === 'id1' && filter !== 'original' ? (Math.max(outW, outH) * 3.18) / 85.6 : 0;
  void card;
  return runJob({
    src: { w: px.w, h: px.h, data: px.data },
    quad: tq.flatMap((c) => [(c.x - x0) * sx, (c.y - y0) * sy]),
    outW, outH, filter, sharpen: 'auto', radius,
  });
}

/**
 * Quarter turns that put the page's text upright (null: leave it). Cards and passport pages that came
 * out portrait are turned to landscape even without readable text.
 */
export async function orientPage(p: ScanPage): Promise<number | null> {
  const { textOrientation } = await import('./orient');
  const res = await renderRaw({ ...p, rot: 0 }, { quality: 'small', long: 900, filter: 'gray' });
  const o = textOrientation(res.img);
  const card = p.format === 'id1' || p.format === 'id3';
  if (o?.sure) {
    // a card's text may run sideways in places (vertical strips); trust only turns that make it landscape
    if (card && ((p.ratio < 1) !== (o.turns % 2 === 1))) return p.ratio < 1 ? 1 : 0;
    return o.turns;
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
