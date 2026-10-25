// Scanner plumbing on the main thread: decode photos, find the document, render pages in a worker.
import { detectKernels, luminance } from './detect';
import { orientKernels, type Orientation } from './orient';
import { workerUrl } from './workerUrl';
import { WORKER_VERSION } from './workerVersion';
import { aspectOf, dist, FORMATS, fullQuad, snapRatio, type Quad } from './geom';
import { scanKernels, type Filter, type JobResult, type Kernels, type PixelImage, type Stroke } from './kernels';
import { bendReach, scaleBend, traceBend, turnBend, type Bend } from './bend';
import { turnGrid, type AiInfo } from './dewarp';
import type { Bentness, Grid } from './kernels';
import { appBase } from '../assets';

export type ScanMode = 'doc' | 'id' | 'passport' | 'receipt' | 'book';
export type Quality = 'small' | 'standard' | 'high';

export interface ScanPage {
  id: string;
  blob: Blob;
  /** decoded size (EXIF orientation applied) */
  w: number; h: number;
  quad: Quad;
  auto: Quad | null;
  /** curved sides (photo pixels), null when the sides are straight */
  bend: Bend | null;
  autoBend: Bend | null;
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
  /** AI flattening of a curved page (see dewarp.ts), for the crop it was worked out for */
  ai?: { key: string; grid: Grid | null; info: AiInfo } | null;
  /** AI flattening switched off for this page */
  aiOff?: boolean;
  /** things painted over to be removed, on the page before its quarter turns */
  erase?: Stroke[];
}

/** strokes on the page after `rot` clockwise quarter turns */
export function turnStrokes(st: Stroke[] | undefined, rot: number): Stroke[] | undefined {
  const r = ((rot % 4) + 4) % 4;
  if (!st?.length || !r) return st;
  return st.map((s) => {
    const pts: number[] = [];
    for (let i = 0; i + 1 < s.pts.length; i += 2) {
      const x = s.pts[i], y = s.pts[i + 1];
      if (r === 1) pts.push(1 - y, x); else if (r === 2) pts.push(1 - x, 1 - y); else pts.push(y, 1 - x);
    }
    return { r: s.r, pts };
  });
}
/** a short tag that changes with the strokes (for keys of cached pictures) */
export const eraseTag = (p: ScanPage) => {
  if (!p.erase?.length) return '';
  let h = 0;
  for (const s of p.erase) for (const v of s.pts) h = (h * 31 + Math.round(v * 1e4)) | 0;
  return `e${p.erase.length}.${h}`;
};

export const DEFAULT_FILTER: Record<ScanMode, Filter> = { doc: 'auto', id: 'auto', passport: 'auto', receipt: 'auto', book: 'auto' };
export const MODE_RATIOS: Record<ScanMode, number[] | undefined> = {
  doc: undefined, id: [FORMATS.id1.ratio], passport: [FORMATS.id3.ratio], receipt: undefined, book: undefined,
};
export const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- decoding
/** longest side kept from a photo (best quality output is 3300 px for the page itself) */
const MAX_SIDE = 4096;
const decoded = new Map<Blob, Promise<ImageBitmap | HTMLCanvasElement>>();

/** Photo → bitmap with its EXIF orientation applied. HEIC goes through a converter first. */
export function decode(blob: Blob): Promise<ImageBitmap | HTMLCanvasElement> {
  let p = decoded.get(blob);
  if (!p) {
    p = (async () => {
      const t0 = performance.now();
      let b = blob;
      if (/heic|heif/i.test(b.type) || /\.(heic|heif)$/i.test((b as File).name ?? '')) {
        const heic2any = (await import('heic2any')).default as any;
        const r = await heic2any({ blob: b, toType: 'image/jpeg', quality: 0.95 });
        b = Array.isArray(r) ? r[0] : r;
      }
      if (typeof createImageBitmap === 'function') {
        try {
          const oriented = await createImageBitmap(b, { imageOrientation: 'from-image' } as any);
          // Phone photos keep "rotate me" in EXIF; some Android WebViews then crop such a bitmap in
          // the unrotated frame (shifted crops). Bake the rotation into plain pixels once — and keep
          // at most MAX_SIDE: 50 MP photos hold no more page detail than the best output uses, and
          // cost seconds and hundreds of MB at every step.
          const k = Math.min(1, MAX_SIDE / Math.max(oriented.width, oriented.height));
          const c = document.createElement('canvas');
          c.width = Math.round(oriented.width * k); c.height = Math.round(oriented.height * k);
          const cx = c.getContext('2d')!;
          cx.imageSmoothingEnabled = true; (cx as any).imageSmoothingQuality = 'high';
          cx.drawImage(oriented, 0, 0, c.width, c.height);
          oriented.close();
          tlog(`decode ${c.width}x${c.height}`, t0);
          try { const flat = await createImageBitmap(c); c.width = c.height = 0; return flat; } catch { return c; }
        } catch { /* fall back */ }
      }
      const url = URL.createObjectURL(b);
      try {
        const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not a readable image')); i.src = url; });
        const k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
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

let starting: Promise<void> | null = null;
function startPool(): Promise<void> {
  if (workers.length || poolBroken) return Promise.resolve();
  starting ??= workerUrl().then((url) => {
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
  }).catch((e) => { console.warn('scan workers unavailable', e); poolBroken = true; });
  return starting;
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

async function post<T>(msg: any, transfer: Transferable[], low = false): Promise<T> {
  await startPool();
  if (!workers.length) throw new Error('no workers');
  return new Promise<T>((ok, fail) => { queue.push({ msg: { ...msg, id: ++seq }, transfer, ok, fail, low }); pump(); });
}

const localKernels = () => (local ??= { K: scanKernels(), D: detectKernels(), O: orientKernels() });

/** a region of the photo at a given size, as a transferable bitmap (or pixels when that's not possible) */
async function sourceOf(bmp: ImageBitmap | HTMLCanvasElement, region: { x: number; y: number; w: number; h: number }, W: number, H: number): Promise<Src> {
  if (canBitmap) await startPool();
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
export interface Found { quad: Quad; bend: Bend | null; sure: boolean; format: string | null; ratio: number }

/** timing log for tuning (window.__scanDebug = 1) */
export const tlog = (label: string, t0: number) => { if ((window as any).__scanDebug) console.log(`scan ${label} ${Math.round(performance.now() - t0)}ms`); };

/** Finds the document in a photo (corners refined on a 1600 px copy), in a worker when possible. */
export async function findDocument(bmp: ImageBitmap | HTMLCanvasElement, mode: ScanMode, hint?: { quad: { x: number; y: number }[]; aspect: number }): Promise<Found> {
  const { w, h } = sizeOf(bmp);
  const t0 = performance.now();
  const full = { x: 0, y: 0, w, h };
  const ks = Math.min(1, 512 / Math.max(w, h)), km = Math.min(1, 1600 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * ks)), sh = Math.max(1, Math.round(h * ks));
  const mw = Math.max(1, Math.round(w * km)), mh = Math.max(1, Math.round(h * km));
  let det: { score: number; support: number[]; agree?: number } | null = null, rel: { x: number; y: number }[] | null = null, relBend: Bend | null = null;
  // cards and passports are stiff: only sheets of paper are followed along curved sides
  const bend = mode === 'doc' || mode === 'receipt' || mode === 'book';
  try {
    const small = await sourceOf(bmp, full, sw, sh), mid = await sourceOf(bmp, full, mw, mh);
    const r = await post<{ det: any; quad: { x: number; y: number }[] | null; bend: Bend | null }>({ type: 'find', small, mid, bend, opts: { ratios: MODE_RATIOS[mode] } }, [...transferOf(small), ...transferOf(mid)]);
    det = r.det; rel = r.quad; relBend = r.bend;
  } catch {
    // no workers: same work here
    const { D } = localKernels();
    const small = pixelsOf(bmp, 512);
    const d = D.detectQuad(small, { ratios: MODE_RATIOS[mode] });
    det = d;
    if (d) {
      const mid = pixelsOf(bmp, 1600), k = mid.w / small.w, L = D.luminance(mid);
      let q = D.refineQuad(L, mid.w, mid.h, d.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad);
      const b = bend ? traceBend(L, mid.w, mid.h, q) : null;
      if (b) { q = b.quad; relBend = scaleBend(b.bend, 1 / mid.w, 1 / mid.h); }
      rel = q.map((p) => ({ x: p.x / mid.w, y: p.y / mid.h }));
    }
  }
  tlog('find', t0);
  // the outline seen in the preview when the photo was taken wins over a different one found in the
  // photo (something else at the frame's edge, outside the preview): its corners are refined here
  if (hint && Math.abs(w / h / hint.aspect - 1) < 0.04) {
    const hq = hint.quad.map((p) => ({ x: p.x * w, y: p.y * h })) as Quad;
    const diag = Math.hypot(w, h);
    const off = rel ? Math.max(...rel.map((p, i) => Math.hypot(p.x * w - hq[i].x, p.y * h - hq[i].y))) / diag : 1;
    if (off > 0.06) {
      const { D } = localKernels();
      const mid = pixelsOf(bmp, 1600), L = D.luminance(mid), k = mid.w / w;
      const q = D.refineQuad(L, mid.w, mid.h, hq.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad).map((p) => ({ x: p.x / k, y: p.y / k })) as Quad;
      return { quad: q, bend: null, sure: true, ...shapeOf(q, w, h, mode) };
    }
  }
  if (!det || !rel) return { quad: fullQuad(w, h), bend: null, sure: false, ...shapeOf(fullQuad(w, h), w, h, mode) };
  const quad = rel.map((p) => ({ x: p.x * w, y: p.y * h })) as Quad;
  const sure = (det.score > 0.78 && Math.min(...det.support) > 0.45) || (det.agree ?? 0) > 0.75;
  return { quad, bend: relBend ? scaleBend(relBend, w, h) : null, sure, ...shapeOf(quad, w, h, mode, !!relBend) };
}

/** True proportions of the crop and the format they match. */
export function shapeOf(quad: Quad, w: number, h: number, mode: ScanMode, bent = false): { format: string | null; ratio: number } {
  const r = aspectOf(quad, w, h);
  if (mode === 'id' || mode === 'passport') {
    // the format is known: keep its shape whenever the measurement is anywhere near it
    const f = FORMATS[mode === 'id' ? 'id1' : 'id3'];
    const s = snapRatio(r, [f.id], 0.16);
    return s.format ? { format: f.id, ratio: s.ratio } : { format: null, ratio: r };
  }
  // receipts, and book pages (any trim size): their own proportions
  if (mode === 'receipt' || mode === 'book') return { format: null, ratio: r };
  // a page whose sides bend is paper, never a stiff card
  const s = snapRatio(r, bent ? ['a4', 'letter', 'legal', 'a5'] : ['a4', 'letter', 'legal', 'a5', 'id1', 'id3']);
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

export interface Rendered { blob: Blob; url: string; w: number; h: number; blur: number; orient?: Orientation | null; bent?: Bentness | null }
export interface RenderOpt { quality: Quality; long?: number; filter?: Filter; jpeg?: number; orient?: boolean; low?: boolean; quick?: boolean }

/** output size before quarter turns, capped by `long` */
function sizeFor(p: ScanPage, quality: Quality, long?: number) {
  let { w: ow, h: oh } = outputSize(p, quality);
  if (long && Math.max(ow, oh) > long) { const k = long / Math.max(ow, oh); ow = Math.round(ow * k); oh = Math.round(oh * k); }
  return { ow, oh };
}
/** ISO ID-1 corner radius 3.18 mm on 85.6 mm; passport pages are square-cut */
const radiusOf = (p: ScanPage, filter: Filter, ow: number, oh: number) => (p.format === 'id1' && filter !== 'original' ? (Math.max(ow, oh) * 3.18) / 85.6 : 0);

/** the part of the photo under the page (curved sides included), at about the output's resolution */
async function cropSource(p: ScanPage, ow: number, oh: number, rot: number) {
  const bmp = await decode(p.blob);
  const q = p.quad, reach = bendReach(p.bend);
  const xs = q.map((c) => c.x), ys = q.map((c) => c.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - reach) - 2), y0 = Math.max(0, Math.floor(Math.min(...ys) - reach) - 2);
  const x1 = Math.min(p.w, Math.ceil(Math.max(...xs) + reach) + 2), y1 = Math.min(p.h, Math.ceil(Math.max(...ys) + reach) + 2);
  const srcLong = Math.max(dist(q[0], q[1]), dist(q[3], q[2]), dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, (Math.max(ow, oh) * 1.25) / srcLong);
  const region = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const RW = Math.max(1, Math.round(region.w * k)), RH = Math.max(1, Math.round(region.h * k));
  const sx = RW / region.w, sy = RH / region.h;
  const tq = turnQuad(q, rot);
  const bend = p.bend ? scaleBend(turnBend(p.bend, rot), sx, sy) : null;
  return { bmp, region, RW, RH, quad: tq.flatMap((c) => [(c.x - x0) * sx, (c.y - y0) * sy]), bend };
}

async function blobOf(r: { blob?: Blob; img?: PixelImage; w?: number; h?: number }, q: number): Promise<{ blob: Blob; w: number; h: number }> {
  if (r.blob) return { blob: r.blob, w: r.w!, h: r.h! };
  return { blob: await toJpeg(r.img!, q), w: r.img!.w, h: r.img!.h };
}

/**
 * Crops, straightens and filters a page in one go (saving quality, or a quick first look with
 * `quick`). `long` caps the output's longest side; otherwise the quality setting decides.
 */
export async function renderPage(p: ScanPage, opt: RenderOpt): Promise<Rendered> {
  const t0 = performance.now();
  const { ow, oh } = sizeFor(p, opt.quality, opt.long);
  const odd = p.rot % 2 !== 0;
  const outW = odd ? oh : ow, outH = odd ? ow : oh;
  const filter = opt.filter ?? p.filter;
  const card = p.format === 'id1' || p.format === 'id3';
  const jpeg = opt.jpeg ?? (card ? 0.9 : filter === 'bw' ? 0.82 : 0.85);
  const src = await cropSource(p, ow, oh, p.rot);
  // turned upright here already: text runs along the rows
  const job = { quad: src.quad, bend: src.bend, outW, outH, filter, sharpen: (opt.quick ? 'off' : 'auto') as 'auto' | 'off', radius: radiusOf(p, filter, ow, oh), flatten: flattens(p) ? 'rows' as const : null, grid: gridOf(p, p.rot), card: isCard(p), erase: turnStrokes(p.erase, p.rot) };
  const orient = !!opt.orient && p.rot === 0;
  let res: { blob?: Blob; img?: PixelImage; w?: number; h?: number; blur: number; orient?: Orientation | null; times?: any };
  try {
    const s = await sourceOf(src.bmp, src.region, src.RW, src.RH);
    res = await post({ type: 'process', src: s, job, orient, jpeg }, transferOf(s), opt.low);
  } catch {
    const { K, O } = localKernels();
    const px = pixelsOf(src.bmp, Math.max(src.RW, src.RH), src.region);
    await new Promise((r) => setTimeout(r, 0));
    const r = K.process({ ...job, src: { w: px.w, h: px.h, data: px.data } });
    res = { ...r, orient: orient ? O.textOrientation(r.img) : undefined };
  }
  const b = await blobOf(res, jpeg);
  tlog(`render ${opt.long ?? opt.quality}${opt.quick ? ' quick' : ''} ${filter} ${b.w}x${b.h} ${JSON.stringify(res.times ?? {})}`, t0);
  return { blob: b.blob, url: URL.createObjectURL(b.blob), w: b.w, h: b.h, blur: res.blur, orient: res.orient };
}

/** ID cards and passport pages get looks that keep the card (security print, photo) */
export const isCard = (p: ScanPage) => p.kind === 'id' || p.kind === 'passport' || p.format === 'id1' || p.format === 'id3';
/** sheets of paper get their printed lines straightened (cards and passports are stiff) */
export const flattens = (p: ScanPage) => (p.kind === 'doc' || p.kind === 'receipt' || p.kind === 'book') && p.format !== 'id1' && p.format !== 'id3';

// ---------------------------------------------------------------- the page on screen
// The straightened page (and its sharpened copy) is kept for the pages being looked at, so changing the
// look, turning the page or comparing only runs the quick last step.

interface Base { warped: PixelImage; sharp: PixelImage | null; blur: number; ow: number; oh: number; bent?: Bentness | null }
const bases = new Map<string, Promise<Base>>();
const baseKey = (p: ScanPage, long: number) =>
  `${p.id}:${p.rot % 2}:${p.quad.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(';')}:${p.bend ? 'b' + bendReach(p.bend).toFixed(1) : ''}:${long}:${gridOf(p, 0) ? 'ai' : ''}`;

function baseOf(p: ScanPage, long: number, low?: boolean): Promise<Base> {
  const key = baseKey(p, long);
  let b = bases.get(key);
  if (b) { bases.delete(key); bases.set(key, b); return b; }
  b = (async () => {
    const t0 = performance.now();
    const { ow, oh } = sizeFor(p, 'standard', long);
    const src = await cropSource(p, ow, oh, 0);
    // not turned yet: on a page that will get a quarter turn the text runs down the columns
    const job = { quad: src.quad, bend: src.bend, outW: ow, outH: oh, sharpen: 'auto' as const, flatten: flattens(p) ? (p.rot % 2 ? 'cols' as const : 'rows' as const) : null, grid: gridOf(p, 0) };
    let r: { warped: PixelImage; sharp: PixelImage | null; blur: number; times?: any; bent?: Bentness | null };
    try {
      const s = await sourceOf(src.bmp, src.region, src.RW, src.RH);
      r = await post({ type: 'prep', src: s, job }, transferOf(s), low);
    } catch {
      const { K } = localKernels();
      const px = pixelsOf(src.bmp, Math.max(src.RW, src.RH), src.region);
      await new Promise((res) => setTimeout(res, 0));
      r = K.prepare({ ...job, src: { w: px.w, h: px.h, data: px.data } });
    }
    tlog(`prep ${ow}x${oh} ${JSON.stringify(r.times ?? {})}`, t0);
    return { warped: r.warped, sharp: r.sharp, blur: r.blur, ow, oh, bent: r.bent };
  })();
  bases.set(key, b);
  b.catch(() => bases.delete(key));
  // a few pages' worth (each is a few MB)
  while (bases.size > 4) bases.delete(bases.keys().next().value as string);
  return b;
}
/** drops kept pages of a scan that is closed */
export const forgetBases = () => bases.clear();

/** A page on screen in a given look (straightening reused from earlier looks of the same crop). */
export async function renderLook(p: ScanPage, opt: { long: number; filter?: Filter; orient?: boolean; jpeg?: number; noErase?: boolean }): Promise<Rendered> {
  const t0 = performance.now();
  const base = await baseOf(p, opt.long);
  const filter = opt.filter ?? p.filter;
  const img = filter === 'original' ? base.warped : base.sharp ?? base.warped;
  const card = p.format === 'id1' || p.format === 'id3';
  const jpeg = opt.jpeg ?? (card ? 0.9 : 0.85);
  const radius = radiusOf(p, filter, base.ow, base.oh);
  const orient = !!opt.orient && p.rot === 0;
  const erase = opt.noErase ? undefined : p.erase;
  let r: { blob?: Blob; img?: PixelImage; w?: number; h?: number; orient?: Orientation | null };
  try {
    r = await post({ type: 'look', img, filter, blur: base.blur, radius, rot: p.rot, orient, jpeg, card: isCard(p), erase }, []);
  } catch {
    const { K, O } = localKernels();
    const out = K.finish({ w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) }, filter, base.blur, radius, p.rot, isCard(p), erase);
    r = { img: out, orient: orient ? O.textOrientation(out) : undefined };
  }
  const b = await blobOf(r, jpeg);
  tlog(`look ${filter} ${b.w}x${b.h}`, t0);
  return { blob: b.blob, url: URL.createObjectURL(b.blob), w: b.w, h: b.h, blur: base.blur, orient: r.orient, bent: base.bent };
}

/**
 * Removes what the strokes cover from a picture (in a worker when there is one): the filled picture and
 * the covered share of each pixel. texture: matching texture is copied in from nearby.
 */
export async function eraseImage(img: PixelImage, strokes: Stroke[], texture: boolean): Promise<{ img: PixelImage; mask: Float32Array | null }> {
  const copy = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  try {
    return await post<{ img: PixelImage; mask: Float32Array | null }>({ type: 'erase', img: copy, strokes, texture }, [copy.data.buffer]);
  } catch {
    const own = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
    const mask = localKernels().K.erase(own, strokes, texture);
    return { img: own, mask };
  }
}

/** Small previews of a page in every look, from the kept straightened page. */
export async function renderThumbs(p: ScanPage, filters: Filter[], long: number, max: number): Promise<Record<string, string>> {
  const t0 = performance.now();
  const base = await baseOf(p, long);
  const img = base.sharp ?? base.warped;
  const radius = radiusOf(p, 'auto', base.ow, base.oh);
  let items: { filter: Filter; blob?: Blob; img?: PixelImage; w?: number; h?: number }[];
  try {
    items = (await post<{ items: typeof items }>({ type: 'thumbs', img, filters, blur: base.blur, radius, rot: p.rot, max, jpeg: 0.8, card: isCard(p), erase: p.erase }, [])).items;
  } catch {
    const { K } = localKernels();
    const small = K.shrink(img, max), k = small.w / img.w;
    items = filters.map((f) => ({ filter: f, img: K.finish({ w: small.w, h: small.h, data: new Uint8ClampedArray(small.data) }, f, base.blur * k, f === 'original' ? 0 : radius * k, p.rot, isCard(p), p.erase) }));
  }
  const out: Record<string, string> = {};
  for (const it of items) out[it.filter] = URL.createObjectURL((await blobOf(it, 0.8)).blob);
  tlog('thumbs', t0);
  return out;
}

/**
 * Quarter turns that put the page's text upright (null: leave it), from a reading of the text
 * direction. Cards and passport pages that came out portrait are turned to landscape.
 */
export function turnsFor(p: ScanPage, o: Orientation | null | undefined): number | null {
  // (a passport photographed open shows two pages one above the other: upright, that is portrait)
  const card = p.format === 'id1' || (p.format === 'id3' && p.kind !== 'passport');
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

// ---------------------------------------------------------------- AI flattening of curved pages
// The UVDoc model (dewarp.ts) in a worker of its own, started the first time a page looks bent. Its
// runtime (WebAssembly) and the model ship with the app and are handed over as bytes. If anything is
// missing or fails, pages simply keep the classical straightening.

/** the crop (and turn) a page's AI map was worked out for */
export const aiKey = (p: ScanPage) => `${p.quad.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(';')}:${p.bend ? bendReach(p.bend).toFixed(1) : ''}:${p.rot}`;
/** the page's AI map for an output turned `rot` quarter turns (null: classical only) */
export function gridOf(p: ScanPage, rot: number): Grid | null {
  if (p.aiOff || !p.ai?.grid || p.ai.key !== aiKey(p)) return null;
  return turnGrid(p.ai.grid, rot);
}
/** worth trying the model: a sheet whose sides curve or whose printed lines wander */
export function looksCurved(p: ScanPage, bent: Bentness | null | undefined): boolean {
  if (p.aiOff || p.ai?.key === aiKey(p) || aiBroken) return false;
  // ID cards and passport pages: always worth a try (a passport page bows away from the spine, a card
  // bends in the hand); the model's map is kept only if the printed lines come out straighter
  if (isCard(p)) return true;
  if (!flattens(p)) return false;
  const q = p.quad, side = Math.max(dist(q[0], q[1]), dist(q[0], q[3]), 1);
  return bendReach(p.bend) / side > 0.004 || (!!bent && bent.rms > 0.06);
}

let aiWorker: Promise<Worker> | null = null, aiBroken = false, aiSeq = 0;
/** frees the model's memory (the scanner closed); started again when needed */
export function stopAi() { aiWorker?.then((w) => w.terminate()).catch(() => null); aiWorker = null; for (const t of aiWaiting.values()) t.fail(new Error('stopped')); aiWaiting.clear(); }
const aiWaiting = new Map<number, { ok: (r: any) => void; fail: (e: any) => void }>();
function loadBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url); x.responseType = 'arraybuffer';
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? resolve(x.response) : reject(new Error(`Could not load ${url}`)));
    x.onerror = () => reject(new Error(`Could not load ${url}`));
    x.send();
  });
}
function aiPost<T>(w: Worker, msg: any, transfer: Transferable[] = []): Promise<T> {
  const id = ++aiSeq;
  return new Promise<T>((ok, fail) => { aiWaiting.set(id, { ok, fail }); w.postMessage({ ...msg, id }, transfer); });
}
function startAi(): Promise<Worker> {
  aiWorker ??= (async () => {
    const t0 = performance.now();
    const base = appBase() + 'scan/';
    const [js, wasm, model] = await Promise.all([loadBytes(base + `ai.js?v=${WORKER_VERSION}`), loadBytes(base + `ort.wasm?v=${WORKER_VERSION}`), loadBytes(base + `uvdoc.onnx?v=${WORKER_VERSION}`)]);
    const w = new Worker(URL.createObjectURL(new Blob([js], { type: 'application/javascript' })));
    w.onmessage = (e) => { const t = aiWaiting.get(e.data.id); aiWaiting.delete(e.data.id); if (t) { if (e.data.err) t.fail(new Error(e.data.err)); else t.ok(e.data.r); } };
    w.onerror = (e) => { console.warn('scan AI worker failed', e.message); aiBroken = true; for (const t of aiWaiting.values()) t.fail(new Error('AI worker')); aiWaiting.clear(); };
    await aiPost(w, { type: 'init', wasm, model }, [wasm, model]);
    tlog('ai ready', t0);
    return w;
  })().catch((e) => { aiBroken = true; aiWorker = null; throw e; });
  return aiWorker;
}

/**
 * Works out the AI map for a page (on the page turned upright, as it will be read) and whether to use
 * it. Resolves with what to keep on the page; never throws (a failure keeps the classical result).
 */
export async function flattenPage(p: ScanPage): Promise<NonNullable<ScanPage['ai']>> {
  const key = aiKey(p);
  try {
    const t0 = performance.now();
    const w = await startAi();
    const { ow, oh } = sizeFor(p, 'standard', 1600);
    const turned = p.rot % 2 !== 0;
    const src = await cropSource(p, ow, oh, p.rot);
    const job = { quad: src.quad, bend: src.bend, outW: turned ? oh : ow, outH: turned ? ow : oh, sharpen: 'off' as const, flatten: null };
    const s = await sourceOf(src.bmp, src.region, src.RW, src.RH);
    const r = await aiPost<{ grid: Grid | null; info: AiInfo }>(w, { type: 'flat', src: s, job, force: isCard(p) }, transferOf(s));
    tlog(`ai ${r.info.used ? 'used' : 'not used'} (${r.info.why}) ${r.info.ms}ms`, t0);
    // kept for the unturned page
    return { key, grid: r.grid ? turnGrid(r.grid, (4 - (p.rot % 4)) % 4) : null, info: r.info };
  } catch (e) {
    console.warn('scan AI flattening unavailable', e);
    return { key, grid: null, info: { ran: false, used: false, why: 'unavailable on this device' } };
  }
}
