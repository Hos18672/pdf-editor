// The scanner's AI worker (built into public/scan/ai.js by `npm run build:worker`): flattens curved
// pages with the UVDoc model (see dewarp.ts). Started only when a page looks bent; the engine hands it
// the WebAssembly runtime and the model as bytes (file:// pages can't fetch from a worker).
//   init — { wasm, model, weights } → ready (the model's weights come 8-bit, see scripts/quant-uvdoc.py)
//   flat — { src, job } → { grid, info }
import * as ort from 'onnxruntime-web/wasm';
import { scanKernels } from './kernels';
import { aiFlatten, MODEL_H, MODEL_W } from './dewarp';

const ctx = self as unknown as { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };
const K = scanKernels();
let session: ort.InferenceSession | null = null;

function px(s: { img?: { w: number; h: number; data: Uint8ClampedArray }; bmp?: ImageBitmap }) {
  if (s.img) return s.img;
  const b = s.bmp!;
  const c = new OffscreenCanvas(b.width, b.height);
  const x = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  x.drawImage(b, 0, 0);
  b.close();
  return { w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}

const half = (h: number) => {
  const e = (h >> 10) & 31, f = h & 1023, s = h & 0x8000 ? -1 : 1;
  return e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
};
/** the model's 32-bit weights, from the 8-bit ones and their scales (uvdoc.q8) */
function weights(buf: ArrayBuffer): Uint8Array {
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x38515655) throw new Error('weights'); // "UVQ8"
  const g = v.getUint32(4, true), k = v.getUint32(8, true);
  const counts: number[] = [];
  for (let i = 0; i < k; i++) counts.push(v.getUint32(12 + 4 * i, true));
  const total = counts.reduce((a, b) => a + b, 0);
  const out = new Float32Array(total);
  let q = 12 + 4 * k;
  let sOff = q + counts.reduce((a, n) => a + Math.ceil(n / g) * g, 0);
  const q8 = new Int8Array(buf);
  let o = 0;
  for (const n of counts) {
    const groups = Math.ceil(n / g);
    for (let gi = 0; gi < groups; gi++) {
      const sc = half(v.getUint16(sOff + gi * 2, true));
      const end = Math.min(g, n - gi * g);
      for (let j = 0; j < end; j++) out[o + gi * g + j] = q8[q + gi * g + j] * sc;
    }
    o += n; q += groups * g; sOff += groups * 2;
  }
  return new Uint8Array(out.buffer);
}

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmBinary = m.wasm;
      const t0 = Date.now();
      session = await ort.InferenceSession.create(new Uint8Array(m.model), {
        executionProviders: ['wasm'], graphOptimizationLevel: 'all', externalData: [{ path: 'uvdoc.w', data: weights(m.weights) }],
      });
      ctx.postMessage({ id: m.id, r: { ms: Date.now() - t0 } });
    } else if (m.type === 'flat') {
      if (!session) throw new Error('model not loaded');
      const job = { ...m.job, src: px(m.src) };
      const r = await aiFlatten(K, job, async (x) => {
        const o = await session!.run({ img: new ort.Tensor('float32', x, [1, 3, MODEL_H, MODEL_W]) });
        return o.grid.data as Float32Array;
      }, !!m.force);
      ctx.postMessage({ id: m.id, r });
    }
  } catch (err: any) {
    ctx.postMessage({ id: m.id, err: String(err?.stack || err) });
  }
};
