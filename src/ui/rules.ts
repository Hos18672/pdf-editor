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
 * The cover for a line, made from the page as it is shown: the page itself, with only the old letters
 * taken out and filled in from the background around them (a pattern, a tint, two colours meeting
 * under the line all stay as they were). Rules that cross it (a column inked through the whole cover
 * and beyond it, a row inked along most of it) keep their pixels. `px` is the region with `m` extra
 * pixels on every side (used to see whether ink continues past the cover, and as known background
 * to fill from); the result is the inner region. `fg`: the letters' colour.
 */
export function coverPixels(px: Uint8ClampedArray, W: number, H: number, m: number, bg: string, lineH: number, fg = '#000000'): ImageData {
  const iw = W - 2 * m, ih = H - 2 * m;
  const out = new ImageData(Math.max(1, iw), Math.max(1, ih));
  const v = parseInt(bg.replace('#', ''), 16);
  const br = (v >> 16) & 255, bgg = (v >> 8) & 255, bb = v & 255, bL = hexLum(bg);
  const flat = () => { for (let i = 0; i < out.data.length; i += 4) { out.data[i] = br; out.data[i + 1] = bgg; out.data[i + 2] = bb; out.data[i + 3] = 255; } return out; };
  if (iw < 2 || ih < 2) return flat();
  // the letters: clearly towards the letters' colour from the brightest (or, for light letters on a dark
  // ground, darkest) background nearby; a fine pattern or a tint is far less than that
  const fL = hexLum(fg), inv = fL > bL;
  const L = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) L[p] = inv ? 255 - lumOf(px, i) : lumOf(px, i);
  const fgL = inv ? 255 - fL : fL;
  const rb = Math.max(2, Math.round(lineH * 0.3));
  const runMaxLine = (src: Float32Array, horiz: boolean) => {
    const o = new Float32Array(W * H);
    if (horiz) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let mx = 0; for (let t = Math.max(0, x - rb); t <= Math.min(W - 1, x + rb); t++) mx = Math.max(mx, src[y * W + t]); o[y * W + x] = mx; }
    else for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let mx = 0; for (let t = Math.max(0, y - rb); t <= Math.min(H - 1, y + rb); t++) mx = Math.max(mx, src[t * W + x]); o[y * W + x] = mx; }
    return o;
  };
  const Lb = runMaxLine(runMaxLine(L, true), false);
  // ink: darker than the background nearby (so a tint or a second background colour isn't ink); for
  // rules, darker than both sides (where two background tones meet, only one side is lighter)
  const ink = new Uint8Array(W * H), vInk = new Uint8Array(W * H), hInk = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = Lb[p] - L[p] > 22 ? 1 : 0;
  const r2 = Math.max(3, Math.round(lineH * 0.25));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!ink[p]) continue;
    let a = 0, b2 = 0, c = 0, d = 0;
    for (let t = 1; t <= r2; t++) {
      if (x - t >= 0) a = Math.max(a, L[p - t]); if (x + t < W) b2 = Math.max(b2, L[p + t]);
      if (y - t >= 0) c = Math.max(c, L[p - t * W]); if (y + t < H) d = Math.max(d, L[p + t * W]);
    }
    // (at the region's edge the side outside counts as lighter)
    if (x - r2 < 0) a = 255; if (x + r2 >= W) b2 = 255; if (y - r2 < 0) c = 255; if (y + r2 >= H) d = 255;
    if (Math.min(a, b2) - L[p] > 22) vInk[p] = 1;
    if (Math.min(c, d) - L[p] > 22) hInk[p] = 1;
  }
  // keep: rules, in full-region coordinates
  const keep = new Uint8Array(W * H);
  // vertical rules: inked in nearly every row of the cover, and still inked just above and below it
  for (let x = m; x < W - m; x++) {
    let n = 0;
    for (let y = m; y < H - m; y++) n += vInk[y * W + x];
    if (n < ih * 0.92) continue;
    let above = 0, below = 0;
    for (let y = 0; y < m; y++) { above += vInk[y * W + x]; below += vInk[(H - 1 - y) * W + x]; }
    // a letter can fill a tight cover, but never reaches past it on both sides
    if (ih < lineH * 1.1 && (above < m * 0.6 || below < m * 0.6)) continue;
    for (let y = 0; y < H; y++) keep[y * W + x] = 1;
  }
  // horizontal rules: a long stretch of ink (small breaks allowed) that goes on past the cover, or is very long
  for (let y = m; y < H - m; y++) {
    let best = 0, run = 0, gap = 0, start = -1, bs = 0, be = 0;
    for (let x = 0; x < W; x++) {
      if (hInk[y * W + x]) { if (run === 0) start = x; run += gap + 1; gap = 0; if (run > best) { best = run; bs = start; be = x; } }
      else if (run && ++gap > 2) { run = 0; gap = 0; }
    }
    const through = bs < m && be >= W - m;
    if (!(best >= Math.max(iw * 0.9, lineH * 3) || (through && best >= iw * 0.97))) continue;
    for (let x = bs; x <= be; x++) keep[y * W + x] = 1;
  }
  // a rule's soft (anti-aliased) edges stay with it
  const keep2 = new Uint8Array(keep);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const q = y * W + x;
    if (keep[q] || !((x > 0 && keep[q - 1]) || (x < W - 1 && keep[q + 1]) || (y > 0 && keep[q - W]) || (y < H - 1 && keep[q + W]))) continue;
    if (ink[q] || Lb[q] - L[q] >= 6) keep2[q] = 1;
  }
  const letter = new Uint8Array(W * H);
  let any = 0;
  for (let p = 0; p < W * H; p++) if (!keep2[p] && L[p] < Lb[p] - Math.max(25, 0.45 * (Lb[p] - fgL))) { letter[p] = 1; any++; }
  // with their soft edges (and a scan's blur and ringing)
  const rd = Math.max(1, Math.round(lineH * 0.08));
  const hole = new Uint8Array(W * H);
  if (any) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!letter[y * W + x]) continue;
    for (let yy = Math.max(0, y - rd); yy <= Math.min(H - 1, y + rd); yy++) for (let xx = Math.max(0, x - rd); xx <= Math.min(W - 1, x + rd); xx++) if (!keep2[yy * W + xx]) hole[yy * W + xx] = 1;
  }
  // filled in from the outside in: each round, the pixels next to known ones take their average
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H), known = new Uint8Array(W * H);
  let holes = 0;
  for (let p = 0, i = 0; p < W * H; p++, i += 4) { R[p] = px[i]; G[p] = px[i + 1]; B[p] = px[i + 2]; known[p] = hole[p] ? 0 : 1; if (hole[p]) holes++; }
  // (nearly all of the cover is letters: nothing to fill from, keep the paper colour)
  if (holes > iw * ih * 0.85) return flat();
  const next: number[] = [];
  for (let round = 0; holes > 0 && round < 400; round++) {
    next.length = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (known[p]) continue;
      let r = 0, g = 0, b2 = 0, n = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
        const q = yy * W + xx;
        if (known[q] === 1) { r += R[q]; g += G[q]; b2 += B[q]; n++; }
      }
      if (n) { R[p] = r / n; G[p] = g / n; B[p] = b2 / n; next.push(p); }
    }
    if (!next.length) break;
    for (const p of next) known[p] = 1;
    holes -= next.length;
  }
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    const p = (y + m) * W + x + m, q = (y * iw + x) * 4;
    if (known[p]) { out.data[q] = R[p]; out.data[q + 1] = G[p]; out.data[q + 2] = B[p]; }
    else { out.data[q] = br; out.data[q + 1] = bgg; out.data[q + 2] = bb; }
    out.data[q + 3] = 255;
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

// the page as rendered for covers in the saved file (the last two pages asked for)
const shots: { pdf: any; src: number; p: Promise<{ px: Uint8ClampedArray; W: number; H: number; k: number } | null> }[] = [];
function pageShot(pdf: any, src: number, info: { w: number; h: number }) {
  let s = shots.find((x) => x.pdf === pdf && x.src === src);
  if (!s) {
    s = { pdf, src, p: (async () => {
      if (typeof document === 'undefined') return null;
      const page = await pdf.getPage(src + 1);
      const k = Math.min(3, 2400 / Math.max(info.w, info.h));
      const vp = page.getViewport({ scale: k });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp, annotationMode: 0 }).promise;
      const px = x.getImageData(0, 0, c.width, c.height).data;
      const W = c.width, H = c.height;
      c.width = c.height = 0;
      return { px, W, H, k };
    })().catch((e) => { console.warn('cover shot', e); return null; }) };
    shots.unshift(s);
    shots.length = Math.min(shots.length, 2);
  }
  return s.p;
}

/**
 * The cover for a line in the saved file: the page under `rect` (viewport units) with the old letters
 * filled in from the background around them, as a PNG (null: page not available).
 */
export async function pageCover(pdf: any, src: number, info: { w: number; h: number }, rect: { x: number; y: number; w: number; h: number }, lineH: number, bg: string, fg: string): Promise<{ png: Uint8Array; x: number; y: number; w: number; h: number } | null> {
  const shot = await pageShot(pdf, src, info);
  if (!shot) return null;
  const { px, W: PW, H: PH, k } = shot;
  const m = Math.max(2, Math.round(k * 1.5));
  const x0 = Math.floor(rect.x * k), y0 = Math.floor(rect.y * k), x1 = Math.ceil((rect.x + rect.w) * k), y1 = Math.ceil((rect.y + rect.h) * k);
  const W = x1 - x0 + 2 * m, H = y1 - y0 + 2 * m;
  if (x1 - x0 < 2 || y1 - y0 < 2 || W * H > 6e6) return null;
  // the region with its margin (paper colour outside the page)
  const v = parseInt(bg.replace('#', ''), 16);
  const reg = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x + x0 - m, sy = y + y0 - m, o = (y * W + x) * 4;
    if (sx >= 0 && sy >= 0 && sx < PW && sy < PH) reg.set(px.subarray((sy * PW + sx) * 4, (sy * PW + sx) * 4 + 4), o);
    else { reg[o] = (v >> 16) & 255; reg[o + 1] = (v >> 8) & 255; reg[o + 2] = v & 255; reg[o + 3] = 255; }
  }
  const img = coverPixels(reg, W, H, m, bg, lineH * k, fg);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  c.width = c.height = 0;
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
}
