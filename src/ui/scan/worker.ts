// The scanner's worker (built into public/scan/worker.js by `npm run build:worker`, plain modern JS
// that runs the same in the browser and in the Android app). Jobs:
//   live    — find the page in a small camera frame
//   find    — find and refine the page in a photo (two sizes)
//   process — crop, straighten, clean up a page (optionally read the text direction)
import { scanKernels } from './kernels';
import { detectKernels } from './detect';
import { orientKernels } from './orient';

type Img = { w: number; h: number; data: Uint8ClampedArray };
const K = scanKernels(), D = detectKernels(), O = orientKernels();
const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

function px(s: { img?: Img; bmp?: ImageBitmap }): Img {
  if (s.img) return s.img;
  const b = s.bmp!;
  const c = new OffscreenCanvas(b.width, b.height);
  const x = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  x.drawImage(b, 0, 0);
  b.close();
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}

function shrink(im: Img, max: number): Img {
  const k = Math.max(1, Math.ceil(Math.max(im.w, im.h) / max));
  if (k === 1) return im;
  const w = Math.floor(im.w / k), h = Math.floor(im.h / k), o = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * k * im.w + x * k) * 4, j = (y * w + x) * 4;
    o[j] = im.data[i]; o[j + 1] = im.data[i + 1]; o[j + 2] = im.data[i + 2]; o[j + 3] = 255;
  }
  return { w, h, data: o };
}

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'live') {
      const im: Img = m.img, d = im.data;
      let s = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; n++; }
      ctx.postMessage({ id: m.id, r: { det: D.detectQuad(im, m.opts), mean: n ? s / n : 0 } });
    } else if (m.type === 'process') {
      m.job.src = px(m.src);
      const r = K.process(m.job);
      const o = m.orient ? O.textOrientation(shrink(r.img, 1000)) : undefined;
      ctx.postMessage({ id: m.id, r: { img: r.img, blur: r.blur, times: r.times, orient: o } }, [r.img.data.buffer]);
    } else if (m.type === 'find') {
      const s = px(m.small), d = D.detectQuad(s, m.opts);
      let q: { x: number; y: number }[] | null = null;
      if (d) {
        const md = px(m.mid), k = md.w / s.w;
        q = D.refineQuad(D.luminance(md), md.w, md.h, d.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as any)
          .map((p) => ({ x: p.x / md.w, y: p.y / md.h }));
      } else if (m.mid.bmp) m.mid.bmp.close();
      ctx.postMessage({ id: m.id, r: { det: d, quad: q } });
    }
  } catch (err: any) {
    ctx.postMessage({ id: m.id, err: String(err?.stack || err) });
  }
};
