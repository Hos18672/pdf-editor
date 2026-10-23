// The scanner's AI step (src/ui/scan/dewarp.ts) under Node for the benchmark: the same code and the
// same WebAssembly runtime as the app's AI worker, with the model from public/scan.
import { join } from 'node:path';

/** Node test runner: the same step with the model from disk (onnxruntime-web on WebAssembly). */
export async function nodeDewarp(src: string, job: any, modelPath: string): Promise<{ job: { grid: any }; info: any }> {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const req = createRequire(join(import.meta.dirname, '../../package.json'));
  const ort = req('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmBinary ??= readFileSync(req.resolve('onnxruntime-web').replace(/[^/\\]*$/, '') + 'ort-wasm-simd-threaded.wasm');
  const g = globalThis as any;
  g.__uvdoc ??= await ort.InferenceSession.create(readFileSync(modelPath), { executionProviders: ['wasm'] });
  const { scanKernels } = await import(join(src, 'kernels.ts'));
  const { aiFlatten, MODEL_H, MODEL_W } = await import(join(src, 'dewarp.ts'));
  const K = (g.__k ??= scanKernels());
  const r = await aiFlatten(K, job, async (x: Float32Array) => {
    const o = await g.__uvdoc.run({ img: new ort.Tensor('float32', x, [1, 3, MODEL_H, MODEL_W]) });
    return o.grid.data as Float32Array;
  }, process.env.FORCE_AI === 'use' ? 'use' : !!process.env.FORCE_AI);
  return { job: { grid: r.grid }, info: r.info };
}
