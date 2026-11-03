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
/** the page around a cover (more than its margin): where a patterned background is copied from */
export interface CoverCtx { px: Uint8ClampedArray; W: number; H: number; /** the region (with its margin) starts here */ x: number; y: number }

/** how far around a cover the page is looked at for its background (pixels, from the line height) */
export const ctxReach = (lineH: number) => ({ x: Math.round(lineH * 3), y: Math.round(lineH * 2.6) });

export function coverPixels(px: Uint8ClampedArray, W: number, H: number, m: number, bg: string, lineH: number, fg = '#000000', ctx?: CoverCtx): ImageData {
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
  const Lb = runMax(runMax(L, W, H, rb, true), W, H, rb, false);
  // ink: darker than the background nearby (so a tint or a second background colour isn't ink); for
  // rules, darker than both sides (where two background tones meet, only one side is lighter)
  const ink = new Uint8Array(W * H), vInk = new Uint8Array(W * H), hInk = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) ink[p] = Lb[p] - L[p] > 22 ? 1 : 0;
  // the lightest value within r2 on each side (from centred running maxima: an odd r2 = 2·rh + 1)
  const rh = Math.max(1, Math.round(lineH * 0.125)), r2 = 2 * rh + 1;
  const MX = runMax(L, W, H, rh, true), MY = runMax(L, W, H, rh, false);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!ink[p]) continue;
    // (at the region's edge the side outside counts as lighter)
    const a = x - r2 < 0 ? 255 : MX[p - 1 - rh], b2 = x + r2 >= W ? 255 : MX[p + 1 + rh];
    const c = y - r2 < 0 ? 255 : MY[p - (1 + rh) * W], d = y + r2 >= H ? 255 : MY[p + (1 + rh) * W];
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
  let holes = 0;
  for (let p = 0; p < W * H; p++) holes += hole[p];
  // (nearly all of the cover is letters: nothing to fill from, keep the paper colour)
  if (holes > iw * ih * 0.85) return flat();
  const put = (R: Float32Array | Uint8ClampedArray, G: Float32Array | Uint8ClampedArray, B: Float32Array | Uint8ClampedArray, at: (x: number, y: number) => number, known: (p: number) => boolean) => {
    for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
      const p = at(x + m, y + m), q = (y * iw + x) * 4;
      if (known(p)) { out.data[q] = R[p]; out.data[q + 1] = G[p]; out.data[q + 2] = B[p]; }
      else { out.data[q] = br; out.data[q + 1] = bgg; out.data[q + 2] = bb; }
      out.data[q + 3] = 255;
    }
    return out;
  };
  // A background with a pattern, a grain or a picture: the holes are filled with pieces of the same
  // background from around the line (the look stays; a smooth fill would show as a blurred band)
  if (ctx && holes && textured(px, W, H, hole)) {
    const { W: CW, H: CH } = ctx;
    const C = new Uint8ClampedArray(ctx.px);
    const cHole = new Uint8Array(CW * CH);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) {
      const cx = x + ctx.x, cy = y + ctx.y;
      if (cx >= 0 && cy >= 0 && cx < CW && cy < CH) cHole[cy * CW + cx] = 1;
    }
    // where pieces may not come from: letters and rules anywhere around, and the holes themselves
    const blocked = inkMask(C, CW, CH, lineH, fg, bL);
    for (let p = 0; p < CW * CH; p++) if (cHole[p]) blocked[p] = 1;
    const filled = patchFill(C, CW, CH, cHole, blocked, lineH);
    const R = new Float32Array(CW * CH), G = new Float32Array(CW * CH), B = new Float32Array(CW * CH), known = new Uint8Array(CW * CH);
    for (let p = 0, i = 0; p < CW * CH; p++, i += 4) { R[p] = C[i]; G[p] = C[i + 1]; B[p] = C[i + 2]; known[p] = cHole[p] && !filled[p] ? 0 : 1; }
    // anything no piece fitted: from the surroundings, as below
    smoothFill(R, G, B, known, CW, CH);
    return put(R, G, B, (x, y) => (y + ctx.y) * CW + x + ctx.x, (p) => known[p] === 1);
  }
  // filled in from the outside in: each pixel next to known ones takes their average
  const R = new Float32Array(W * H), G = new Float32Array(W * H), B = new Float32Array(W * H), known = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) { R[p] = px[i]; G[p] = px[i + 1]; B[p] = px[i + 2]; known[p] = hole[p] ? 0 : 1; }
  smoothFill(R, G, B, known, W, H);
  return put(R, G, B, (x, y) => y * W + x, (p) => known[p] === 1);
}

/** whether the background around the holes has a pattern or grain (else a smooth fill is right) */
function textured(px: Uint8ClampedArray, W: number, H: number, hole: Uint8Array): boolean {
  // neighbouring differences of the pixels that stay (paper between and around the letters)
  let s = 0, n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) {
    const p = y * W + x;
    if (hole[p] || hole[p + 1]) continue;
    const i = p * 4;
    s += Math.abs(px[i] - px[i + 4]) + Math.abs(px[i + 1] - px[i + 5]) + Math.abs(px[i + 2] - px[i + 6]);
    n++;
  }
  return n > 20 && s / n > 4.5;
}

/** letters and rules (ink clearly darker than the background nearby, as in coverPixels), a little widened */
function inkMask(px: Uint8ClampedArray, W: number, H: number, lineH: number, fg: string, bL: number): Uint8Array {
  const fL = hexLum(fg), inv = fL > bL;
  const L = new Float32Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) L[p] = inv ? 255 - lumOf(px, i) : lumOf(px, i);
  const fgL = inv ? 255 - fL : fL;
  const Lb = runMax(runMax(L, W, H, Math.max(2, Math.round(lineH * 0.3)), true), W, H, Math.max(2, Math.round(lineH * 0.3)), false);
  const ink = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (L[p] < Lb[p] - Math.max(25, 0.45 * (Lb[p] - fgL))) ink[p] = 1;
  const rd = Math.max(1, Math.round(lineH * 0.08));
  return dilate(ink, W, H, rd);
}

/** the largest value within r along rows (or columns), in O(n) (van Herk / Gil-Werman) */
function runMax(src: Float32Array, W: number, H: number, r: number, horiz: boolean): Float32Array {
  const out = new Float32Array(W * H);
  const n = horiz ? W : H, lines = horiz ? H : W, step = horiz ? 1 : W;
  const k = 2 * r + 1;
  const g = new Float32Array(n + k), h = new Float32Array(n + k), a = new Float32Array(n + 2 * r);
  for (let l = 0; l < lines; l++) {
    const base = horiz ? l * W : l;
    for (let i = 0; i < n + 2 * r; i++) { const j = Math.min(n - 1, Math.max(0, i - r)); a[i] = i - r < 0 || i - r >= n ? -Infinity : src[base + j * step]; }
    const len = n + 2 * r;
    for (let i = 0; i < len; i++) g[i] = i % k === 0 ? a[i] : Math.max(g[i - 1], a[i]);
    for (let i = len - 1; i >= 0; i--) h[i] = i === len - 1 || (i + 1) % k === 0 ? a[i] : Math.max(h[i + 1], a[i]);
    for (let i = 0; i < n; i++) out[base + i * step] = Math.max(h[i], g[Math.min(len - 1, i + 2 * r)]);
  }
  return out;
}

function dilate(m: Uint8Array, W: number, H: number, r: number): Uint8Array {
  const a = new Uint8Array(W * H), b = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= r) a[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= r) a[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (a[y * W + x]) last = y; if (y - last <= r) b[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (a[y * W + x]) last = y; if (last - y <= r) b[y * W + x] = 1; } }
  return b;
}

/**
 * Fills the holes with pieces of the background around them (texture synthesis): tile by tile, the
 * tile with the most known surroundings first, the piece whose surroundings match best is copied in
 * (only into the hole: the pixels that stay are never changed). Returns the filled pixels.
 */
function patchFill(C: Uint8ClampedArray, W: number, H: number, hole: Uint8Array, blocked: Uint8Array, lineH: number): Uint8Array {
  const n = W * H;
  const filled = new Uint8Array(n);
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return filled;
  const T = Math.max(6, Math.min(24, Math.round(lineH * 0.4))), r = Math.max(3, Math.round(T / 2));
  const { x: RX, y: RY } = ctxReach(lineH);
  // summed blocked counts: a piece must come from where nothing is blocked
  const S = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += blocked[y * W + x]; S[(y + 1) * (W + 1) + x + 1] = S[y * (W + 1) + x + 1] + row; } }
  const blk = (x0: number, y0: number, x1: number, y1: number) => S[(y1 + 1) * (W + 1) + x1 + 1] - S[y0 * (W + 1) + x1 + 1] - S[(y1 + 1) * (W + 1) + x0] + S[y0 * (W + 1) + x0];
  const known = new Uint8Array(n);
  for (let p = 0; p < n; p++) known[p] = hole[p] ? 0 : 1;
  type Tile = { x0: number; y0: number; x1: number; y1: number; done: boolean };
  const tiles: Tile[] = [];
  for (let ty = by0; ty <= by1; ty += T) for (let tx = bx0; tx <= bx1; tx += T) {
    const x1 = Math.min(W - 1, tx + T - 1), y1 = Math.min(H - 1, ty + T - 1);
    let any = false;
    for (let y = ty; y <= y1 && !any; y++) for (let x = tx; x <= x1; x++) if (hole[y * W + x]) { any = true; break; }
    if (any) tiles.push({ x0: tx, y0: ty, x1, y1, done: false });
  }
  const f = 3;
  const tp: number[] = [];
  const Y = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) Y[p] = 0.299 * C[i] + 0.587 * C[i + 1] + 0.114 * C[i + 2];
  for (let left = tiles.length; left > 0; left--) {
    let best: Tile | null = null, bk = -1;
    for (const t of tiles) if (!t.done) {
      let k = 0, c = 0;
      const wx0 = Math.max(0, t.x0 - r), wy0 = Math.max(0, t.y0 - r), wx1 = Math.min(W - 1, t.x1 + r), wy1 = Math.min(H - 1, t.y1 + r);
      for (let y = wy0; y <= wy1; y += 3) for (let x = wx0; x <= wx1; x += 3) { c++; k += known[y * W + x]; }
      if (k / c > bk) { bk = k / c; best = t; }
    }
    const t = best!; t.done = true;
    const wx0 = Math.max(0, t.x0 - r), wy0 = Math.max(0, t.y0 - r), wx1 = Math.min(W - 1, t.x1 + r), wy1 = Math.min(H - 1, t.y1 + r);
    tp.length = 0;
    for (let y = wy0; y <= wy1; y += 2) for (let x = wx0; x <= wx1; x += 2) if (known[y * W + x]) tp.push(y * W + x);
    if (tp.length < 8) continue;
    const cost = (d: number, step: number, lim: number) => {
      let e = 0;
      for (let i = 0; i < tp.length; i += step) {
        const p = tp[i] * 4, q = (tp[i] + d) * 4;
        const a = C[p] - C[q], b = C[p + 1] - C[q + 1], c = C[p + 2] - C[q + 2];
        e += a * a + b * b + c * c;
        if (e > lim) return e;
      }
      return e;
    };
    const coarse = (d: number, lim: number) => {
      let e = 0;
      for (let i = 0; i < tp.length; i += 5) { const a = Y[tp[i]] - Y[tp[i] + d]; e += a * a; if (e > lim) return e; }
      return e;
    };
    const okAt = (ox: number, oy: number) => wx0 + ox >= 0 && wy0 + oy >= 0 && wx1 + ox < W && wy1 + oy < H && blk(t.x0 + ox, t.y0 + oy, t.x1 + ox, t.y1 + oy) === 0;
    let bo: [number, number] | null = null, be = Infinity;
    // coarse: on the lightness, every fifth template point, every f-th place
    for (let oy = -RY; oy <= RY; oy += f) for (let ox = -RX; ox <= RX; ox += f) {
      if ((ox | oy) === 0 || !okAt(ox, oy)) continue;
      const e = coarse(oy * W + ox, be);
      if (e < be) { be = e; bo = [ox, oy]; }
    }
    if (!bo) continue;
    let [rx, ry] = bo;
    be = cost(ry * W + rx, 1, Infinity);
    for (let oy = bo[1] - f + 1; oy <= bo[1] + f - 1; oy++) for (let ox = bo[0] - f + 1; ox <= bo[0] + f - 1; ox++) {
      if ((ox === bo[0] && oy === bo[1]) || !okAt(ox, oy)) continue;
      const e = cost(oy * W + ox, 1, be);
      if (e < be) { be = e; rx = ox; ry = oy; }
    }
    const d = ry * W + rx;
    for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) {
      const p = y * W + x;
      if (known[p]) continue;
      const i = p * 4, j = (p + d) * 4;
      C[i] = C[j]; C[i + 1] = C[j + 1]; C[i + 2] = C[j + 2]; Y[p] = Y[p + d];
      known[p] = 1; filled[p] = 1;
    }
  }
  return filled;
}

/**
 * Fills the unknown pixels (known[p] === 0) from the outside in, each from the average of its known
 * neighbours (known[q] === 1; pixels marked 2 are neither used nor filled). Layer by layer, each pixel
 * once.
 */
function smoothFill(R: Float32Array, G: Float32Array, B: Float32Array, known: Uint8Array, W: number, H: number) {
  const use = (q: number) => known[q] === 1;
  let front: number[] = [];
  const queued = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (known[p] !== 0) continue;
    let near = false;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1) && !near; yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) if (use(yy * W + xx)) { near = true; break; }
    if (near) { front.push(p); queued[p] = 1; }
  }
  while (front.length) {
    const done: number[] = [];
    for (const p of front) {
      const x = p % W, y = (p - x) / W;
      let r = 0, g = 0, b = 0, c = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
        const q = yy * W + xx;
        if (use(q)) { r += R[q]; g += G[q]; b += B[q]; c++; }
      }
      if (c) { R[p] = r / c; G[p] = g / c; B[p] = b / c; done.push(p); }
    }
    for (const p of done) known[p] = 1;
    const next: number[] = [];
    for (const p of done) {
      const x = p % W, y = (p - x) / W;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(H - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(W - 1, x + 1); xx++) {
        const q = yy * W + xx;
        if (known[q] === 0 && !queued[q]) { queued[q] = 1; next.push(q); }
      }
    }
    front = next;
  }
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
  // the page around it, for a patterned background
  const reach = ctxReach(lineH * k);
  const cx0 = Math.max(0, x0 - m - reach.x), cy0 = Math.max(0, y0 - m - reach.y);
  const cx1 = Math.min(PW, x1 + m + reach.x), cy1 = Math.min(PH, y1 + m + reach.y);
  let ctx: CoverCtx | undefined;
  if (cx1 - cx0 >= W && cy1 - cy0 >= H && (cx1 - cx0) * (cy1 - cy0) < 1.2e7) {
    const CW = cx1 - cx0, CH = cy1 - cy0, cp = new Uint8ClampedArray(CW * CH * 4);
    for (let y = 0; y < CH; y++) cp.set(px.subarray(((y + cy0) * PW + cx0) * 4, ((y + cy0) * PW + cx1) * 4), y * CW * 4);
    ctx = { px: cp, W: CW, H: CH, x: x0 - m - cx0, y: y0 - m - cy0 };
  }
  const img = coverPixels(reg, W, H, m, bg, lineH * k, fg, ctx);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  c.width = c.height = 0;
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), x: x0 / k, y: y0 / k, w: (x1 - x0) / k, h: (y1 - y0) / k };
}
