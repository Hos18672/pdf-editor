// Live page finding for the camera preview, in a Web Worker so the preview and buttons stay smooth.
import { detectQuad, type Detection, type Rgba } from './detect';
import { workerUrl } from './workerUrl';

export interface LiveResult { det: Detection | null; mean: number }

let worker: Promise<Worker | null> | null = null;
let seq = 0;
const waiting = new Map<number, (r: LiveResult) => void>();

function getWorker(): Promise<Worker | null> {
  worker ??= workerUrl().then((url) => {
    const w = new Worker(url);
    w.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data.r ?? { det: null, mean: 128 }); };
    w.onerror = (e) => {
      console.warn('live worker failed', e.message);
      w.terminate(); worker = Promise.resolve(null);
      for (const [, f] of waiting) f({ det: null, mean: 128 });
      waiting.clear();
    };
    return w;
  }).catch(() => null);
  return worker;
}

const here = (img: Rgba, opts: { ratios?: number[] }): LiveResult => {
  const d = img.data;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) { s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; n++; }
  return { det: detectQuad(img, { live: true, ...opts }), mean: n ? s / n : 0 };
};

export async function liveDetect(img: Rgba, opts: { ratios?: number[] }): Promise<LiveResult> {
  const w = await getWorker();
  if (!w) return here(img, opts);
  return new Promise((res) => {
    const id = ++seq;
    waiting.set(id, res);
    w.postMessage({ type: 'live', id, img, opts: { live: true, ...opts } }, [img.data.buffer as ArrayBuffer]);
  });
}

export function stopLive() {
  worker?.then((w) => w?.terminate()); worker = null;
  for (const [, f] of waiting) f({ det: null, mean: 128 });
  waiting.clear();
}
