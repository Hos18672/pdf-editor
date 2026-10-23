// The scanner's worker (built into public/scan/worker.js by `npm run build:worker`, plain modern JS
// that runs the same in the browser and in the Android app). Jobs:
//   live    — find the page in a small camera frame
//   find    — find and refine the page in a photo (two sizes), and follow curved sides
//   prep    — crop and straighten a page, measure and undo blur (kept by the caller for any look)
//   look    — apply a look to a straightened page, turn it, encode it (optionally read the text direction)
//   thumbs  — small previews of every look at once
//   process — all of it in one go (pages at saving quality)
import { scanKernels, type Filter } from './kernels';
import { detectKernels } from './detect';
import { orientKernels } from './orient';
import { traceBend } from './bend';

type Img = { w: number; h: number; data: Uint8ClampedArray };
const K = scanKernels(), D = detectKernels(), O = orientKernels();
const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
const canEncode = typeof OffscreenCanvas !== 'undefined' && typeof (OffscreenCanvas.prototype as any).convertToBlob === 'function';

function px(s: { img?: Img; bmp?: ImageBitmap }): Img {
  if (s.img) return s.img;
  const b = s.bmp!;
  const c = new OffscreenCanvas(b.width, b.height);
  const x = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  x.drawImage(b, 0, 0);
  b.close();
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}

function shrinkFast(im: Img, max: number): Img {
  const k = Math.max(1, Math.ceil(Math.max(im.w, im.h) / max));
  if (k === 1) return im;
  const w = Math.floor(im.w / k), h = Math.floor(im.h / k), o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * k * im.w + x * k) * 4, j = (y * w + x) * 4;
    o[j] = im.data[i]; o[j + 1] = im.data[i + 1]; o[j + 2] = im.data[i + 2]; o[j + 3] = 255;
  }
  return { w, h, data: o };
}

/** JPEG here when the worker can (keeps the screen free); otherwise the pixels go back */
async function out(img: Img, jpeg: number | undefined): Promise<{ r: any; t: Transferable[] }> {
  if (jpeg && canEncode) {
    try {
      const c = new OffscreenCanvas(img.w, img.h);
      (c.getContext('2d') as OffscreenCanvasRenderingContext2D).putImageData(new ImageData(img.data as any, img.w, img.h), 0, 0);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: jpeg });
      return { r: { blob, w: img.w, h: img.h }, t: [] };
    } catch { /* fall through */ }
  }
  return { r: { img }, t: [img.data.buffer] };
}

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'live') {
      const im: Img = m.img, d = im.data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; n++; }
      ctx.postMessage({ id: m.id, r: { det: D.detectQuad(im, m.opts), mean: n ? s / n : 0 } });
    } else if (m.type === 'prep') {
      m.job.src = px(m.src);
      const p = K.prepare(m.job);
      const t: Transferable[] = [p.warped.data.buffer];
      if (p.sharp) t.push(p.sharp.data.buffer);
      ctx.postMessage({ id: m.id, r: p }, t);
    } else if (m.type === 'look') {
      const img = K.finish(m.img, m.filter, m.blur, m.radius, m.rot, !!m.card, m.erase);
      const o = m.orient ? O.textOrientation(shrinkFast(img, 1000)) : undefined;
      const r = await out(img, m.jpeg);
      ctx.postMessage({ id: m.id, r: { ...r.r, orient: o } }, r.t);
    } else if (m.type === 'thumbs') {
      const small = K.shrink(m.img, m.max);
      const k = small.w / m.img.w;
      const items: any[] = [], t: Transferable[] = [];
      for (const f of m.filters as Filter[]) {
        const copy = { w: small.w, h: small.h, data: new Uint8ClampedArray(small.data) };
        const r = await out(K.finish(copy, f, m.blur * k, f === 'original' ? 0 : m.radius * k, m.rot, !!m.card, m.erase), m.jpeg);
        items.push({ filter: f, ...r.r }); t.push(...r.t);
      }
      ctx.postMessage({ id: m.id, r: { items } }, t);
    } else if (m.type === 'process') {
      m.job.src = px(m.src);
      const r = K.process(m.job);
      const o = m.orient ? O.textOrientation(shrinkFast(r.img, 1000)) : undefined;
      const enc = await out(r.img, m.jpeg);
      ctx.postMessage({ id: m.id, r: { ...enc.r, blur: r.blur, times: r.times, orient: o } }, enc.t);
    } else if (m.type === 'find') {
      const s = px(m.small), d = D.detectQuad(s, m.opts);
      let q: { x: number; y: number }[] | null = null, bend: number[][] | null = null;
      if (d) {
        const md = px(m.mid), k = md.w / s.w, L = D.luminance(md);
        const rq = D.refineQuad(L, md.w, md.h, d.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as any);
        let fq = rq as { x: number; y: number }[];
        if (m.bend) {
          const b = traceBend(L, md.w, md.h, rq);
          if (b) { fq = b.quad; bend = b.bend.map((a) => a.map((v, i) => v / (i % 2 ? md.h : md.w))); }
        }
        q = fq.map((p) => ({ x: p.x / md.w, y: p.y / md.h }));
      } else if (m.mid.bmp) m.mid.bmp.close();
      ctx.postMessage({ id: m.id, r: { det: d, quad: q, bend } });
    }
  } catch (err: any) {
    ctx.postMessage({ id: m.id, err: String(err?.stack || err) });
  }
};
