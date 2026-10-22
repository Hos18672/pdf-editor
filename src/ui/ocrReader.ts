// Reads the text of picture pages (scans) on demand, so their lines can be edited like real text.
// A tap reads just the line under the finger (well under a second); pages are read in the
// background in small bands, visible page first, so taps never wait behind a whole page.
// Results stay in memory as editable runs; nothing is uploaded.
import type { TextRun } from '../engine/pdfText';
import type { M } from '../engine/types';
import type { FontInfo } from '../engine/pdfText';
import { runBox, sampleColors } from './geometry';
import { newOcrWorker, OcrWorker, grayOf, toPgm, linesOf, OcrLine, findRules, grayThreshold } from './ocr';

export const OCR_FONT = 'ocr';
export const isOcrRun = (r: TextRun) => r.fontName === OCR_FONT;
/** stand-in font for recognised lines (their letters are part of a picture) */
export const OCR_FONT_INFO: FontInfo = {
  loadedName: 'Arial', name: 'Scan', charMap: {}, display: {}, gids: {},
  fallback: { family: 'Helvetica', bold: false, italic: false }, cssFallback: 'Arial, Helvetica, sans-serif',
};

type Colors = Record<string, { bg: string; fg: string }>;

export interface ReaderState {
  /** pages being read right now */
  reading: number[];
  /** pages read completely */
  done: number[];
  /** pages waiting to be read */
  queued: number[];
  /** line being read after a tap (viewport units) */
  tap: { src: number; y0: number; y1: number } | null;
  failed: boolean;
}

interface PageImg {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  /** grey picture with table borders painted out (what is read) */
  gray: Uint8Array;
  /** a table border runs between two points of a line (image px) */
  cut: (xa: number, xb: number, ya: number, yb: number) => boolean;
  w: number; h: number; s: number; thr: number;
  toPdf: (x: number, y: number) => [number, number];
}

interface Band { y0: number; y1: number; state: 'todo' | 'busy' | 'done' }

interface PageState {
  img?: Promise<PageImg>;
  users: number;
  runs: TextRun[];
  seq: number;
  bands?: Band[];
  planning: boolean;
  done: boolean;
  /** priority of reading the whole page (lower first; Infinity = not wanted) */
  wanted: number;
}

type Job = (w: OcrWorker) => Promise<void>;

export class PageReader {
  private pages = new Map<number, PageState>();
  private taps: Job[] = [];
  private workers: Promise<OcrWorker>[] = [];
  private live: OcrWorker[] = [];
  private wake: (() => void)[] = [];
  private disposed = false;
  private tapBand: ReaderState['tap'] = null;
  private failed = false;
  private imgOrder: number[] = [];

  constructor(
    private pdf: any,
    private vmOf: (src: number) => M,
    private onRuns: (src: number, runs: TextRun[], colors: Colors) => void,
    private onState: (s: ReaderState) => void,
  ) {}

  private page(src: number): PageState {
    let st = this.pages.get(src);
    if (!st) { st = { users: 0, runs: [], seq: 0, planning: false, done: false, wanted: Infinity }; this.pages.set(src, st); }
    return st;
  }

  /** Starts the workers (the second one once the first is up). */
  warm() {
    if (this.workers.length || this.disposed) return;
    const n = (navigator.hardwareConcurrency ?? 4) >= 4 ? 2 : 1;
    const start = () => {
      const p = newOcrWorker();
      this.workers.push(p);
      p.then((w) => {
        if (this.disposed) { w.terminate().catch(() => null); return; }
        this.live.push(w);
        this.loop(w);
        if (this.workers.length < n) start();
      }).catch((e) => {
        console.warn('ocr start failed', e);
        this.failed = true;
        this.emit();
        this.taps.splice(0).forEach((j) => j(null as any).catch(() => null));
      });
    };
    start();
  }

  /** Read the whole page, with priority `pri` (lower = sooner). */
  want(src: number, pri: number) {
    const st = this.page(src);
    if (st.done) return;
    st.wanted = pri;
    this.warm();
    this.kick();
    this.emit();
  }

  /** Lower the priority of every waiting page (visible page changed). */
  demote(from: number, to: number) {
    for (const st of this.pages.values()) if (!st.done && st.wanted <= from) st.wanted = to;
  }

  /** Stop reading pages in the background (taps keep working). */
  stop(except?: number) {
    for (const [src, st] of this.pages) if (src !== except && !st.done) st.wanted = Infinity;
    this.emit();
  }

  isDone(src: number) { return !!this.pages.get(src)?.done; }

  /**
   * Reads the line at viewport point (x, y) of page `src`. Resolves with the key of the run there
   * (null: no text at that spot).
   */
  tap(src: number, x: number, y: number, avoid: TextRun[] = []): Promise<string | null> {
    this.warm();
    if (this.failed) return Promise.reject(new Error('ocr unavailable'));
    const st = this.page(src);
    this.tapBand = { src, y0: y - 6, y1: y + 6 };
    this.emit();
    return new Promise<string | null>((resolve, reject) => {
      this.taps.push(async (w) => {
        if (!w) { reject(new Error('ocr unavailable')); return; }
        st.users++;
        try {
          const img = await this.image(src);
          const band = lineBand(img, x * img.s, y * img.s);
          if (!band) { resolve(this.runAt(src, x, y)); return; }
          this.tapBand = { src, y0: band[0] / img.s, y1: band[1] / img.s };
          this.emit();
          // on a page with a text layer, only what the layer is missing is added
          const vm = this.vmOf(src);
          const taken = avoid.map((r) => boxOf(r, vm));
          const by0 = Math.max(0, Math.floor(band[0]));
          await this.readBand(w, src, img, band[0], band[1], true, taken.length ? (l) => {
            const b = { x0: l.box.x0 / img.s, x1: l.box.x1 / img.s, y0: (l.box.y0 + by0) / img.s, y1: (l.box.y1 + by0) / img.s };
            // left out only when the layer already has text over most of it
            const area = Math.max(1e-6, (b.x1 - b.x0) * (b.y1 - b.y0));
            const covered = taken.reduce((a, t) => a + Math.max(0, Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0)) * Math.max(0, Math.min(t.y1, b.y1) - Math.max(t.y0, b.y0)), 0);
            return covered < area * 0.5;
          } : undefined);
          resolve(this.runAt(src, x, y));
        } catch (e) {
          reject(e);
        } finally {
          st.users--;
          if (this.tapBand?.src === src) this.tapBand = null;
          this.emit();
          this.release();
        }
      });
      this.kick();
    });
  }

  /**
   * A line of an existing (invisible) text layer that runs across table borders: reads its cells
   * from the picture. Resolves with the new runs' keys and the one at viewport point (x, y), or
   * null when no border crosses the line (it stays as it is).
   */
  reline(src: number, run: TextRun, x: number, y: number, force = false): Promise<{ keys: string[]; at: string | null } | null> {
    this.warm();
    if (this.failed) return Promise.reject(new Error('ocr unavailable'));
    const st = this.page(src);
    return new Promise((resolve, reject) => {
      this.taps.push(async (w) => {
        if (!w) { reject(new Error('ocr unavailable')); return; }
        st.users++;
        try {
          const img = await this.image(src);
          const b = boxOf(run, this.vmOf(src));
          const s = img.s;
          const X0 = b.x0 * s, X1 = b.x1 * s, Y0 = b.y0 * s, Y1 = b.y1 * s, h = Y1 - Y0;
          if (!(h > 0) || (!force && !img.cut(X0 + h * 0.5, X1 - h * 0.5, Y0 + h * 0.15, Y1 - h * 0.15))) { resolve(null); return; }
          this.tapBand = { src, y0: b.y0, y1: b.y1 };
          this.emit();
          const before = new Set(st.runs.map((r) => r.key));
          // the old line, and the printed line under the finger (a layer line can sit a little off)
          const tx = x * s, ty = y * s;
          const lb = lineBand(img, tx, ty);
          const by0 = Math.max(0, Math.floor(Math.min(Y0 - h * 0.35, lb?.[0] ?? Infinity)));
          const by1 = Math.max(Y1 + h * 0.35, lb?.[1] ?? 0);
          // only what lies on the old line (or right under the finger) replaces it
          await this.readBand(w, src, img, by0, by1, true, (l) => {
            const cx = (l.box.x0 + l.box.x1) / 2, cy = (l.box.y0 + l.box.y1) / 2 + by0;
            const under = tx >= l.box.x0 - 4 && tx <= l.box.x1 + 4 && ty >= l.box.y0 + by0 - 4 && ty <= l.box.y1 + by0 + 4;
            return under || (cx >= X0 - h && cx <= X1 + h && cy >= Y0 && cy <= Y1);
          });
          const keys = st.runs.filter((r) => !before.has(r.key)).map((r) => r.key);
          resolve(keys.length ? { keys, at: this.runAt(src, x, y) } : null);
        } catch (e) {
          reject(e);
        } finally {
          st.users--;
          if (this.tapBand?.src === src) this.tapBand = null;
          this.emit();
          this.release();
        }
      });
      this.kick();
    });
  }

  dispose() {
    this.disposed = true;
    this.wake.splice(0).forEach((f) => f());
    for (const w of this.live) w.terminate().catch(() => null);
    for (const st of this.pages.values()) st.img?.then((i) => { i.canvas.width = i.canvas.height = 0; }).catch(() => null);
  }

  // ---------------------------------------------------------------------------------------------

  private state(): ReaderState {
    const reading: number[] = [], done: number[] = [], queued: number[] = [];
    for (const [src, st] of this.pages) {
      if (st.done) done.push(src);
      else if (st.planning || st.bands?.some((b) => b.state === 'busy')) reading.push(src);
      else if (st.wanted < Infinity) queued.push(src);
    }
    return { reading, done, queued, tap: this.tapBand, failed: this.failed };
  }
  private emit() { if (!this.disposed) this.onState(this.state()); }
  private kick() { this.wake.splice(0).forEach((f) => f()); }

  private async loop(w: OcrWorker) {
    while (!this.disposed) {
      const job = this.pick();
      if (!job) { await new Promise<void>((r) => this.wake.push(r)); continue; }
      try { await job(w); } catch (e) { console.warn('ocr job failed', e); }
    }
  }

  /** Next thing to do: taps first, then the most wanted page's next band. */
  private pick(): Job | null {
    const tap = this.taps.shift();
    if (tap) return tap;
    const order = [...this.pages.entries()].filter(([, st]) => !st.done && st.wanted < Infinity)
      .sort((a, b) => a[1].wanted - b[1].wanted || a[0] - b[0]);
    for (const [src, st] of order) {
      if (!st.bands) {
        if (st.planning) continue;
        st.planning = true;
        return async () => {
          st.users++;
          try {
            const img = await this.image(src);
            st.bands = planBands(img).map(([y0, y1]) => ({ y0, y1, state: 'todo' as const }));
          } catch (e) {
            console.warn('ocr page failed', e);
            st.bands = [];
          } finally {
            st.planning = false;
            st.users--;
            this.finishIfDone(st);
            this.kick();
            this.emit();
          }
        };
      }
      const band = st.bands.find((b) => b.state === 'todo');
      if (!band) continue;
      band.state = 'busy';
      return async (w) => {
        st.users++;
        this.emit();
        try {
          const img = await this.image(src);
          await this.readBand(w, src, img, band.y0, band.y1, false);
        } finally {
          band.state = 'done';
          st.users--;
          this.finishIfDone(st);
          this.emit();
        }
      };
    }
    return null;
  }

  private finishIfDone(st: PageState) {
    if (st.bands && st.bands.every((b) => b.state === 'done')) {
      st.done = true;
      this.release();
    }
  }

  /** The page rendered for reading (~220 dpi), kept while it is being read. */
  private image(src: number): Promise<PageImg> {
    const st = this.page(src);
    if (!st.img) {
      st.img = (async () => {
        const page = await this.pdf.getPage(src + 1);
        const base = page.getViewport({ scale: 1 });
        const s = Math.min(3, 2600 / Math.max(base.width, base.height));
        const vp = page.getViewport({ scale: s });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const raw = grayOf(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
        const thr = grayThreshold(raw);
        const { clean, cut } = findRules(raw, canvas.width, canvas.height, thr, s);
        return {
          canvas, ctx, gray: clean, cut, w: canvas.width, h: canvas.height, s, thr,
          toPdf: (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number],
        };
      })();
      st.img.catch(() => { st.img = undefined; });
      this.imgOrder = [...this.imgOrder.filter((k) => k !== src), src];
    }
    return st.img;
  }

  /** Frees page pictures that are no longer needed (keeps the two most recent while useful). */
  private release() {
    const keep = this.imgOrder.slice(-2);
    for (const src of [...this.imgOrder]) {
      const st = this.pages.get(src);
      if (!st?.img || st.users > 0) continue;
      if (!st.done && keep.includes(src)) continue;
      const p = st.img;
      st.img = undefined;
      this.imgOrder = this.imgOrder.filter((k) => k !== src);
      p.then((i) => { i.canvas.width = i.canvas.height = 0; }).catch(() => null);
    }
  }

  private async readBand(w: OcrWorker, src: number, img: PageImg, y0: number, y1: number, tap: boolean, keep?: (l: OcrLine) => boolean) {
    y0 = Math.max(0, Math.floor(y0));
    y1 = Math.min(img.h, Math.ceil(y1));
    if (y1 - y0 < 4) return;
    const { data } = await w.recognize(toPgm(img.gray, img.w, img.h, y0, y1), {}, { blocks: true, text: false, hocr: false, tsv: false });
    const bandH = y1 - y0;
    const all = linesOf(data, (x, y) => img.toPdf(x, y + y0), 1 / img.s, (xa, xb, ya, yb) => img.cut(xa, xb, ya + y0, yb + y0));
    if ((globalThis as any).__ocrDebug) console.log('ocr band', src, y0, y1, all.map((l) => `${Math.round(l.conf)} ${l.text}`));
    const lines = all.filter((l: OcrLine) => {
      // specks, rules and table borders read as stray symbols
      const t = l.text.replace(/\s/g, '');
      const an = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
      if (an < 1 || an < t.length * 0.5) return false;
      // a single letter or digit (a table cell like "5") only when read clearly
      if (an < 2 && l.conf < 75) return false;
      // a line cut by the band's edge reads as noise
      if (l.conf < 55 && (l.box.y0 <= 1 || l.box.y1 >= bandH - 2)) return false;
      // in the background only lines read with confidence; a tap shows what is there
      return l.conf >= (tap ? 30 : 50) && (!keep || keep(l));
    });
    this.add(src, img, lines);
  }

  private add(src: number, img: PageImg, lines: OcrLine[]) {
    const st = this.page(src);
    const vm = this.vmOf(src);
    const fresh: TextRun[] = [];
    const colors: Colors = {};
    for (const l of lines) {
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      if (!(len > 0) || !(l.size > 0)) continue;
      const run: TextRun = {
        key: `${src}:o${++st.seq}`, page: src, str: l.text.normalize('NFC'), fontName: OCR_FONT,
        region: { o: [l.x0, l.y0], u: [(l.x1 - l.x0) / len, (l.y1 - l.y0) / len], width: len, height: l.size },
      };
      const box = boxOf(run, vm);
      if ([...st.runs, ...fresh].some((r) => overlaps(boxOf(r, vm), box))) continue;
      const b = runBox(run, vm);
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const corners = ([[0, -b.asc], [b.w, -b.asc], [b.w, b.h * 0.3], [0, b.h * 0.3]] as [number, number][])
        .map(([dx, dy]) => [(b.x + dx * c - dy * s) * img.s, (b.y + dx * s + dy * c) * img.s] as [number, number]);
      colors[run.key] = sampleColors(img.ctx, corners);
      fresh.push(run);
    }
    if (!fresh.length) return;
    st.runs.push(...fresh);
    this.onRuns(src, fresh, colors);
  }

  /** The recognised line at a viewport point (or the nearest one on that height). */
  private runAt(src: number, x: number, y: number): string | null {
    const vm = this.vmOf(src);
    let best: string | null = null, bestD = Infinity;
    for (const r of this.page(src).runs) {
      const b = boxOf(r, vm);
      const h = b.y1 - b.y0;
      const dy = y < b.y0 ? b.y0 - y : y > b.y1 ? y - b.y1 : 0;
      const dx = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
      if (dy > h * 0.6 || dx > h * 1.5) continue;
      const d = dy * 4 + dx;
      if (d < bestD) { bestD = d; best = r.key; }
    }
    return best;
  }
}

function boxOf(r: TextRun, vm: M) {
  const b = runBox(r, vm);
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const xs = [0, b.w].flatMap((t) => [b.x + t * c + b.asc * s, b.x + t * c - (b.height - b.asc) * s]);
  const ys = [0, b.w].flatMap((t) => [b.y + t * s - b.asc * c, b.y + t * s + (b.height - b.asc) * c]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function overlaps(a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return false;
  const area = (q: typeof a) => (q.x1 - q.x0) * (q.y1 - q.y0);
  return ix * iy > 0.35 * Math.min(area(a), area(b));
}

/** Dark pixels per row between columns x0..x1. */
function rowInk(img: PageImg, x0: number, x1: number, y0: number, y1: number): Uint32Array {
  const out = new Uint32Array(Math.max(0, y1 - y0));
  const { gray, w, thr } = img;
  for (let y = y0; y < y1; y++) {
    let c = 0;
    const o = y * w;
    for (let x = x0; x < x1; x++) if (gray[o + x] < thr) c++;
    out[y - y0] = c;
  }
  return out;
}

/**
 * The text line under a tap (image px): rows with ink around the tap, cut in the blank gaps above and
 * below. Null when there is nothing printed there.
 */
function lineBand(img: PageImg, tx: number, ty: number): [number, number] | null {
  const s = img.s;
  const x0 = Math.max(0, Math.floor(tx - img.w * 0.22)), x1 = Math.min(img.w, Math.ceil(tx + img.w * 0.22));
  const lo = Math.max(0, Math.floor(ty - 70 * s)), hi = Math.min(img.h, Math.ceil(ty + 70 * s));
  const ink = rowInk(img, x0, x1, lo, hi);
  const blank = Math.max(1, (x1 - x0) * 0.004);
  const at = (y: number) => ink[y - lo] ?? 0;
  let y = Math.round(ty);
  if (at(y) <= blank) {
    let found = -1;
    for (let d = 1; d <= 5 * s && found < 0; d++) {
      if (at(y - d) > blank) found = y - d;
      else if (at(y + d) > blank) found = y + d;
    }
    if (found < 0) return null;
    y = found;
  }
  // gaps of up to ~1 pt belong to the line (dots of umlauts, i, j)
  const gap = Math.max(2, Math.round(1.1 * s));
  let top = y, bot = y;
  for (;;) {
    let k = 1;
    while (k <= gap && top - k >= lo && at(top - k) <= blank) k++;
    if (top - k < lo || k > gap) break;
    top -= k;
  }
  for (;;) {
    let k = 1;
    while (k <= gap && bot + k < hi && at(bot + k) <= blank) k++;
    if (bot + k >= hi || k > gap) break;
    bot += k;
  }
  const lh = bot - top + 1;
  if (lh > 48 * s || lh < 3) {
    // no clear gaps (a table, a photo): read a fixed band around the tap
    return [Math.max(0, ty - 16 * s), Math.min(img.h, ty + 16 * s)];
  }
  // reach into the blank gaps a little
  let up = 0, down = 0;
  const pad = Math.round(lh * 0.45);
  while (up < pad && top - up - 1 >= lo && at(top - up - 1) <= blank) up++;
  while (down < pad && bot + down + 1 < hi && at(bot + down + 1) <= blank) down++;
  return [top - up, bot + down + 1];
}

/** Bands of about 100 pt across the whole page, cut where there is least ink (between lines). */
function planBands(img: PageImg): [number, number][] {
  const ink = rowInk(img, 0, img.w, 0, img.h);
  const blank = Math.max(1, img.w * 0.002);
  let first = 0, last = img.h - 1;
  while (first < img.h && ink[first] <= blank) first++;
  while (last > first && ink[last] <= blank) last--;
  if (first >= last) return [];
  const T = Math.round(100 * img.s);
  const out: [number, number][] = [];
  let y = Math.max(0, first - 4);
  while (y < last) {
    if (last - y < T * 1.5) { out.push([y, Math.min(img.h, last + 6)]); break; }
    const a = y + Math.round(T * 0.6), b = Math.min(last, y + Math.round(T * 1.5));
    let min = Infinity;
    for (let r = a; r < b; r++) min = Math.min(min, ink[r]);
    const tol = Math.max(1, img.w * 0.001);
    // middle of the longest run of near-empty rows, closest to the target size on ties
    let cut = y + T, bestLen = -1, bestDist = Infinity;
    for (let r = a; r < b;) {
      if (ink[r] > min + tol) { r++; continue; }
      let e = r;
      while (e < b && ink[e] <= min + tol) e++;
      const mid = (r + e) >> 1, len = e - r, dist = Math.abs(mid - (y + T));
      if (len > bestLen || (len === bestLen && dist < bestDist)) { bestLen = len; bestDist = dist; cut = mid; }
      r = e;
    }
    // skip empty stretches
    if (ink.subarray(y, cut).some((v) => v > blank)) out.push([y, cut]);
    y = cut;
  }
  return out;
}
