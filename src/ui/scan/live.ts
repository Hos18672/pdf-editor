// Live page finding for the camera preview, in a Web Worker so the preview and buttons stay smooth.
import { detectKernels, detectQuad, type Detection, type Rgba } from './detect';

export interface LiveResult { det: Detection | null; mean: number }

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, (r: LiveResult) => void>();

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  try {
    const code = `var D=(${detectKernels.toString()})();self.onmessage=function(e){var im=e.data.img,d=im.data,s=0,n=0;for(var i=0;i<d.length;i+=16){s+=d[i]*0.3+d[i+1]*0.59+d[i+2]*0.11;n++;}var r=null;try{r=D.detectQuad(im,e.data.opts);}catch(err){}self.postMessage({id:e.data.id,det:r,mean:n?s/n:0});};`;
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    worker.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.({ det: e.data.det, mean: e.data.mean }); };
    worker.onerror = (e) => {
      console.warn('live worker failed', e.message);
      broken = true; worker?.terminate(); worker = null;
      for (const [, f] of waiting) f({ det: null, mean: 128 });
      waiting.clear();
    };
  } catch { broken = true; worker = null; }
  return worker;
}

export function liveDetect(img: Rgba, opts: { ratios?: number[] }): Promise<LiveResult> {
  const w = getWorker();
  if (!w) {
    const d = img.data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 16) { s += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; n++; }
    return Promise.resolve({ det: detectQuad(img, { live: true, ...opts }), mean: n ? s / n : 0 });
  }
  return new Promise((res) => {
    const id = ++seq;
    waiting.set(id, res);
    w.postMessage({ id, img, opts: { live: true, ...opts } }, [img.data.buffer as ArrayBuffer]);
  });
}

export function stopLive() {
  worker?.terminate(); worker = null;
  for (const [, f] of waiting) f({ det: null, mean: 128 });
  waiting.clear();
}
