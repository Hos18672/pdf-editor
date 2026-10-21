// On-device text recognition (tesseract.js, fast LSTM models, German + English). Everything ships with
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

export type OcrWorker = { recognize: (img: any, opts?: any, out?: any) => Promise<{ data: any }>; terminate: () => Promise<any> };

let assets: Promise<{ workerPath: string; corePath: string }> | null = null;

/**
 * The engine script and the worker script joined into one blob, so a worker never has to import
 * files itself (file:// pages can't do that from a worker); the language data is handed over from
 * memory. Loaded once and shared by every worker.
 */
function loadAssets(progress?: (p: number) => void) {
  if (!assets) {
    assets = (async () => {
      const base = appBase() + 'tesseract/';
      const core = hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js';
      let done = 0;
      const step = <T,>(p: Promise<T>) => p.then((v) => { done++; progress?.(done / 4); return v; });
      const [coreJs, workerJs, deu, eng] = await Promise.all([
        step(loadBytes(base + core)), step(loadBytes(base + 'worker.min.js')),
        // gzip data under a neutral name: Android's build unpacks *.gz assets and renames them
        step(loadBytes(base + 'deu-fast.bin')), step(loadBytes(base + 'eng-fast.bin')),
      ]);
      const langUrl = (b: Uint8Array) => URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/gzip' }));
      const shim = `(function(){var L=${JSON.stringify({ deu: langUrl(deu), eng: langUrl(eng) })};var f=self.fetch.bind(self);` +
        `self.fetch=function(u,o){var s=String(u&&u.url||u);for(var k in L){var n='/'+k+'.traineddata.gz';if(s.slice(-n.length)===n)return f(L[k]);}return f(u,o);};})();\n`;
      const blob = new Blob([shim, coreJs as BlobPart, '\n;\n', workerJs as BlobPart], { type: 'application/javascript' });
      return { workerPath: URL.createObjectURL(blob), corePath: base + core };
    })().catch((e) => { assets = null; throw e; });
  }
  return assets;
}

/** Starts one recognition worker (a few hundred ms once the files are loaded). */
export async function newOcrWorker(progress?: (p: number) => void): Promise<OcrWorker> {
  const { workerPath, corePath } = await loadAssets(progress);
  const { createWorker } = await import('tesseract.js');
  // createWorker never settles when the worker fails: turn its errors into a rejection
  let fail: (e: any) => void = () => {};
  const failed = new Promise<never>((_, rej) => { fail = rej; });
  const w = await Promise.race([createWorker('deu+eng', 1 /* LSTM only */, {
    workerPath, workerBlobURL: false, corePath, langPath: 'https://local.invalid/tessdata',
    cacheMethod: 'none', gzip: true, errorHandler: (e: any) => { console.warn('ocr', e); fail(e); },
  } as any), failed]);
  progress?.(1);
  return w as unknown as OcrWorker;
}

let shared: Promise<OcrWorker> | null = null;

/** A shared worker for one-off jobs (scanner). */
export function loadOcr(progress?: (p: number) => void): Promise<OcrWorker> {
  if (!shared) shared = newOcrWorker(progress).catch((e) => { shared = null; throw e; });
  return shared;
}

export async function stopOcr() {
  const e = shared;
  shared = null;
  if (e) (await e.catch(() => null))?.terminate().catch(() => null);
}

/** Grey pixels as a binary PGM: the engine reads it directly (no PNG encoding / decoding). */
export function toPgm(gray: Uint8Array, w: number, h: number, y0 = 0, y1 = h): Uint8Array {
  const head = new TextEncoder().encode(`P5\n${w} ${y1 - y0}\n255\n`);
  const out = new Uint8Array(head.length + w * (y1 - y0));
  out.set(head, 0);
  out.set(gray.subarray(y0 * w, y1 * w), head.length);
  return out;
}

export function grayOf(rgba: Uint8ClampedArray): Uint8Array {
  const g = new Uint8Array(rgba.length >> 2);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return g;
}

export interface OcrLine extends LayerLine {
  /** image box (px) of the line */
  box: { x0: number; y0: number; x1: number; y1: number };
  conf: number;
}

/** Lines of a recognition result; `toPdf` maps image pixels to PDF user space. */
export function linesOf(data: any, toPdf: (x: number, y: number) => [number, number], ptPerPx: number): OcrLine[] {
  const out: OcrLine[] = [];
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
    const conf = words.reduce((s: number, w: any) => s + w.confidence, 0) / words.length;
    out.push({ text, x0, y0, x1, y1, size: (capPx / 0.72) * ptPerPx, box: { x0: left, y0: line.bbox.y0, x1: right, y1: line.bbox.y1 }, conf });
  }
  return out;
}

/**
 * Recognises the text on a canvas. `toPdf` maps canvas pixels to PDF user space and `ptPerPx` is the
 * scale between them; lines come back ready for an invisible text layer.
 */
export async function recognizeCanvas(worker: OcrWorker, canvas: HTMLCanvasElement, toPdf: (x: number, y: number) => [number, number], ptPerPx: number): Promise<LayerLine[]> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const gray = grayOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  const { data } = await worker.recognize(toPgm(gray, canvas.width, canvas.height), {}, { blocks: true, text: false, hocr: false, tsv: false });
  return linesOf(data, toPdf, ptPerPx);
}
