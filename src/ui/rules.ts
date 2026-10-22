// Table borders and other straight rules of a page. Covering an edited line with the paper colour
// must not wipe out the lines that run through or next to it, so covers keep these.
import type { TextRun } from '../engine/pdfText';
import type { M } from '../engine/interpreter';
import { runBox } from './geometry';

/** a rule as a rectangle in viewport units (scale 1, top-left origin) */
export interface RuleRect { x: number; y: number; w: number; h: number; color: string }

const lumOf = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const hexLum = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255); };

/**
 * The cover for a line, made from the page as it is shown: paper colour everywhere except on rules
 * (a column inked through the whole cover and beyond it, a row inked along most of it), which keep
 * their pixels. `px` is the region with `m` extra pixels on every side (used to see whether ink
 * continues past the cover); the result is the inner region.
 */
export function coverPixels(px: Uint8ClampedArray, W: number, H: number, m: number, bg: string, lineH: number): ImageData {
  const iw = W - 2 * m, ih = H - 2 * m;
  const out = new ImageData(Math.max(1, iw), Math.max(1, ih));
  const v = parseInt(bg.replace('#', ''), 16);
  const br = (v >> 16) & 255, bgg = (v >> 8) & 255, bb = v & 255, bL = hexLum(bg);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = br; out.data[i + 1] = bgg; out.data[i + 2] = bb; out.data[i + 3] = 255; }
  if (iw < 2 || ih < 2) return out;
  const ink = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) ink[p] = Math.abs(lumOf(px, i) - bL) > 22 ? 1 : 0;
  const keep = new Uint8Array(iw * ih);
  // vertical rules: inked in nearly every row of the cover, and still inked just above and below it
  for (let x = m; x < W - m; x++) {
    let n = 0;
    for (let y = m; y < H - m; y++) n += ink[y * W + x];
    if (n < ih * 0.92) continue;
    let above = 0, below = 0;
    for (let y = 0; y < m; y++) { above += ink[y * W + x]; below += ink[(H - 1 - y) * W + x]; }
    // a letter can fill a tight cover, but never reaches past it on both sides
    if (ih < lineH * 1.1 && (above < m * 0.6 || below < m * 0.6)) continue;
    for (let y = 0; y < ih; y++) keep[y * iw + x - m] = 1;
  }
  // horizontal rules: a long stretch of ink (small breaks allowed) that goes on past the cover, or is very long
  for (let y = m; y < H - m; y++) {
    let best = 0, run = 0, gap = 0, start = -1, bs = 0, be = 0;
    for (let x = 0; x < W; x++) {
      if (ink[y * W + x]) { if (run === 0) start = x; run += gap + 1; gap = 0; if (run > best) { best = run; bs = start; be = x; } }
      else if (run && ++gap > 2) { run = 0; gap = 0; }
    }
    const through = bs < m && be >= W - m;
    if (!(best >= Math.max(iw * 0.9, lineH * 3) || (through && best >= iw * 0.97))) continue;
    for (let x = Math.max(m, bs); x <= Math.min(W - m - 1, be); x++) keep[(y - m) * iw + x - m] = 1;
  }
  // copy the kept pixels, with their soft (anti-aliased) edges
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const q = y * iw + x;
    const near = keep[q] || (x > 0 && keep[q - 1]) || (x < iw - 1 && keep[q + 1]) || (y > 0 && keep[q - iw]) || (y < ih - 1 && keep[q + iw]);
    if (!near) continue;
    const p = (y + m) * W + x + m;
    if (!keep[q] && !ink[p] && Math.abs(lumOf(px, p * 4) - bL) < 6) continue;
    out.data.set(px.subarray(p * 4, p * 4 + 4), q * 4);
    out.data[q * 4 + 3] = 255;
  }
  return out;
}

/**
 * Straight rules of a rendered page (pixels `px`, `k` pixels per viewport unit), as rectangles in
 * viewport units. Strokes of letters (an "l", an underscore) are not rules: segments that stay
 * within a text line are left out.
 */
export function findRules(px: Uint8ClampedArray, W: number, H: number, k: number, runs: TextRun[], vm: M): RuleRect[] {
  // paper: the most common light value
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 16) hist[Math.round(lumOf(px, i))]++;
  let paper = 255, most = 0;
  for (let l = 120; l < 256; l++) if (hist[l] > most) { most = hist[l]; paper = l; }
  const thr = paper - 24;
  const dark = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) if (lumOf(px, i) < thr) dark[p] = 1;
  const maxT = Math.max(2, 5 * k); // rules are thin (≤ 5 pt)
  const boxes = runs.map((r) => runBox(r, vm)).filter((b) => Math.abs(b.angle) < 0.02);
  const inText = (x0: number, y0: number, x1: number, y1: number) => boxes.some((b) =>
    x0 >= (b.x - b.h * 0.3) * k && x1 <= (b.x + b.w + b.h * 0.3) * k && y0 >= (b.top - b.h * 0.25) * k && y1 <= (b.y + b.h * 0.45) * k);

  type Seg = { a: number; b: number; c0: number; c1: number }; // along a..b, across c0..c1
  const scan = (horiz: boolean, minLen: number): Seg[] => {
    const N = horiz ? H : W, L = horiz ? W : H;
    const at = horiz ? (c: number, t: number) => dark[c * W + t] : (c: number, t: number) => dark[t * W + c];
    const open: Seg[] = [], done: Seg[] = [];
    for (let c = 0; c < N; c++) {
      const found: [number, number][] = [];
      let s = -1, last = -1;
      for (let t = 0; t <= L; t++) {
        if (t < L && at(c, t)) { if (s < 0) s = t; last = t; }
        else if (s >= 0 && (t === L || t - last > 3)) { if (last - s + 1 >= minLen) found.push([s, last]); s = -1; }
      }
      // continue segments of the row/column before, or start new ones
      const next: Seg[] = [];
      for (const [a, b] of found) {
        const i = open.findIndex((g) => g.c1 === c - 1 && Math.min(g.b, b) - Math.max(g.a, a) > 0.8 * Math.min(g.b - g.a, b - a));
        if (i >= 0) { const g = open.splice(i, 1)[0]; next.push({ a: Math.min(g.a, a), b: Math.max(g.b, b), c0: g.c0, c1: c }); }
        else next.push({ a, b, c0: c, c1: c });
      }
      done.push(...open);
      open.length = 0; open.push(...next);
    }
    done.push(...open);
    return done.filter((g) => g.c1 - g.c0 + 1 <= maxT);
  };
  const out: RuleRect[] = [];
  const colorOf = (x0: number, y0: number, x1: number, y1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x += Math.max(1, ((x1 - x0) / 40) | 0)) {
      const p = y * W + x;
      if (!dark[p]) continue;
      r += px[p * 4]; g += px[p * 4 + 1]; b += px[p * 4 + 2]; n++;
    }
    return n ? hex(r / n, g / n, b / n) : '#000000';
  };
  for (const s of scan(true, Math.round(28 * k))) {
    if (inText(s.a, s.c0, s.b, s.c1)) continue;
    out.push({ x: s.a / k, y: s.c0 / k, w: (s.b - s.a + 1) / k, h: (s.c1 - s.c0 + 1) / k, color: colorOf(s.a, s.c0, s.b, s.c1) });
  }
  for (const s of scan(false, Math.round(12 * k))) {
    if (inText(s.c0, s.a, s.c1, s.b)) continue;
    out.push({ x: s.c0 / k, y: s.a / k, w: (s.c1 - s.c0 + 1) / k, h: (s.b - s.a + 1) / k, color: colorOf(s.c0, s.a, s.c1, s.b) });
  }
  return out;
}

const cache = new WeakMap<object, Map<number, Promise<RuleRect[]>>>();

/** the rules of a page (rendered once, then kept) */
export function pageRules(pdf: any, src: number, info: { w: number; h: number; vm: M }, runs: TextRun[]): Promise<RuleRect[]> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  let p = m.get(src);
  if (!p) {
    p = (async () => {
      if (typeof document === 'undefined') return [];
      const page = await pdf.getPage(src + 1);
      const k = Math.min(3, 2000 / Math.max(info.w, info.h));
      const vp = page.getViewport({ scale: k });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp, annotationMode: 0 }).promise;
      const px = x.getImageData(0, 0, c.width, c.height).data;
      c.width = c.height = 0;
      return findRules(px, Math.ceil(vp.width), Math.ceil(vp.height), k, runs, info.vm);
    })().catch((e) => { console.warn('rules', e); return []; });
    m.set(src, p);
  }
  return p;
}
