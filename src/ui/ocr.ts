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

type Seg = { x0: number; x1: number; y0: number; y1: number };

/**
 * Table borders and other ruled lines of a page picture. `clean` is the picture with them painted
 * white (recognition then reads cells instead of "|" signs and whole rows); `cut` tells whether a
 * vertical border runs between two points of a line, so the line is split into its cells there.
 * `s` is pixels per point.
 */
export function findRules(gray: Uint8Array, w: number, h: number, thr: number, s: number) {
  // shortest border: longer than any letter stroke (upright) or any run of touching letters (across)
  const LV = Math.max(12, Math.round(20 * s)), LH = Math.max(24, Math.round(40 * s));
  const T = Math.max(3, Math.round(3.5 * s)); // thickest border: thicker is a filled box or a picture
  // unbroken dark runs along one direction, joined across neighbouring rows / columns into segments
  const scan = (vertical: boolean): Seg[] => {
    const n = vertical ? w : h, m = vertical ? h : w;
    const L = vertical ? LV : LH;
    const step = vertical ? w : 1;
    const done: Seg[] = [];
    let open: Seg[] = [];
    for (let a = 0; a < n; a++) {
      const next: Seg[] = [];
      const base = vertical ? a : a * w;
      let b = 0;
      while (b < m) {
        if (gray[base + b * step] >= thr) { b++; continue; }
        let e = b + 1;
        while (e < m && gray[base + e * step] < thr) e++;
        if (e - b >= L) {
          const o = open.find((g) => (vertical ? g.y0 <= e && g.y1 >= b : g.x0 <= e && g.x1 >= b));
          if (o) {
            open = open.filter((g) => g !== o);
            if (vertical) { o.x1 = a; o.y0 = Math.min(o.y0, b); o.y1 = Math.max(o.y1, e - 1); }
            else { o.y1 = a; o.x0 = Math.min(o.x0, b); o.x1 = Math.max(o.x1, e - 1); }
            next.push(o);
          } else next.push(vertical ? { x0: a, x1: a, y0: b, y1: e - 1 } : { x0: b, x1: e - 1, y0: a, y1: a });
        }
        b = e;
      }
      done.push(...open);
      open = next;
    }
    done.push(...open);
    return done.filter((g) => (vertical ? g.x1 - g.x0 : g.y1 - g.y0) < T);
  };
  const vs = scan(true), hs = scan(false);
  const clean = gray.slice();
  for (const g of [...vs, ...hs]) {
    for (let y = Math.max(0, g.y0 - 1); y <= Math.min(h - 1, g.y1 + 1); y++) {
      for (let x = Math.max(0, g.x0 - 1); x <= Math.min(w - 1, g.x1 + 1); x++) if (clean[y * w + x] < 235) clean[y * w + x] = 255;
    }
  }
  /** a vertical border between x = xa..xb that covers most of rows ya..yb */
  const cut = (xa: number, xb: number, ya: number, yb: number) =>
    vs.some((g) => g.x1 >= xa && g.x0 <= xb && Math.min(g.y1, yb) - Math.max(g.y0, ya) >= (yb - ya) * 0.5);
  return { clean, cut, vertical: vs, horizontal: hs };
}

/**
 * Lines of a recognition result; `toPdf` maps image pixels to PDF user space. A line that runs over
 * several table cells (a border between, or a wide gap like between columns) comes back as one line
 * per cell. `cut` (image px) tells where a vertical border is.
 */
export function linesOf(data: any, toPdf: (x: number, y: number) => [number, number], ptPerPx: number,
  cut?: (xa: number, xb: number, ya: number, yb: number) => boolean): OcrLine[] {
  const out: OcrLine[] = [];
  for (const block of data.blocks ?? []) for (const para of block.paragraphs ?? []) for (const line of para.lines ?? []) {
    const words = (line.words ?? [])
      .filter((w: any) => w.text?.trim() && w.confidence > 25 && !/^[|¦│]+$/.test(w.text.trim()))
      .sort((a: any, b: any) => a.bbox.x0 - b.bbox.x0);
    if (!words.length) continue;
    // baseline (image px): tesseract's line baseline, else the bottom of letters without descenders
    const bl = line.baseline && line.baseline.x1 > line.baseline.x0 ? line.baseline : null;
    const yAt = (x: number) => (bl ? bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / (bl.x1 - bl.x0) : line.bbox.y1);
    // size from the cap / ascender height: the top of words with capitals, digits or tall letters
    const capOf = (ws: any[]) => {
      const tall = ws.filter((w: any) => /[A-ZÄÖÜ0-9bdfhklß]/.test(w.text));
      if (!tall.length && ws !== words) return null;
      const tops = (tall.length ? tall : ws).map((w: any) => w.bbox.y0).sort((a: number, b: number) => a - b);
      const l = Math.min(...ws.map((w: any) => w.bbox.x0)), r = Math.max(...ws.map((w: any) => w.bbox.x1));
      return Math.max(4, yAt((l + r) / 2) - tops[Math.floor(tops.length / 2)]);
    };
    const lineCap = capOf(words)!;
    const em = lineCap / 0.72;
    // cells: split where a border runs between two words, or where the gap is far wider than a space
    const parts: any[][] = [[words[0]]];
    for (let i = 1; i < words.length; i++) {
      const a = words[i - 1], b = words[i];
      const ya = Math.min(a.bbox.y0, b.bbox.y0), yb = Math.max(a.bbox.y1, b.bbox.y1);
      const gap = b.bbox.x0 - a.bbox.x1;
      if (gap > em * 1.5 || (cut && gap > 0 && cut(a.bbox.x1, b.bbox.x0, ya, yb))) parts.push([b]);
      else parts[parts.length - 1].push(b);
    }
    for (const ws of parts) {
      const text = ws.map((w: any) => w.text.trim()).join(' ');
      const left = Math.min(...ws.map((w: any) => w.bbox.x0)), right = Math.max(...ws.map((w: any) => w.bbox.x1));
      const capPx = parts.length > 1 ? capOf(ws) ?? lineCap : lineCap;
      const [x0, y0] = toPdf(left, yAt(left));
      const [x1, y1] = toPdf(right, yAt(right));
      const conf = ws.reduce((s: number, w: any) => s + w.confidence, 0) / ws.length;
      const top = Math.min(...ws.map((w: any) => w.bbox.y0)), bottom = Math.max(...ws.map((w: any) => w.bbox.y1));
      out.push({ text, x0, y0, x1, y1, size: (capPx / 0.72) * ptPerPx, box: { x0: left, y0: Math.min(top, line.bbox.y0), x1: right, y1: Math.max(bottom, line.bbox.y1) }, conf });
    }
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
  const rules = findRules(gray, canvas.width, canvas.height, grayThreshold(gray), 1 / ptPerPx);
  const { data } = await worker.recognize(toPgm(rules.clean, canvas.width, canvas.height), {}, { blocks: true, text: false, hocr: false, tsv: false });
  return linesOf(data, toPdf, ptPerPx, rules.cut);
}

/** Otsu threshold of a grey image (sampled), kept on the dark side: shadows and paper texture are not ink. */
export function grayThreshold(g: Uint8Array): number {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor(g.length / 400000));
  let n = 0;
  for (let i = 0; i < g.length; i += step) { hist[g[i]]++; n++; }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return Math.min(thr, 200);
}
