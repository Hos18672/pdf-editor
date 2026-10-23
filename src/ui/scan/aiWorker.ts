// The scanner's AI worker (built into public/scan/ai.js by `npm run build:worker`): flattens curved
// pages with the UVDoc model (see dewarp.ts). Started only when a page looks bent; the engine hands it
// the WebAssembly runtime and the model as bytes (file:// pages can't fetch from a worker).
//   init — { wasm, model } → ready
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

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmBinary = m.wasm;
      const t0 = Date.now();
      session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
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
