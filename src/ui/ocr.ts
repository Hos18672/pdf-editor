// On-device text recognition (tesseract.js, LSTM models, German + English). Everything ships with
// the app (public/tesseract) and is loaded only when needed; nothing is sent anywhere.
import { appBase } from './assets';
import type { LayerLine } from '../engine/textLayer';

/** Reads a file next to the app. XHR, because fetch() can't read file:// pages (Android app). */
function loadBytes(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? resolve(new Uint8Array(x.response)) : reject(new Error(`Could not load ${url}`)));
    x.onerror = () => reject(new Error(`Could not load ${url}`));
    x.send();
  });
}

// smallest valid module using a SIMD instruction (same test as wasm-feature-detect)
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const hasSimd = () => { try { return WebAssembly.validate(SIMD_TEST); } catch { return false; } };

type Worker = { recognize: (img: any, opts?: any, out?: any) => Promise<{ data: any }>; terminate: () => Promise<any> };
let engine: Promise<Worker> | null = null;

/**
 * Starts the recognition worker. The engine script and the worker script are joined into one blob,
 * so the worker never has to import files itself (file:// pages can't do that from a worker), and
 * the language data is handed over directly.
 */
export function loadOcr(progress?: (p: number) => void): Promise<Worker> {
  if (!engine) {
    engine = (async () => {
      const base = appBase() + 'tesseract/';
      const core = hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      let done = 0;
      const step = <T,>(p: Promise<T>) => p.then((v) => { done++; progress?.(done / 5); return v; });
      const [coreJs, workerJs, deu, eng] = await Promise.all([
        step(loadBytes(base + core)), step(loadBytes(base + 'worker.min.js')),
        // gzip data under a neutral name: Android's build unpacks *.gz assets and renames them
        step(loadBytes(base + 'deu-lstm.bin')), step(loadBytes(base + 'eng-lstm.bin')),
      ]);
      // language files are served to the worker from in-memory blob URLs (its own fetches would hit file://)
      const langUrl = (b: Uint8Array) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/gzip' }));
      const shim = `(function(){var L=${JSON.stringify({ deu: langUrl(deu), eng: langUrl(eng) })};var f=self.fetch.bind(self);` +
        `self.fetch=function(u,o){var s=String(u&&u.url||u);for(var k in L){var n='/'+k+'.traineddata.gz';if(s.slice(-n.length)===n)return f(L[k]);}return f(u,o);};})();\n`;
      const blob = new Blob([shim, coreJs as BlobPart, '\n;\n', workerJs as BlobPart], { type: 'application/javascript' });
      const workerPath = URL.createObjectURL(blob);
      const { createWorker } = await import('tesseract.js');
      // createWorker never settles when the worker fails: turn its errors into a rejection
      let fail: (e: any) => void = () => {};
      const failed = new Promise<never>((_, rej) => { fail = rej; });
      const w = await Promise.race([createWorker('deu+eng', 1 /* LSTM only */, {
        workerPath, workerBlobURL: false, corePath: base + core, langPath: 'https://local.invalid/tessdata',
        cacheMethod: 'none', gzip: true, errorHandler: (e: any) => { console.warn('ocr', e); fail(e); },
      } as any), failed]);
      progress?.(1);
      return w as unknown as Worker;
    })().catch((e) => { engine = null; throw e; });
  }
  return engine;
}

export async function stopOcr() {
  const e = engine;
  engine = null;
  if (e) (await e.catch(() => null))?.terminate().catch(() => null);
}

/**
 * Recognises the text on a canvas. `toPdf` maps canvas pixels to PDF user space and `ptPerPx` is the
 * scale between them; lines come back ready for an invisible text layer.
 */
export async function recognizeCanvas(worker: Worker, canvas: HTMLCanvasElement, toPdf: (x: number, y: number) => [number, number], ptPerPx: number): Promise<LayerLine[]> {
  const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false, hocr: false, tsv: false });
  const out: LayerLine[] = [];
  for (const block of data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) {
    const words = (line.words ?? []).filter((w: any) => w.text?.trim() && w.confidence > 25);
    if (!words.length) continue;
    const text = words.map((w: any) => w.text.trim()).join(' ');
    // baseline (image px): tesseract's line baseline, else the bottom of letters without descenders
    const bl = line.baseline && line.baseline.x1 > line.baseline.x0 ? line.baseline : null;
    const left = Math.min(...words.map((w: any) => w.bbox.x0)), right = Math.max(...words.map((w: any) => w.bbox.x1));
    const yAt = (x: number) => (bl ? bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / (bl.x1 - bl.x0) : line.bbox.y1);
    // size from the cap / ascender height: the top of words with capitals, digits or tall letters
    const tall = words.filter((w: any) => /[A-ZÄÖÜ0-9bdfhklß]/.test(w.text));
    const tops = (tall.length ? tall : words).map((w: any) => w.bbox.y0).sort((a: number, b: number) => a - b);
    const top = tops[Math.floor(tops.length / 2)];
    const capPx = Math.max(4, yAt((left + right) / 2) - top);
    const [x0, y0] = toPdf(left, yAt(left));
    const [x1, y1] = toPdf(right, yAt(right));
    out.push({ text, x0, y0, x1, y1, size: (capPx / 0.72) * ptPerPx });
  }
  return out;
}

/**
 * Recognises one page and returns its lines in PDF user space, ready for an invisible text layer.
 * The page is rendered at about 300 dpi (capped for memory on phones).
 */
export async function recognizePage(worker: Worker, pdf: any, pageNo: number): Promise<LayerLine[]> {
  const page = await pdf.getPage(pageNo + 1);
  const base = page.getViewport({ scale: 1 });
  // ~200 dpi: plenty for printed text, and much faster than 300 on phones
  const scale = Math.min(300 / 72, 2300 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const out = await recognizeCanvas(worker, canvas, (x, y) => vp.convertToPdfPoint(x, y), 1 / scale);
  canvas.width = canvas.height = 0;
  return out;
}
