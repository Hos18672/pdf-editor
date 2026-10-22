// Edits on scans / picture pages, drawn with the page's own letters.
//
// Every line of the page is cut into words and letters (connected ink shapes, matched to the text
// layer). Editing a line then keeps the untouched words as they are (their original pixels), and
// builds new or changed words from letters of the same size and weight found on the page, spaced
// the way the page spaces them. So the result has the page's font, weight, colour and sharpness.
// Letters the page never shows fall back to the closest bundled font.
import type { TextRun } from '../engine/pdfText';
import type { ClonedText, M } from '../engine/types';
import { runBox } from './geometry';
import { scanCss, SCAN_FAMILIES } from './scanStyle';


export interface PageCtx { pdf: any; src: number; info: { w: number; h: number; vm: M }; runs: TextRun[]; colors: Record<string, { bg: string; fg: string }> }

/** coverage 0–255, with a soft fringe: the letter itself starts `ox` px in and is `cw` px wide */
interface Bitmap { w: number; h: number; a: Uint8Array; ox: number; cw: number }
interface Word { x0: number; top: number; bmp: Bitmap; x1: number; sw: number; n: number }
interface Line {
  key: string; tokens: string[];
  /** the line's ink cut into words, in order (null when they couldn't be matched to the text) */
  words: Word[] | null;
  /** text word → index in `words`; and for each of `words`, its first text word and how many */
  tokUnit: number[]; unitTok: [number, number][];
  /** all of the line's ink, as one word (used when words can't be matched) */
  all: Word;
  layerX: number; layerY: number; base: number; capH: number; inkX0: number; inkX1: number;
  /** top and bottom of the line's printed ink (accents, descenders) */
  inkY0: number; inkY1: number;
  ink: [number, number, number]; wordGap: number | null; sw: number;
  /** how dark the letters' cores get (0–1): soft scans never reach full ink */
  peak: number;
  /** how soft the letters' edges are: half-tone pixels per edge pixel */
  edge: number;
  /** ink heights of the line's capitals / small letters / ascenders (filled in from similar lines when missing) */
  ref: Ref;
  /** the printed baseline as a straight fit (scans are often a little skewed): y = fitY + slope · (x − fitX) */
  slope: number; fitX: number; fitY: number;
  /** this line's contrast, for ink measures comparable across lines */
  contrast: number;
}
type Cls = 'cap' | 'x' | 'asc';
type Ref = Record<Cls, number>;
interface Gap { g: number; capH: number; sw: number }
/** a letter seen on the page: `h` its ink height, `bot` where its ink ends below the baseline, `oy` the fringe above it */
interface Sample { bmp: Bitmap; capH: number; sw: number; h: number; bot: number; oy: number; line: Line }
interface PageGlyphs {
  k: number; layerH: Map<string, number>; lines: Map<string, Line>; samples: Map<string, Sample[]>;
  /** gaps between letters (× capital height), with the size and weight they were seen at */
  pair: Map<string, Gap[]>; right: Map<string, Gap[]>; left: Map<string, Gap[]>;
  letterGap: number; wordGap: number; sw: number;
  /** per letter: how far its ink usually reaches below the baseline (× the line's x-height) */
  depth: Map<string, number>;
}

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k); if (l) l.push(v); else m.set(k, [v]); };
const lumOf = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const hexRgb = (h: string): [number, number, number] => { const v = parseInt(h.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
/** letters whose top is the cap / ascender height (no accents) */
const TALL = /[ABDEFHIKLMNPRTXYZ0-9bdhkl]/;
/** which height a letter is sized by */
const CAP_REF = /^[ABDEFHIKLMNPRTUVWXYZ0-9]$/, X_REF = /^[acemnorsuvwxz]$/, ASC_REF = /^[bdfhkl]$/;
const clsOf = (ch: string): Cls => (/\p{Ll}/u.test(ch) ? (/[bdfhklßt]/.test(ch) ? 'asc' : 'x') : 'cap');
/** letters whose ink sits on the baseline (for fitting it) */
const ON_BASE = /^[A-PR-Za-fhik-ortuvwxz0-9.:!?ÄÖÜäöü]$/;

/** coverage that the darkest few percent of a bitmap's ink reach */
function peakOf(b: Bitmap) {
  const v: number[] = [];
  for (let i = 0; i < b.a.length; i++) if (b.a[i] > 25) v.push(b.a[i]);
  if (v.length < 10) return 1;
  v.sort((a, z) => a - z);
  return v[Math.floor(v.length * 0.97)] / 255;
}

/** edge softness: pixels between paper and ink, per pixel of letter outline */
function edgeOf(b: Bitmap) {
  let mid = 0, edge = 0;
  const on = (i: number) => b.a[i] >= 128;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = y * b.w + x, v = b.a[i];
    if (v > 25 && v < 230) mid++;
    if (on(i) && ((x + 1 < b.w && !on(i + 1)) || (x > 0 && !on(i - 1)) || (y + 1 < b.h && !on(i + b.w)) || (y > 0 && !on(i - b.w)))) edge++;
  }
  return edge ? mid / edge : 1;
}

type Cluster = { x0: number; x1: number; y0: number; y1: number; ids: number[]; n: number };
type Entry = { keys: Set<string>; p: Promise<PageGlyphs | null> };
const cache = new WeakMap<object, Map<number, Entry>>();

/** The page's letters, read once per page; read again when a line was added since (a cell read later). */
export function pageGlyphs(ctx: PageCtx, need?: string): Promise<PageGlyphs | null> {
  let m = cache.get(ctx.pdf);
  if (!m) cache.set(ctx.pdf, (m = new Map()));
  const e = m.get(ctx.src);
  const stale = !!e && !!need && !e.keys.has(need) && ctx.runs.some((r) => r.key === need) && !!ctx.colors[need];
  if (e && !stale) return e.p;
  const p = harvest(ctx).catch((err) => { console.warn('scan glyphs', err); return null; });
  m.set(ctx.src, { keys: new Set(ctx.runs.filter((r) => ctx.colors[r.key]).map((r) => r.key)), p });
  return p;
}

async function harvest({ pdf, src, info, runs, colors }: PageCtx): Promise<PageGlyphs | null> {
  if (typeof document === 'undefined') return null;
  const page = await pdf.getPage(src + 1);
  const k = Math.min(4, 3300 / Math.max(info.w, info.h));
  const vp = page.getViewport({ scale: k });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const cx = canvas.getContext('2d', { willReadFrequently: true })!;
  cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: cx, viewport: vp, annotationMode: 0 }).promise;
  const W = canvas.width, H = canvas.height;
  const px = cx.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 0;

  const pg: PageGlyphs = { k, layerH: new Map(), lines: new Map(), samples: new Map(), pair: new Map(), right: new Map(), left: new Map(), letterGap: 0.12, wordGap: 0.42, sw: 0.14, depth: new Map() };
  const t0 = performance.now();
  type Ch = { ch: string; bmp: Bitmap; h: number; bot: number; oy: number };
  type Unit = { t0: number; tn: number; cs: Cluster[]; one: boolean };
  const pending: { line: Line; chars: Ch[][]; units: Unit[] | null }[] = [];
  const gapsPx: { a: string; b: string; px: number; line: Line; wi: number }[] = [];
  const hist = new Uint32Array(256);

  for (const run of runs) {
    const b = runBox(run, info.vm);
    pg.layerH.set(run.key, run.region.height);
    if (Math.abs(b.angle) > 0.02 || !run.str.trim() || !colors[run.key]) continue;
    const size = b.h * k;
    if (size < 6) continue;
    const layerX = b.x * k, layerY = b.y * k;
    const bx0 = Math.max(0, Math.floor(layerX - 0.9 * size)), bx1 = Math.min(W, Math.ceil(layerX + b.w * k + 0.9 * size));
    const by0 = Math.max(0, Math.floor(layerY - 1.3 * size)), by1 = Math.min(H, Math.ceil(layerY + 0.55 * size));
    const bw = bx1 - bx0, bh = by1 - by0;
    if (bw < 4 || bh < 4) continue;

    // ink coverage in the band: 0 paper … 1 ink
    const bgL = lumOf(...hexRgb(colors[run.key].bg));
    hist.fill(0);
    let nDark = 0;
    for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) {
      const i = (y * W + x) * 4, L = lumOf(px[i], px[i + 1], px[i + 2]);
      if (L < bgL - 30) { hist[L | 0]++; nDark++; }
    }
    if (nDark < 20) continue;
    let fgL = 0;
    for (let v = 0, acc = 0; v < 256; v++) { acc += hist[v]; if (acc > nDark * 0.1) { fgL = v; break; } }
    if (bgL - fgL < 50) continue;
    const t = new Float32Array(bw * bh);
    const inkSum = [0, 0, 0]; let inkN = 0;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = ((y + by0) * W + x + bx0) * 4, L = lumOf(px[i], px[i + 1], px[i + 2]);
      const v = Math.max(0, Math.min(1, (bgL - L) / (bgL - fgL)));
      t[y * bw + x] = v;
      if (v > 0.85) { inkSum[0] += px[i]; inkSum[1] += px[i + 1]; inkSum[2] += px[i + 2]; inkN++; }
    }
    const ink: [number, number, number] = inkN ? [inkSum[0] / inkN, inkSum[1] / inkN, inkSum[2] / inkN] : [0, 0, 0];

    // connected ink shapes
    const lab = new Int32Array(bw * bh).fill(-1);
    type Comp = { x0: number; x1: number; y0: number; y1: number; n: number; id: number };
    const comps: Comp[] = [];
    const stack: number[] = [];
    for (let p0 = 0; p0 < bw * bh; p0++) {
      if (lab[p0] !== -1 || t[p0] <= 0.45) continue;
      const c: Comp = { x0: bw, x1: -1, y0: bh, y1: -1, n: 0, id: comps.length };
      lab[p0] = c.id; stack.push(p0);
      while (stack.length) {
        const p = stack.pop()!, x = p % bw, y = (p / bw) | 0;
        c.n++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const q = ny * bw + nx;
          if (lab[q] === -1 && t[q] > 0.45) { lab[q] = c.id; stack.push(q); }
        }
      }
      comps.push(c);
    }
    if (!comps.length) continue;

    // where the letters sit: baseline = last well-inked row, top = walk up while rows are inked
    const L0 = Math.max(0, Math.round(layerX - bx0)), R0 = Math.min(bw - 1, Math.round(layerX + b.w * k - bx0));
    const rows = new Array(bh).fill(0);
    for (let y = 0; y < bh; y++) for (let x = L0; x <= R0; x++) if (t[y * bw + x] > 0.45) rows[y]++;
    const maxRow = Math.max(...rows);
    if (!maxRow) continue;
    let base = bh;
    const ly = Math.round(layerY - by0);
    // the inked row block nearest the layer's baseline
    for (let y = Math.min(bh - 1, ly + Math.round(0.35 * size)); y >= 0; y--) if (rows[y] >= maxRow * 0.22) { base = y + 1; break; }
    const thr = Math.max(1, maxRow * 0.04);
    let top = base - 1;
    while (top > 0 && (rows[top - 1] >= thr || (top > 1 && rows[top - 2] >= thr))) top--;
    let capH = Math.max(3, base - top);

    // shapes of this line (not the descenders of the line above / ascenders of the line below)
    let mine = comps.filter((c) => { const cy = (c.y0 + c.y1) / 2; return cy >= top - 0.15 * capH && cy <= base + 0.45 * capH && c.y1 >= top; });
    // accents above capitals (Ä Ö Ü É): small shapes just above the line, over one of its letters
    {
      const body = mine.slice();
      const inLine = new Set(mine);
      for (const c of comps) {
        if (inLine.has(c) || c.n >= 0.08 * capH * capH) continue;
        const cy = (c.y0 + c.y1) / 2;
        if (cy < top - 0.4 * capH || cy >= top - 0.15 * capH) continue;
        const cx = (c.x0 + c.x1) / 2;
        if (body.some((o) => cx >= o.x0 - 1 && cx <= o.x1 + 1 && o.y0 - c.y1 < 0.35 * capH)) mine.push(c);
      }
    }
    // horizontally: the text layer's extent, plus ink that continues it without a word-sized gap
    {
      const cols = new Array(bw).fill(0);
      for (const c of mine) for (let x = c.x0; x <= c.x1; x++) cols[x]++;
      const gapMax = Math.max(2, Math.round(capH * 0.45));
      let r = R0, l = L0, gap = 0;
      for (let x = R0; x < bw; x++) { if (cols[x]) { r = x; gap = 0; } else if (++gap > gapMax) break; }
      gap = 0;
      for (let x = L0; x >= 0; x--) { if (cols[x]) { l = x; gap = 0; } else if (++gap > gapMax) break; }
      mine = mine.filter((c) => c.x1 >= l && c.x0 <= r && (c.x0 + c.x1) / 2 >= l - 1 && (c.x0 + c.x1) / 2 <= r + 1);
    }
    if (!mine.length) continue;

    // letters: shapes that stack (i, j, umlauts, accents, %) form one letter
    mine.sort((a, z) => a.x0 - z.x0);
    const cl: Cluster[] = [];
    for (const c of mine) {
      const last = cl[cl.length - 1];
      if (last) {
        const ov = Math.min(last.x1, c.x1) - Math.max(last.x0, c.x0) + 1;
        const small = c.n < 0.06 * capH * capH || last.n < 0.06 * capH * capH;
        const cxm = (c.x0 + c.x1) / 2, lxm = (last.x0 + last.x1) / 2;
        const inside = (cxm >= last.x0 - 1 && cxm <= last.x1 + 1) || (lxm >= c.x0 - 1 && lxm <= c.x1 + 1);
        const above = c.y1 < last.y0 + capH * 0.25 || last.y1 < c.y0 + capH * 0.25; // one sits on top of the other
        if (ov >= 0.5 * Math.min(c.x1 - c.x0 + 1, last.x1 - last.x0 + 1) || (small && inside && above)) {
          last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1);
          last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1);
          last.ids.push(c.id); last.n += c.n;
          continue;
        }
      }
      cl.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, ids: [c.id], n: c.n });
    }

    // coverage of some shapes (with a one-pixel fringe for their soft edges)
    const mark = new Uint8Array(comps.length);
    const own = (q: number) => { const l = lab[q]; return l >= 0 && mark[l] === 1; };
    const cut = (ids: number[], x0: number, y0: number, x1: number, y1: number): Bitmap => {
      for (const id of ids) mark[id] = 1;
      const cx0 = x0, cx1 = x1;
      x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(bw - 1, x1 + 1); y1 = Math.min(bh - 1, y1 + 1);
      const ox = cx0 - x0, cw = cx1 - cx0 + 1;
      const w = x1 - x0 + 1, h = y1 - y0 + 1, a = new Uint8Array(w * h);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        let hit = false;
        for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && own(ny * bw + nx)) hit = true;
        }
        if (hit) a[(y - y0) * w + x - x0] = Math.round(t[y * bw + x] * 255);
      }
      for (const id of ids) mark[id] = 0;
      return { w, h, a, ox, cw };
    };
    // stroke width of some shapes: their ink (including the blur around them) per length of
    // stroke (half the outline). Blur spreads ink but keeps its amount, so bold and regular text stay
    // apart even on soft, low-resolution scans.
    const strokeOf = (ids: number[], x0: number, y0: number, x1: number, y1: number) => {
      for (const id of ids) mark[id] = 1;
      let edges = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const q = y * bw + x;
        if (!own(q)) continue;
        if (x === x0 || !own(q - 1)) edges++;
        if (x === x1 || !own(q + 1)) edges++;
        if (y === y0 || !own(q - bw)) edges++;
        if (y === y1 || !own(q + bw)) edges++;
      }
      // ink within 2 px of the shapes, not belonging to other shapes
      const X0 = Math.max(0, x0 - 2), Y0 = Math.max(0, y0 - 2), X1 = Math.min(bw - 1, x1 + 2), Y1 = Math.min(bh - 1, y1 + 2);
      let mass = 0;
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
        const q = y * bw + x, l = lab[q];
        if (l >= 0 && !mark[l]) continue;
        let near = false;
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && own(ny * bw + nx)) near = true;
        }
        if (near) mass += t[q];
      }
      for (const id of ids) mark[id] = 0;
      return edges ? (4 * mass) / edges : 0;
    };
    const wordOf = (cs: Cluster[]): Word => {
      const ids = cs.flatMap((c) => c.ids);
      const x0 = Math.min(...cs.map((c) => c.x0)), x1 = Math.max(...cs.map((c) => c.x1));
      const y0 = Math.min(...cs.map((c) => c.y0)), y1 = Math.max(...cs.map((c) => c.y1));
      return { x0: x0 + bx0, x1: x1 + 1 + bx0, top: Math.max(0, y0 - 1) - base, bmp: cut(ids, x0, y0, x1, y1), sw: strokeOf(ids, x0, y0, x1, y1) * (bgL - fgL), n: cs.length };
    };

    // words: split the letters at word-sized gaps, then match those pieces to the text's words by
    // width (the ink can split or join words differently than the text layer does)
    const tokens = run.str.normalize('NFC').split(/\s+/).filter(Boolean);
    const segs: Cluster[][] = [];
    {
      const gaps = cl.slice(1).map((c, i) => c.x0 - cl[i].x1 - 1);
      // two groups of gaps (between letters / between words): the split that separates them best;
      // table rows have a third, wider kind (between cells), so split again below it if needed
      const otsu = (v: number[]) => {
        let best = -1, thr = Infinity;
        for (let i = 1; i < v.length; i++) {
          if (v[i] <= v[i - 1]) continue;
          const lo = v.slice(0, i), hi = v.slice(i);
          const ml = lo.reduce((a, z) => a + z, 0) / lo.length, mh = hi.reduce((a, z) => a + z, 0) / hi.length;
          const sc = lo.length * hi.length * (mh - ml) * (mh - ml);
          if (sc > best) { best = sc; thr = (v[i - 1] + v[i]) / 2; }
        }
        return thr;
      };
      const floor = 0.27 * capH;
      let v = [...gaps].sort((a, z) => a - z);
      let thr = Math.max(floor, otsu(v));
      while (v.filter((g) => g > thr).length + 1 < tokens.length * 0.8) {
        v = v.filter((g) => g < thr);
        const t2 = otsu(v);
        if (!(t2 > floor) || t2 >= thr) break;
        thr = t2;
      }
      let cur: Cluster[] = [];
      cl.forEach((c, i) => { if (i > 0 && gaps[i - 1] > thr) { segs.push(cur); cur = []; } cur.push(c); });
      segs.push(cur);
    }
    let units: Unit[] | null = null;
    {
      const mctx = document.createElement('canvas').getContext('2d')!;
      mctx.font = '400 100px "PE Arimo", Arial, sans-serif';
      const wt = tokens.map((tk) => mctx.measureText(tk).width), wsp = mctx.measureText(' ').width;
      const n = segs.length, m = tokens.length;
      const span = (i: number, a: number) => segs[i + a - 1][segs[i + a - 1].length - 1].x1 - segs[i][0].x0 + 1;
      const tw = (j: number, b: number) => wt.slice(j, j + b).reduce((x, y) => x + y, 0) + (b - 1) * wsp;
      // scale: printed width per measured width (cell gaps in tables don't count)
      const f = segs.reduce((a, _, i) => a + span(i, 1), 0) / Math.max(1, wt.reduce((a, z) => a + z, 0));
      const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
      const back = Array.from({ length: n + 1 }, () => new Array<[number, number] | null>(m + 1).fill(null));
      const cnt = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
      dp[0][0] = 0;
      const moves: [number, number][] = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 3], [2, 2]];
      for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
        if (dp[i][j] === Infinity) continue;
        for (const [a, b] of moves) {
          if (i + a > n || j + b > m) continue;
          const c = dp[i][j] + Math.abs(Math.log(span(i, a) / (f * tw(j, b)))) + 0.35 * (a - 1) + 0.35 * (b - 1);
          if (c < dp[i + a][j + b]) { dp[i + a][j + b] = c; back[i + a][j + b] = [a, b]; cnt[i + a][j + b] = cnt[i][j] + 1; }
        }
      }
      if (m === 1) units = [{ t0: 0, tn: 1, cs: cl, one: true }];
      else if (dp[n][m] < Infinity && dp[n][m] / Math.max(1, cnt[n][m]) < 0.3) {
        units = [];
        for (let i = n, j = m; i > 0 || j > 0;) {
          const [a, b] = back[i][j]!;
          units.unshift({ t0: j - b, tn: b, cs: segs.slice(i - a, i).flat(), one: a === 1 && b === 1 });
          i -= a; j -= b;
        }
      }
    }
    if ((globalThis as any).__scanDebug) console.log('scan words', units ? 'matched' : 'unmatched', JSON.stringify(run.str), 'tokens', tokens.length, 'pieces', segs.length, 'units', units?.length, units?.filter((u) => !u.one).map((u) => tokens.slice(u.t0, u.t0 + u.tn).join(' ')).join(' | '));

    // capital height from letters that reach it (lines without capitals / ascenders are lower)
    if (units) {
      const tall: number[] = [];
      units.forEach((u) => { const chars = [...tokens[u.t0]]; if (u.one && chars.length === u.cs.length) u.cs.forEach((c, ci) => { if (TALL.test(chars[ci])) tall.push(base - c.y0); }); });
      if (tall.length >= 2) capH = median(tall);
    }
    const all = wordOf(cl);
    // softness of the printed edges, before anything is cut out: half-tones per outline pixel
    let soft = 1;
    {
      const ids = cl.flatMap((c) => c.ids);
      for (const id of ids) mark[id] = 1;
      const x0 = Math.max(0, Math.min(...cl.map((c) => c.x0)) - 3), x1 = Math.min(bw - 1, Math.max(...cl.map((c) => c.x1)) + 3);
      const y0 = Math.max(0, Math.min(...cl.map((c) => c.y0)) - 3), y1 = Math.min(bh - 1, Math.max(...cl.map((c) => c.y1)) + 3);
      let mid = 0, edges = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const q = y * bw + x, l = lab[q];
        if (l >= 0 && !mark[l]) continue;
        if (t[q] > 0.15 && t[q] < 0.85) mid++;
        if (own(q) && ((x > 0 && !own(q - 1)) || (x < bw - 1 && !own(q + 1)) || (y > 0 && !own(q - bw)) || (y < bh - 1 && !own(q + bw)))) edges++;
      }
      for (const id of ids) mark[id] = 0;
      if (edges) soft = mid / edges;
    }
    const words = units ? units.map((u) => wordOf(u.cs)) : null;
    const tokUnit: number[] = [];
    units?.forEach((u, ui) => { for (let q = 0; q < u.tn; q++) tokUnit[u.t0 + q] = ui; });
    const line: Line = {
      key: run.key, tokens, words, tokUnit, unitTok: units?.map((u) => [u.t0, u.tn] as [number, number]) ?? [], all, layerX, layerY, base: by0 + base, capH,
      inkX0: all.x0, inkX1: all.x1, inkY0: by0 + Math.min(...cl.map((c) => c.y0)), inkY1: by0 + Math.max(...cl.map((c) => c.y1)) + 1, ink, wordGap: null, sw: all.sw / capH, peak: peakOf(all.bmp), edge: soft,
      ref: { cap: NaN, x: NaN, asc: NaN }, slope: 0, fitX: all.x0, fitY: by0 + base, contrast: bgL - fgL,
    };
    pg.lines.set(run.key, line);

    // letters (where a word's letters and its text match one to one); gaps in pixels for now
    const lineChars: Ch[][] = [];
    if (units) units.forEach((u, wi) => {
      const chars = [...tokens[u.t0]], g = u.cs;
      if (!u.one || chars.length !== g.length) { lineChars.push([]); return; }
      lineChars.push(g.map((c, ci) => ({ ch: chars[ci], bmp: cut(c.ids, c.x0, c.y0, c.x1, c.y1), h: c.y1 - c.y0 + 1, oy: c.y0 - Math.max(0, c.y0 - 1),
        bot: c.y1 + 1 + by0, cx: (c.x0 + c.x1) / 2 + bx0 } as Ch & { cx: number })));
      for (let ci = 0; ci + 1 < g.length; ci++) gapsPx.push({ a: chars[ci], b: chars[ci + 1], px: g[ci + 1].x0 - g[ci].x1 - 1, line, wi });
    });
    // the printed baseline: a straight fit through the bottoms of letters that sit on it
    {
      const pts = (lineChars.flat() as (Ch & { cx: number })[]).filter((c) => ON_BASE.test(c.ch)).map((c) => [c.cx, c.bot]);
      if (pts.length >= 4) {
        const fit = (P: number[][]) => {
          const n = P.length, mx = P.reduce((a, p) => a + p[0], 0) / n, my = P.reduce((a, p) => a + p[1], 0) / n;
          let sxx = 0, sxy = 0;
          for (const [x, y] of P) { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (y - my); }
          return { mx, my, sl: sxx > 1 ? sxy / sxx : 0 };
        };
        let f = fit(pts);
        const inl = pts.filter(([x, y]) => Math.abs(y - (f.my + f.sl * (x - f.mx))) <= 2.5);
        if (inl.length >= 4) f = fit(inl);
        line.fitX = f.mx; line.fitY = f.my; line.slope = Math.max(-0.035, Math.min(0.035, f.sl));
      }
      const hs = (re: RegExp) => median(lineChars.flat().filter((c) => re.test(c.ch)).map((c) => c.h));
      line.ref = { cap: hs(CAP_REF), x: hs(X_REF), asc: hs(ASC_REF) };
      for (const cs of lineChars) for (const c of cs) c.bot -= line.fitY + line.slope * ((c as any).cx - line.fitX);
    }
    pending.push({ line, chars: lineChars, units });
    if ((globalThis as any).__scanDebug) (line as any).dbg = lineChars.flat().map((c) => c.ch + ':' + c.h + '/' + c.bot.toFixed(1));
  }

  // Sizes: each line's capitals / small letters / ascenders as printed. A line that lacks one of
  // them borrows it from the line of the most similar size that has both.
  {
    const lines = pending.map((P) => P.line);
    const fill = (l: Line, want: Cls) => {
      for (const have of ['cap', 'x', 'asc'] as Cls[]) {
        if (have === want || !(l.ref[have] > 0)) continue;
        const peers = lines.filter((o) => o.ref[want] > 0 && o.ref[have] > 0);
        if (!peers.length) continue;
        const near = peers.sort((a, z) => Math.abs(Math.log(a.ref[have] / l.ref[have])) - Math.abs(Math.log(z.ref[have] / l.ref[have])))[0];
        return l.ref[have] * (near.ref[want] / near.ref[have]);
      }
      return NaN;
    };
    const filled = lines.map((l) => ({ l, r: { cap: l.ref.cap > 0 ? l.ref.cap : fill(l, 'cap'), x: l.ref.x > 0 ? l.ref.x : fill(l, 'x'), asc: l.ref.asc > 0 ? l.ref.asc : fill(l, 'asc') } }));
    // lines without any matched letters: their capitals from the rough height measured above
    const xr = median(lines.filter((l) => l.ref.cap > 0 && l.ref.x > 0).map((l) => l.ref.x / l.ref.cap)) || 0.75;
    const ar = median(lines.filter((l) => l.ref.cap > 0 && l.ref.asc > 0).map((l) => l.ref.asc / l.ref.cap)) || 1.03;
    for (const { l, r } of filled) {
      if (!(r.cap > 0)) r.cap = r.x > 0 ? r.x / xr : r.asc > 0 ? r.asc / ar : l.capH;
      if (!(r.x > 0)) r.x = r.cap * xr;
      if (!(r.asc > 0)) r.asc = r.cap * ar;
      l.ref = r; l.capH = r.cap;
    }
  }
  // ink measures in the page's darkest contrast (thin strokes on soft scans never reach full ink)
  {
    const cs = pending.map((P) => P.line.contrast).sort((a, z) => z - a);
    const top = cs.length ? cs[Math.floor(cs.length * 0.1)] : 1;
    for (const P of pending) {
      const f = 1 / Math.max(1, top);
      P.line.all.sw *= f; P.line.words?.forEach((w) => { w.sw *= f; });
    }
  }
  // everything else relative to the final capital heights
  const sws: number[] = [], letterGaps: number[] = [], wordGaps: number[] = [];
  for (const P of pending) {
    const { line, units } = P, words = line.words, capH = line.capH;
    line.sw = line.all.sw / capH;
    if (words && units) {
      words.forEach((w) => { if (w.n >= 3) sws.push(w.sw / capH); });
      const g = words.slice(1).map((w, i) => (w.x0 - words[i].x1) / capH);
      if (g.length) line.wordGap = median(g);
      wordGaps.push(...g.filter((_, i) => units[i].one && units[i + 1].one));
    }
  }
  for (const { a, b, px: gp, line, wi } of gapsPx) {
    const gap: Gap = { g: gp / line.capH, capH: line.capH, sw: line.words![wi].sw / line.capH };
    push(pg.pair, a + b, gap); push(pg.right, a, gap); push(pg.left, b, gap);
    letterGaps.push(gap.g);
  }
  if (letterGaps.length) pg.letterGap = median(letterGaps);
  if (wordGaps.length) pg.wordGap = median(wordGaps);
  if (sws.length) pg.sw = median(sws);
  const depth = new Map<string, number[]>();
  for (const { line, chars } of pending) {
    chars.forEach((cs, wi) => cs.forEach((c) => {
      push(pg.samples, c.ch, { bmp: c.bmp, capH: line.capH, sw: line.words![wi].sw / line.capH, h: c.h, bot: c.bot, oy: c.oy, line });
      push(depth, c.ch, c.bot / line.ref.x);
    }));
  }
  for (const [ch, v] of depth) pg.depth.set(ch, median(v));
  if ((globalThis as any).__scanDebug) console.log('TIME harvest', src, Math.round(performance.now() - t0), 'ms', pg.lines.size, 'lines');
  return pg;
}

// ---------------------------------------------------------------- letters in a font, made to look printed

interface Synth { fam: string; weight: number; lw: number; blur: number; capPx: number; xPx: number; stretch: number }
let cvA: HTMLCanvasElement | null = null, cvB: HTMLCanvasElement | null = null;
const canvasPair = () => {
  cvA ??= document.createElement('canvas'); cvB ??= document.createElement('canvas');
  return [cvA.getContext('2d', { willReadFrequently: true })!, cvB.getContext('2d', { willReadFrequently: true })!] as const;
};
/**
 * Text drawn in a font, `lw` px heavier (or lighter, when negative), stretched and blurred.
 * The bitmap's letters start `ox` px in; `top` is the bitmap's top relative to the baseline.
 */
function renderInk(text: string, font: string, lw: number, blur: number, stretch: number): { bmp: Bitmap; top: number; stroke: number; soft: number } | null {
  const [a, b] = canvasPair();
  a.font = font;
  const m = a.measureText(text);
  const L = m.actualBoundingBoxLeft, R = m.actualBoundingBoxRight, asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  if (!(L + R > 0) || !(asc + desc > 0)) return null;
  const e = Math.max(0, lw) / 2;
  const pad = 2 + Math.ceil(blur * 2.5 + e);
  const w = Math.ceil((L + R) * stretch + 2 * pad), h = Math.ceil(asc + desc + 2 * pad);
  if (w * h > 4e6) return null;
  const draw = (g: CanvasRenderingContext2D) => {
    g.canvas.width = w; g.canvas.height = h; // also resets the state
    g.font = font; g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineJoin = 'round';
  };
  draw(a);
  a.setTransform(stretch, 0, 0, 1, pad + L * stretch, pad + asc);
  a.fillText(text, 0, 0);
  if (Math.abs(lw) > 0.05) {
    a.lineWidth = Math.abs(lw);
    if (lw < 0) a.globalCompositeOperation = 'destination-out';
    a.strokeText(text, 0, 0);
  }
  let src = a;
  if (blur > 0.05) {
    draw(b);
    b.filter = `blur(${blur.toFixed(2)}px)`;
    b.drawImage(a.canvas, 0, 0);
    src = b;
  }
  const d = src.getImageData(0, 0, w, h).data, al = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) al[i] = d[i * 4 + 3];
  // stroke width the way the page's words are measured: ink per length of stroke
  let mass = 0, edges = 0, mid = 0;
  const on = (i: number) => al[i] > 115;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    mass += al[i] / 255;
    if (al[i] > 38 && al[i] < 217) mid++;
    if (!on(i)) continue;
    if (x === 0 || !on(i - 1)) edges++;
    if (x === w - 1 || !on(i + 1)) edges++;
    if (y === 0 || !on(i - w)) edges++;
    if (y === h - 1 || !on(i + w)) edges++;
  }
  pageLike(al, w, h);
  return { bmp: { w, h, a: al, ox: pad + Math.max(0, -lw) / 2, cw: Math.max(1, (L + R) * stretch + lw) }, top: -(pad + asc), stroke: edges ? (4 * mass) / edges : 0, soft: edges ? mid / edges : 1 };
}
/**
 * Coverage as the page's letters are cut out: scaled so the darkest tenth of the ink is full, and
 * only one pixel of fringe around the letter itself (coverage > 0.45) kept.
 */
function pageLike(al: Uint8Array, w: number, h: number) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < al.length; i++) if (al[i] > 25) { hist[al[i]]++; n++; }
  if (!n) return;
  let top = 255;
  for (let v = 255, acc = 0; v > 0; v--) { acc += hist[v]; if (acc > n * 0.1) { top = v; break; } }
  const f = 255 / Math.max(64, top);
  const on = new Uint8Array(al.length);
  for (let i = 0; i < al.length; i++) { const v = Math.min(255, Math.round(al[i] * f)); al[i] = v; on[i] = v > 115 ? 1 : 0; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (on[i] || !al[i]) continue;
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && on[ny * w + nx]) near = true;
    }
    if (!near) al[i] = 0;
  }
}
/** ink box of a bitmap (coverage > 0.45) */
function inkBox(b: Bitmap) {
  let x0 = b.w, x1 = -1, y0 = b.h, y1 = -1;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.a[y * b.w + x] > 115) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/**
 * The bundled font that looks most like the page's own letters: letters seen on the page are drawn
 * in each font at their size and laid over them. Also how much wider or narrower the page prints.
 */
const fontVotes = new WeakMap<object, Promise<{ family: string; stretch: number } | null>>();
function pageFont(pg: PageGlyphs) {
  let p = fontVotes.get(pg);
  if (!p) { p = voteFont(pg).catch(() => null); fontVotes.set(pg, p); }
  return p;
}
async function voteFont(pg: PageGlyphs): Promise<{ family: string; stretch: number } | null> {
  const t0 = performance.now();
  await Promise.all(SCAN_FAMILIES.flatMap((f) => [400, 700].map((w) => document.fonts?.load(`${w} 100px ${scanCss({ family: f })}`).catch(() => null))));
  const order = 'agGRetyrfskJQ2357MWhn';
  const chars = [...pg.samples.keys()].filter((ch) => /^[A-Za-z0-9]$/.test(ch))
    .sort((a, z) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(z) + 99) % 99)).slice(0, 16);
  if (chars.length < 5) return null;
  const score: Record<string, number> = {}, widths: Record<string, number[]> = {};
  for (const ch of chars) {
    const ss = [...pg.samples.get(ch)!].sort((a, z) => z.h - a.h).slice(0, 2);
    for (const s of ss) {
      const sb = inkBox(s.bmp);
      if (!sb || sb.h < 8) continue;
      const sm = (x: number, y: number) => x >= 0 && y >= 0 && x < sb.w && y < sb.h && s.bmp.a[(y + sb.y0) * s.bmp.w + x + sb.x0] > 115;
      for (const family of SCAN_FAMILIES) {
        const fam = scanCss({ family });
        let best = 0, bw = 1;
        for (const wt of [400, 700]) {
          const r0 = renderInk(ch, `${wt} 100px ${fam}`, 0, 0, 1);
          const b0 = r0 && inkBox(r0.bmp);
          if (!b0) continue;
          const r = renderInk(ch, `${wt} ${((100 * sb.h) / b0.h).toFixed(2)}px ${fam}`, 0, 0, 1);
          const rb = r && inkBox(r.bmp);
          if (!r || !rb) continue;
          const rm = (x: number, y: number) => x >= 0 && y >= 0 && x < rb.w && y < rb.h && r.bmp.a[(y + rb.y0) * r.bmp.w + x + rb.x0] > 115;
          const W = Math.max(sb.w, rb.w) + 2, H = Math.max(sb.h, rb.h) + 2;
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            let both = 0, any = 0;
            for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
              const a = sm(x, y), b = rm(x + dx, y + dy);
              if (a && b) both++; if (a || b) any++;
            }
            const iou = any ? both / any : 0;
            if (iou > best) { best = iou; bw = sb.w / rb.w; }
          }
        }
        score[family] = (score[family] ?? 0) + best;
        (widths[family] ??= []).push(bw);
      }
    }
  }
  const fams = Object.keys(score).sort((a, z) => score[z] - score[a]);
  if (!fams.length) return null;
  const family = fams[0];
  if ((globalThis as any).__scanDebug) console.log('TIME font vote', Math.round(performance.now() - t0), 'ms', fams.map((f) => f + ' ' + score[f].toFixed(2)).join(', '));
  return { family, stretch: Math.max(0.85, Math.min(1.18, median(widths[family]))) };
}

const synthCache = new WeakMap<object, Map<string, Promise<Synth>>>();
/**
 * How to draw letters this line doesn't show: the matched font at the weight and extra stroke that
 * give the line's stroke width (measured the same way on the same word), blurred like the line.
 */
function synthStyle(sw: number, line: Line, pageSw: number, family?: string, stretch?: number, ref?: string): Promise<Synth> {
  let m = synthCache.get(line);
  if (!m) synthCache.set(line, (m = new Map()));
  const key = `${family}|${sw.toFixed(3)}`;
  let p = m.get(key);
  if (!p) { p = makeSynth(sw, line, pageSw, family, stretch, ref); m.set(key, p); }
  return p;
}
async function makeSynth(sw: number, line: Line, pageSw: number, family?: string, stretch?: number, ref?: string): Promise<Synth> {
  const capH = line.capH, capInk = line.ref.cap, xInk = line.ref.x;
  const fam = scanCss({ family: (family as any) ?? 'Arimo' });
  await Promise.all([400, 700].map((wt) => document.fonts?.load(`${wt} 100px ${fam}`).catch(() => null)));
  const [g] = canvasPair();
  const met: Record<number, { cap: number; x: number }> = {};
  for (const wt of [400, 700]) {
    g.font = `${wt} 100px ${fam}`;
    met[wt] = { cap: g.measureText('H').actualBoundingBoxAscent || 72, x: g.measureText('x').actualBoundingBoxAscent || 52 };
  }
  const str = Math.max(0.8, Math.min(1.25, stretch || 1));
  const text = (ref && ref.length >= 3 ? ref : 'Hamburg').slice(0, 24);
  const fontOf = (wt: number) => `${wt} ${((100 * capInk) / met[wt].cap).toFixed(2)}px ${fam}`;
  // softness first (the edges' half-tones per edge pixel, as on the line)
  let blur = 0, bestD = Infinity;
  const softs: string[] = [];
  for (const bl of [0, 0.4, 0.7, 1, 1.4, 1.9, 2.5, 3.2, 4]) {
    const r = renderInk(text, fontOf(400), 0, bl, str);
    if (!r) break;
    softs.push(r.soft.toFixed(2));
    const d = Math.abs(r.soft - line.edge);
    if (d < bestD) { bestD = d; blur = bl; }
  }
  if ((globalThis as any).__scanDebug) console.log('synth soft', line.edge.toFixed(2), softs.join(' '), '→', blur);
  // then the weight: the font weight closest to the line, then a finer stroke to match it exactly
  const target = sw * capH;
  const measure = (wt: number, lw: number) => { const r = renderInk(text, fontOf(wt), lw, blur, str); return r ? r.stroke : 0; };
  const m4 = measure(400, 0), m7 = measure(700, 0);
  // bold letter shapes only for text clearly heavier than the page's usual text
  const weight = sw > pageSw * 1.2 ? 700 : 400;
  let lo = -0.16 * capH, hi = 0.3 * capH, lw = 0;
  const m0 = weight === 700 ? m7 : m4;
  if (m0 && Math.abs(m0 - target) > target * 0.03) {
    for (let it = 0; it < 9; it++) {
      lw = (lo + hi) / 2;
      const v = measure(weight, lw);
      if (Math.abs(v - target) < target * 0.02) break;
      if (v < target) lo = lw; else hi = lw;
    }
  }
  // sizes: the drawn ink (with its extra stroke and softness) as tall as the page's letters
  const inkH = (ch: string, px: number) => {
    const r = renderInk(ch, `${weight} ${px.toFixed(2)}px ${fam}`, (lw / ((100 * capInk) / met[weight].cap)) * px, blur, str);
    if (!r) return 0;
    let t = -1, b = -1;
    for (let y = 0; y < r.bmp.h && t < 0; y++) for (let x = 0; x < r.bmp.w; x++) if (r.bmp.a[y * r.bmp.w + x] > 115) { t = y; break; }
    for (let y = r.bmp.h - 1; y >= 0 && b < 0; y--) for (let x = 0; x < r.bmp.w; x++) if (r.bmp.a[y * r.bmp.w + x] > 115) { b = y; break; }
    return t >= 0 ? b - t + 1 : 0;
  };
  const fit = (ch: string, want: number, px0: number) => { let px = px0; for (let i = 0; i < 2; i++) { const h = inkH(ch, px); if (h > 0) px *= want / h; } return px; };
  const capPx = fit('H', capInk, (100 * capInk) / met[weight].cap);
  const xPx = fit('x', xInk, (100 * xInk) / met[weight].x);
  if ((globalThis as any).__scanDebug) console.log('synth', fam, weight, 'lw', (lw / capPx).toFixed(3), 'blur', blur, 'target', target.toFixed(2), 'm400', m4.toFixed(2), 'm700', m7.toFixed(2), 'capPx', capPx.toFixed(1), 'xPx', xPx.toFixed(1));
  return { fam, weight, lw: lw / ((100 * capInk) / met[weight].cap), blur, capPx, xPx, stretch: str };
}
const glyphCache = new WeakMap<Synth, Map<string, { bmp: Bitmap; top: number } | null>>();
function synthGlyph(ch: string, st: Synth, peak: number) {
  let m = glyphCache.get(st);
  if (!m) glyphCache.set(st, (m = new Map()));
  if (m.has(ch)) return m.get(ch)!;
  // small letters sized by the page's x-height, the rest by its capital height
  const px = /\p{Ll}/u.test(ch) ? st.xPx : st.capPx;
  const r = renderInk(ch, `${st.weight} ${px.toFixed(2)}px ${st.fam}`, st.lw * px, st.blur, st.stretch);
  if (r) for (let i = 0; i < r.bmp.a.length; i++) r.bmp.a[i] = Math.round(r.bmp.a[i] * peak);
  m.set(ch, r);
  return r;
}

// ---------------------------------------------------------------- composing an edit

type Item = { bmp: Bitmap; x: number; top: number; scale: number };

/** Token alignment: kept tokens copy the original word, the others are built from letters. */
function align(oldT: string[], newT: string[]) {
  const n = oldT.length, m = newT.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = oldT[i] === newT[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Array<number>(m).fill(-1);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (oldT[i] === newT[j]) { keep[j] = i; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
  }
  // a changed token stands in for the original token(s) between the same kept neighbours
  const ref = keep.slice();
  let j = 0;
  while (j < m) {
    if (keep[j] >= 0) { j++; continue; }
    let e = j; while (e < m && keep[e] < 0) e++;
    const lo = j > 0 ? keep[j - 1] + 1 : 0, hi = e < m ? keep[e] : n;
    for (let q = j; q < e; q++) if (lo + (q - j) < hi) ref[q] = lo + (q - j);
    j = e;
  }
  return { keep, ref };
}

export async function cloneLineText(ctx: PageCtx, key: string, text: string, opts: { sizeScale: number; color: string | null; family?: string; stretch?: number; more?: () => Promise<(PageGlyphs | null)[]> }): Promise<ClonedText | null> {
  const t0 = performance.now();
  const pg = await pageGlyphs(ctx, key);
  const line = pg?.lines.get(key);
  if (!pg || !line) return null;
  const capH = line.capH;
  let extra: PageGlyphs[] | null = null;
  const items: Item[] = [];
  const lineSw = line.words && line.words.length ? median(line.words.filter((w) => w.n >= 3).map((w) => w.sw / capH)) || line.sw : line.sw;
  // the line's longest word: synthetic letters are tuned on it (same text, so stroke measures compare)
  const refWord = line.words ? line.unitTok.map(([t, n]) => line.tokens.slice(t, t + n).join(' ')).filter((_, i) => line.words![i].n >= 3).sort((a, z) => z.length - a.length)[0] : undefined;

  if ((globalThis as any).__scanDebug) console.log('line', key, 'ref', JSON.stringify(line.ref), 'slope', line.slope.toFixed(4), 'sw', (lineSw * capH).toFixed(2), 'pgsw', (pg.sw * capH).toFixed(2), (line as any).dbg?.join(' '));
  const pick = async (ch: string, sw: number): Promise<Item | null> => {
    const cls = clsOf(ch);
    // pixel to pixel: the line's height for this kind of letter over the sample line's
    const scaleOf = (s: Sample) => line.ref[cls] / s.line.ref[cls];
    // size, and the stroke the letter will have once scaled to this line, against the line's stroke
    const score = (s: Sample) => {
      const sc = scaleOf(s);
      return 3 * Math.abs(Math.log(sc)) + 4 * Math.abs(Math.log(Math.max(1e-3, s.sw * s.capH * sc) / Math.max(1e-3, sw * capH)));
    };
    let cands = (pg.samples.get(ch) ?? []).map((s) => ({ s, o: pg, v: score(s) }));
    if (!cands.some((c) => c.v <= 0.6) && opts.more) {
      if (!extra) {
        const got: (PageGlyphs | null)[] = await opts.more().catch(() => []);
        extra = got.filter((x): x is PageGlyphs => !!x && x !== pg);
      }
      for (const o of extra) for (const s of o.samples.get(ch) ?? []) cands.push({ s, o, v: score(s) });
    }
    if (!cands.length) return null;
    const best = Math.min(...cands.map((c) => c.v));
    if (best > 0.6) return null;
    cands = cands.filter((c) => c.v <= best + 0.15);
    // the most typical of them (misread letters are outliers)
    const rw = (c: { s: Sample }) => c.s.bmp.w / c.s.line.ref[cls], rh = (c: { s: Sample }) => c.s.h / c.s.line.ref[cls];
    const mw = median(cands.map(rw)), mh = median(cands.map(rh));
    const c = cands.sort((a, z) => (Math.abs(rw(a) - mw) + Math.abs(rh(a) - mh) + a.v * 0.1) - (Math.abs(rw(z) - mw) + Math.abs(rh(z) - mh) + z.v * 0.1))[0];
    const s = c.s, scale = scaleOf(s);
    // sits where this letter usually sits (on the baseline, descenders below it)
    const dep = pg.depth.get(ch) ?? c.o.depth.get(ch) ?? s.bot / s.line.ref.x;
    if ((globalThis as any).__scanDebug) console.log('pick', ch, 'h', s.h, '→', (s.h * scale).toFixed(1), 'ref', line.ref[cls].toFixed(1), 'v', c.v.toFixed(2), 'swS', (s.sw * s.capH * scale).toFixed(2), 'swT', (sw * capH).toFixed(2));
    return { bmp: s.bmp, x: 0, top: dep * line.ref.x - (s.h + s.oy) * scale, scale };
  };
  /** a letter the page never shows: drawn in the matched font, tuned to the line's height, weight and softness */
  const fontGlyph = async (ch: string, sw: number): Promise<Item | null> => {
    const pf = await pageFont(pg);
    const st = await synthStyle(sw, line, pg.sw, pf?.family ?? opts.family, pf?.stretch ?? opts.stretch, refWord);
    const g = synthGlyph(ch, st, line.peak);
    return g ? { bmp: g.bmp, x: 0, top: g.top, scale: 1 } : null;
  };
  // spacing seen between these letters, preferably in text of the same size and weight
  const gapFor = (a: string, b: string, sw: number) => {
    const near = (l?: Gap[]) => {
      if (!l?.length) return null;
      const same = l.filter((x) => Math.abs(Math.log(x.capH / capH)) < 0.12 && Math.abs(x.sw - sw) < 0.25 * pg.sw);
      return median((same.length ? same : l).map((x) => x.g));
    };
    const p = near(pg.pair.get(a + b));
    if (p !== null) return p * capH;
    const r = near(pg.right.get(a)), l = near(pg.left.get(b));
    if (r !== null && l !== null) return ((r + l) / 2) * capH;
    return (r ?? l ?? pg.letterGap) * capH;
  };
  /** builds one word from letters; returns its right edge */
  const build = async (word: string, x: number, sw: number, dy: number) => {
    const chars = [...word];
    let prev: string | null = null;
    for (const ch of chars) {
      const it = (await pick(ch, sw)) ?? (await fontGlyph(ch, sw));
      if (prev !== null) x += gapFor(prev, ch, sw);
      // x is where the letter itself starts; its bitmap starts a soft fringe earlier
      if ((globalThis as any).__scanDebug) console.log('letter', ch, it ? (it.scale === 1 && !pg.samples.has(ch) ? 'font' : 'page') : 'none', 'scale', it?.scale.toFixed(2), 'top', it?.top.toFixed(1), 'h', it ? (it.bmp.h * it.scale).toFixed(1) : '', 'capH', capH.toFixed(1), 'sw', sw.toFixed(3));
      // on the printed baseline where the letter goes (it can slope a little on a scan)
      if (it) { it.x = x - it.bmp.ox * it.scale; it.top += dy + line.fitY + line.slope * (x - line.fitX) - line.base; items.push(it); x += it.bmp.cw * it.scale; }
      else x += capH * 0.3;
      prev = ch;
    }
    return x;
  };
  const wordGap = (line.wordGap ?? pg.wordGap) * capH;

  const texts = text.normalize('NFC').split('\n');
  for (let li = 0; li < texts.length; li++) {
    const tokens = texts[li].split(/\s+/).filter(Boolean);
    const dy = li * capH * 1.75;
    if (li === 0 && line.words) {
      const { keep, ref } = align(line.tokens, tokens);
      const words = line.words, tu = line.tokUnit, ut = line.unitTok;
      // weight of a word; short ones ("1.", "–") are too small to tell: they take the neighbour's
      const swOf = (o: number) => {
        const u = tu[o];
        for (const v of [u, u - 1, u + 1]) { const w = words[v]; if (w && w.n >= 3) return w.sw / capH; }
        return lineSw;
      };
      let x = words[0].x0, prevUnit = -2;
      const gapTo = (u: number) => (prevUnit >= 0 && prevUnit === u - 1 ? words[u].x0 - words[u - 1].x1 : wordGap);
      for (let j = 0; j < tokens.length;) {
        const o = keep[j];
        const u = o >= 0 ? tu[o] : -1;
        // an ink word is copied when all of its text words are kept, in order
        if (u >= 0 && ut[u][0] === o && Array.from({ length: ut[u][1] }, (_, q) => keep[j + q] === o + q).every(Boolean)) {
          if (j > 0) x += gapTo(u);
          const w = words[u];
          items.push({ bmp: w.bmp, x: x - w.bmp.ox, top: w.top, scale: 1 });
          x += w.bmp.cw;
          prevUnit = u;
          j += ut[u][1];
          continue;
        }
        // a word that takes the place of an original one keeps that one's spacing
        const ru = o < 0 && ref[j] >= 0 && line.unitTok[tu[ref[j]]]?.[0] === ref[j] ? tu[ref[j]] : -1;
        if (j > 0) x += ru >= 0 ? gapTo(ru) : wordGap;
        // style: the word it is (or replaces), else the neighbour it continues (after a label like
        // "Note:" the text that follows)
        let r = o >= 0 ? o : ref[j];
        if (r < 0) {
          const before = j > 0 ? (keep[j - 1] >= 0 ? keep[j - 1] : ref[j - 1]) : -1;
          const after = tokens.slice(j + 1).map((_, q) => (keep[j + 1 + q] >= 0 ? keep[j + 1 + q] : ref[j + 1 + q])).find((v) => v >= 0) ?? -1;
          r = before >= 0 && !(/[.:;)]$/.test(tokens[j - 1]) && after >= 0) ? before : after >= 0 ? after : before;
        }
        x = await build(tokens[j], x, r >= 0 ? swOf(r) : lineSw, 0);
        prevUnit = ru;
        j++;
      }
    } else {
      let x = line.inkX0;
      for (let j = 0; j < tokens.length; j++) {
        if (j > 0) x += wordGap;
        x = await build(tokens[j], x, lineSw, dy);
      }
    }
  }
  if (!items.length) return null;

  // paint: the page's ink colour (or the one chosen), coverage as transparency
  const ss = opts.sizeScale || 1;
  const [r, g, b] = opts.color ? hexRgb(opts.color) : line.ink;
  const ax = line.layerX; // scale around the line start
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const it of items) {
    minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x + it.bmp.w * it.scale);
    minY = Math.min(minY, it.top); maxY = Math.max(maxY, it.top + it.bmp.h * it.scale);
  }
  const pad = 2;
  const X0 = ax + (minX - ax) * ss - pad, Y0 = minY * ss - pad;
  const OW = Math.ceil((maxX - minX) * ss + 2 * pad), OH = Math.ceil((maxY - minY) * ss + 2 * pad);
  if (OW * OH > 40e6 || OW < 1 || OH < 1) return null;
  const out = document.createElement('canvas'); out.width = OW; out.height = OH;
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
  for (const it of items) {
    const c = document.createElement('canvas'); c.width = it.bmp.w; c.height = it.bmp.h;
    const id = new ImageData(it.bmp.w, it.bmp.h);
    for (let i = 0; i < it.bmp.a.length; i++) { id.data[i * 4] = r; id.data[i * 4 + 1] = g; id.data[i * 4 + 2] = b; id.data[i * 4 + 3] = it.bmp.a[i]; }
    c.getContext('2d')!.putImageData(id, 0, 0);
    const dx = ax + (it.x - ax) * ss - X0, dyy = it.top * ss - Y0;
    const s = it.scale * ss;
    if (Math.abs(s - 1) < 1e-3) o.drawImage(c, Math.round(dx), Math.round(dyy));
    else o.drawImage(c, dx, dyy, it.bmp.w * s, it.bmp.h * s);
  }
  const blob: Blob | null = await new Promise((res) => out.toBlob((x) => res(x), 'image/png'));
  if ((globalThis as any).__scanDebug) console.log('TIME clone', Math.round(performance.now() - t0), 'ms', JSON.stringify(text));
  if (!blob) return null;
  const k = pg.k, lh = pg.layerH.get(key) || 1;
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    w: OW / k, h: OH / k,
    left: (line.layerX - X0) / k,
    below: (Y0 + OH + (line.base - line.layerY)) / k,
    inkX0: (line.inkX0 - line.layerX) / k / lh,
    inkX1: (line.inkX1 - line.layerX) / k / lh,
    dy: (line.base - line.layerY) / k / lh,
    inkUp: (line.base - line.inkY0) / k / lh,
    inkDown: (line.inkY1 - line.base) / k / lh,
  };
}
