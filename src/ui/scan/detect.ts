// Finds the sheet / card in a photo: its four corners, precisely enough to crop without a border.
//
// 1. A small copy of the photo (~400 px) is cleaned of text (grey closing) and softened.
// 2. Edges come from brightness and colour (white paper on a light desk still differs in colour).
// 3. Straight lines are found with an orientation-guided Hough transform; every two roughly parallel
//    pairs form a candidate quad, scored by how much of its outline is really an edge, its size and
//    shape. The largest bright blob gives one more candidate for sheets without clean straight edges.
// 4. The winner is refined on a larger copy: along each side the exact edge position is measured at
//    many points (sub-pixel) and a robust line fit gives the final corners.
import { aspectOf, cornerAngles, intersect, isConvex, orderQuad, quadArea, type Pt, type Quad } from './geom';

export interface Rgba { w: number; h: number; data: Uint8ClampedArray | Uint8Array }
export interface Detection { quad: Quad; score: number; support: number[] }

const DEG = Math.PI / 180;

export function luminance(img: Rgba): Float32Array {
  const n = img.w * img.h, L = new Float32Array(n), d = img.data;
  for (let i = 0, p = 0; p < n; i += 4, p++) L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return L;
}

function chroma(img: Rgba): Float32Array {
  const n = img.w * img.h, S = new Float32Array(n), d = img.data;
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    S[p] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return S;
}

/** separable running max (dilate) or min (erode), radius r */
function morph(a: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const sg = max ? 1 : -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const lo = x - r < 0 ? 0 : x - r, hi = x + r >= w ? w - 1 : x + r;
      let v = a[row + lo] * sg;
      for (let k = lo + 1; k <= hi; k++) { const u = a[row + k] * sg; if (u > v) v = u; }
      t[row + x] = v * sg;
    }
  }
  for (let y = 0; y < h; y++) {
    const lo = y - r < 0 ? 0 : y - r, hi = y + r >= h ? h - 1 : y + r;
    for (let x = 0; x < w; x++) {
      let v = t[lo * w + x] * sg;
      for (let k = lo + 1; k <= hi; k++) { const u = t[k * w + x] * sg; if (u > v) v = u; }
      o[y * w + x] = v * sg;
    }
  }
  return o;
}

export function blur(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(sigma * 2.5));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const K = k.length;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (x >= r && x < w - r) { const b = row + x - r; for (let i = 0; i < K; i++) v += a[b + i] * k[i]; }
      else for (let i = -r; i <= r; i++) { const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i; v += a[row + xx] * k[i + r]; }
      t[row + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const inner = y >= r && y < h - r;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (inner) { let b = (y - r) * w + x; for (let i = 0; i < K; i++, b += w) v += t[b] * k[i]; }
      else for (let i = -r; i <= r; i++) { const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i; v += t[yy * w + x] * k[i + r]; }
      o[y * w + x] = v;
    }
  }
  return o;
}

interface EdgeMap { w: number; h: number; on: Uint8Array; ang: Float32Array; mag: Float32Array; L: Float32Array; list: Int32Array }

export function edgeMap(img: Rgba): EdgeMap {
  const { w, h } = img, n = w * h;
  const r = Math.max(1, Math.round(Math.min(w, h) / 170));
  // closing removes dark text and thin lines on the sheet, keeps its outline in place
  let L = morph(morph(luminance(img), w, h, r, true), w, h, r, false);
  L = blur(L, w, h, 1.1);
  const S = blur(chroma(img), w, h, 1.4);
  const mag = new Float32Array(n), ang = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const lx = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1]) / 8;
    const ly = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]) / 8;
    const sx = (S[i - w + 1] + 2 * S[i + 1] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - 1] - S[i + w - 1]) / 8 * 0.8;
    const sy = (S[i + w - 1] + 2 * S[i + w] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - w] - S[i - w + 1]) / 8 * 0.8;
    const ml = lx * lx + ly * ly, ms = sx * sx + sy * sy;
    if (ml >= ms) { mag[i] = Math.sqrt(ml); ang[i] = Math.atan2(ly, lx); } else { mag[i] = Math.sqrt(ms); ang[i] = Math.atan2(sy, sx); }
  }
  // thresholds from the gradient distribution
  const bins = new Uint32Array(256);
  for (let i = 0; i < n; i++) bins[Math.min(255, (mag[i] * 4) | 0)]++;
  const pct = (q: number) => { let c = 0; for (let b = 0; b < 256; b++) { c += bins[b]; if (c >= q * n) return b / 4; } return 64; };
  const high = Math.max(2.5, Math.min(16, pct(0.9))), low = high * 0.45;
  // non-maximum suppression
  const nms = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, m = mag[i];
    if (m < low) continue;
    let a = ang[i]; if (a < 0) a += Math.PI;
    let o1: number, o2: number;
    if (a < 22.5 * DEG || a >= 157.5 * DEG) { o1 = i - 1; o2 = i + 1; }
    else if (a < 67.5 * DEG) { o1 = i - w - 1; o2 = i + w + 1; }
    else if (a < 112.5 * DEG) { o1 = i - w; o2 = i + w; }
    else { o1 = i - w + 1; o2 = i + w - 1; }
    if (m >= mag[o1] && m >= mag[o2]) nms[i] = m >= high ? 2 : 1;
  }
  // hysteresis
  const on = new Uint8Array(n), stack: number[] = [];
  const nb = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  for (let i = 0; i < n; i++) if (nms[i] === 2 && !on[i]) {
    on[i] = 1; stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      for (let q = 0; q < 8; q++) { const k = j + nb[q]; if (nms[k] && !on[k]) { on[k] = 1; stack.push(k); } }
    }
  }
  let cnt = 0;
  for (let i = 0; i < n; i++) if (on[i]) cnt++;
  const list = new Int32Array(cnt);
  for (let i = 0, k = 0; i < n; i++) if (on[i]) list[k++] = i;
  return { w, h, on, ang, mag, L, list };
}

interface Line { a: number; b: number; c: number; border?: boolean; votes: number }

/** angle between two line normals, 0…90° */
const angDiff = (l1: Line, l2: Line) => {
  const d = Math.abs(Math.atan2(l1.b, l1.a) - Math.atan2(l2.b, l2.a)) % Math.PI;
  return (Math.min(d, Math.PI - d) * 180) / Math.PI;
};

export function houghLines(E: EdgeMap, max: number): Line[] {
  const { w, h, list, ang } = E;
  const cx = w / 2, cy = h / 2, R = Math.ceil(Math.hypot(w, h) / 2) + 2, NR = 2 * R + 1, NT = 180;
  const cos = new Float32Array(NT), sin = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cos[t] = Math.cos(t * DEG); sin[t] = Math.sin(t * DEG); }
  const acc = new Uint16Array(NT * NR);
  for (let k = 0; k < list.length; k++) {
    const i = list[k], x = (i % w) - cx, y = ((i / w) | 0) - cy;
    let a = ang[i]; if (a < 0) a += Math.PI;
    const t0 = Math.round(a / DEG);
    for (let dt = -5; dt <= 5; dt++) {
      let t = t0 + dt;
      if (t < 0) t += NT; else if (t >= NT) t -= NT;
      const rho = Math.round(x * cos[t] + y * sin[t]);
      acc[t * NR + rho + R]++;
    }
  }
  const minVotes = Math.max(12, Math.min(w, h) * 0.1);
  const peaks: { t: number; r: number; v: number }[] = [];
  for (let t = 0; t < NT; t++) for (let r = 2; r < NR - 2; r++) {
    const v = acc[t * NR + r];
    if (v < minVotes) continue;
    let peak = true;
    for (let dt = -2; dt <= 2 && peak; dt++) for (let dr = -3; dr <= 3; dr++) {
      if (!dt && !dr) continue;
      let tt = t + dt, rr = r + dr;
      if (tt < 0) { tt += NT; rr = NR - 1 - rr; } else if (tt >= NT) { tt -= NT; rr = NR - 1 - rr; }
      if (rr < 0 || rr >= NR) continue;
      const u = acc[tt * NR + rr];
      if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) { peak = false; break; }
    }
    if (peak) peaks.push({ t, r: r - R, v });
  }
  peaks.sort((p, q) => q.v - p.v);
  const lines: Line[] = [];
  for (const p of peaks) {
    if (lines.length >= max) break;
    // refine with the edge pixels near the line (total least squares)
    const ct = cos[p.t], st = sin[p.t];
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
    for (let k = 0; k < list.length; k++) {
      const i = list[k], x = (i % w) - cx, y = ((i / w) | 0) - cy;
      if (Math.abs(x * ct + y * st - p.r) > 1.6) continue;
      let a = ang[i]; if (a < 0) a += Math.PI;
      let d = Math.abs(a - p.t * DEG); d = Math.min(d, Math.PI - d);
      if (d > 12 * DEG) continue;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; m++;
    }
    let a = ct, b = st, c = p.r;
    if (m >= 8) {
      const mx = sx / m, my = sy / m, cxx = sxx / m - mx * mx, cyy = syy / m - my * my, cxy = sxy / m - mx * my;
      // normal = eigenvector of the smaller eigenvalue
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // direction of the line
      a = -Math.sin(th); b = Math.cos(th);
      c = a * mx + b * my;
    }
    const line: Line = { a, b, c: c + a * cx + b * cy, votes: p.v };
    // drop near-duplicates
    if (lines.some((l) => angDiff(l, line) < 3 && Math.abs(signedC(l, line)) < Math.max(4, Math.min(w, h) * 0.015))) continue;
    lines.push(line);
  }
  return lines;
}

/** offset between two nearly parallel lines, measured at their mid point */
function signedC(l1: Line, l2: Line): number {
  const s = l1.a * l2.a + l1.b * l2.b < 0 ? -1 : 1;
  return l1.c - s * l2.c;
}

/** share of the segment that lies on an edge with the matching direction */
function support(E: EdgeMap, p: Pt, q: Pt): number {
  const { w, h, on, ang } = E;
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (len < 2) return 0;
  const nA = Math.atan2(q.x - p.x, -(q.y - p.y)); // normal direction
  const steps = Math.max(4, Math.floor(len / 1.5));
  let hit = 0, tot = 0;
  for (let s = 0; s <= steps; s++) {
    const t = 0.04 + (0.92 * s) / steps;
    const x = Math.round(p.x + (q.x - p.x) * t), y = Math.round(p.y + (q.y - p.y) * t);
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
    tot++;
    let ok = false;
    for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = (y + dy) * w + x + dx;
      if (!on[i]) continue;
      let d = Math.abs(ang[i] - nA) % Math.PI;
      d = Math.min(d, Math.PI - d);
      if (d < 20 * DEG) { ok = true; break; }
    }
    if (ok) hit++;
  }
  return tot ? hit / tot : 0;
}

/** brightness inside minus outside along a side (quad given clockwise) */
function contrast(E: EdgeMap, p: Pt, q: Pt): number {
  const { w, h, L } = E;
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len; // points inward for a clockwise quad (y down)
  let s = 0, c = 0;
  for (let t = 0.15; t <= 0.85; t += 0.05) {
    const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
    const xi = Math.round(x + nx * 4), yi = Math.round(y + ny * 4), xo = Math.round(x - nx * 4), yo = Math.round(y - ny * 4);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
    s += L[yi * w + xi] - L[yo * w + xo]; c++;
  }
  return c ? s / c : 0;
}

/** Largest bright region → hull → best quad (for sheets whose sides aren't clean straight lines). */
function blobQuad(E: EdgeMap): Quad | null {
  const { w, h, L } = E, n = w * h;
  // Otsu threshold
  const hist = new Float64Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, L[i] | 0))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  const lab = new Int32Array(n).fill(-1);
  let bestId = -1, bestSize = 0, id = 0;
  const q: number[] = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -1 || L[s] <= thr) continue;
    let size = 0;
    lab[s] = id; q.length = 0; q.push(s);
    while (q.length) {
      const j = q.pop()!; size++;
      const x = j % w;
      if (x > 0 && lab[j - 1] === -1 && L[j - 1] > thr) { lab[j - 1] = id; q.push(j - 1); }
      if (x < w - 1 && lab[j + 1] === -1 && L[j + 1] > thr) { lab[j + 1] = id; q.push(j + 1); }
      if (j >= w && lab[j - w] === -1 && L[j - w] > thr) { lab[j - w] = id; q.push(j - w); }
      if (j < n - w && lab[j + w] === -1 && L[j + w] > thr) { lab[j + w] = id; q.push(j + w); }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
    id++;
  }
  if (bestSize < n * 0.06 || bestSize > n * 0.97) return null;
  // extreme points per row → convex hull
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (lab[y * w + x] === bestId) { if (l < 0) l = x; r = x; }
    if (l >= 0) { pts.push({ x: l, y }); if (r !== l) pts.push({ x: r + 1, y }); }
  }
  const hull = convexHull(pts);
  if (hull.length < 4) return null;
  // maximum-area quad on the hull vertices
  const H = hull.length;
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  let bestA = 0, bq: Pt[] | null = null;
  const step = Math.max(1, Math.floor(H / 60));
  for (let i = 0; i < H; i += step) for (let k = i + 2; k < H; k += step) {
    let m1 = 0, j1 = -1, m2 = 0, j2 = -1;
    for (let j = i + 1; j < k; j++) { const a = tri(hull[i], hull[j], hull[k]); if (a > m1) { m1 = a; j1 = j; } }
    for (let j = k + 1; j < i + H; j++) { const a = tri(hull[i], hull[k], hull[j % H]); if (a > m2) { m2 = a; j2 = j % H; } }
    if (j1 >= 0 && j2 >= 0 && m1 + m2 > bestA) { bestA = m1 + m2; bq = [hull[i], hull[j1], hull[k], hull[j2]]; }
  }
  if (!bq) return null;
  // straighten each side with a line fit to the hull boundary near it
  const sides: Line[] = [];
  for (let s = 0; s < 4; s++) {
    const p = bq[s], qq = bq[(s + 1) % 4];
    const len = Math.hypot(qq.x - p.x, qq.y - p.y) || 1;
    const dx = (qq.x - p.x) / len, dy = (qq.y - p.y) / len, a = -dy, b = dx, c = a * p.x + b * p.y;
    const near = pts.filter((t) => {
      const along = (t.x - p.x) * dx + (t.y - p.y) * dy;
      return along > len * 0.12 && along < len * 0.88 && Math.abs(a * t.x + b * t.y - c) < Math.max(3, len * 0.04);
    });
    sides.push(near.length >= 6 ? fitLine(near) ?? { a, b, c, votes: 0 } : { a, b, c, votes: 0 });
  }
  const corners: Pt[] = [];
  for (let s = 0; s < 4; s++) { const c = intersect(sides[(s + 3) % 4], sides[s]); if (!c) return null; corners.push(c); }
  return isConvex(corners) ? orderQuad(corners) : orderQuad(bq);
}

function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

function fitLine(pts: Pt[], wts?: number[]): Line | null {
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < pts.length; i++) { const k = wts ? wts[i] : 1; sw += k; sx += k * pts[i].x; sy += k * pts[i].y; }
  if (sw <= 0) return null;
  const mx = sx / sw, my = sy / sw;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const k = wts ? wts[i] : 1, dx = pts[i].x - mx, dy = pts[i].y - my;
    cxx += k * dx * dx; cyy += k * dy * dy; cxy += k * dx * dy;
  }
  const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const a = -Math.sin(th), b = Math.cos(th);
  return { a, b, c: a * mx + b * my, votes: 0 };
}

/**
 * Finds the document in a small image (longest side ~300–640 px).
 * Returns null when nothing plausible is there.
 */
export function detectQuad(img: Rgba, opts: { maxLines?: number; live?: boolean; ratios?: number[] } = {}): Detection | null {
  const E = edgeMap(img);
  const { w, h } = E;
  const minDim = Math.min(w, h);
  const lines = houghLines(E, opts.maxLines ?? (opts.live ? 14 : 20));
  // the image border can stand in for a side that runs out of the picture
  const borders: Line[] = [
    { a: 1, b: 0, c: 0.5, border: true, votes: 0 }, { a: 1, b: 0, c: w - 1.5, border: true, votes: 0 },
    { a: 0, b: 1, c: 0.5, border: true, votes: 0 }, { a: 0, b: 1, c: h - 1.5, border: true, votes: 0 },
  ];
  const all = lines.concat(borders);
  const N = all.length;
  const pairs: [number, number][] = [];
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    const li = all[i], lj = all[j];
    if (angDiff(li, lj) > 32) continue;
    // far enough apart (distance of the two lines at the image centre)
    const di = li.a * (w / 2) + li.b * (h / 2) - li.c, dj = lj.a * (w / 2) + lj.b * (h / 2) - lj.c;
    const s = li.a * lj.a + li.b * lj.b < 0 ? -1 : 1;
    if (Math.abs(di - s * dj) < minDim * 0.14) continue;
    pairs.push([i, j]);
  }
  const supCache = new Map<string, number>();
  const sideSupport = (line: number, from: number, to: number, p: Pt, q: Pt) => {
    if (all[line].border) return 0.42;
    const key = line + ':' + Math.min(from, to) + ':' + Math.max(from, to);
    let v = supCache.get(key);
    if (v === undefined) { v = support(E, p, q); supCache.set(key, v); }
    return v;
  };
  const xMin = -0.04 * w, xMax = 1.04 * w, yMin = -0.04 * h, yMax = 1.04 * h;
  let best: Detection | null = null;
  const cands: Detection[] = [];
  const consider = (q: Quad, sup: number[]) => {
    const area = quadArea(q) / (w * h);
    if (area < 0.05) return;
    const lens = [0, 1, 2, 3].map((s) => Math.hypot(q[(s + 1) % 4].x - q[s].x, q[(s + 1) % 4].y - q[s].y));
    if (Math.min(...lens) < minDim * 0.1) return;
    const angs = cornerAngles(q);
    if (angs.some((a) => a < 30 || a > 150)) return;
    const per = lens.reduce((s, l) => s + l, 0);
    const fit = lens.reduce((s, l, k) => s + l * sup[k], 0) / per;
    const minSup = Math.min(...sup);
    if (minSup < 0.22) return;
    const anglePen = angs.reduce((s, a) => s + Math.max(0, Math.abs(a - 90) - 22) / 40, 0);
    // a sheet is usually brighter than what it lies on, on every side
    const con = [0, 1, 2, 3].map((s) => contrast(E, q[s], q[(s + 1) % 4]));
    const pol = con.every((c) => c > 6) ? 0.03 : con.every((c) => c < -6) ? -0.05 : 0;
    const borderSides = sup.filter((s) => s === 0.42).length;
    // the expected shape (ID card, passport page) when the caller knows it
    let shape = 0;
    if (opts.ratios?.length) {
      const r = aspectOf(q, w, h);
      shape = opts.ratios.some((t) => Math.abs(Math.log(r / t)) < 0.09 || Math.abs(Math.log(r * t)) < 0.09) ? 0.07 : 0;
    }
    const score = 0.5 * fit + 0.3 * minSup + 0.38 * Math.sqrt(area) - 0.3 * anglePen + pol - 0.05 * borderSides + shape;
    if ((globalThis as any).__detDebug) (globalThis as any).__detDebug.push({ score, fit, minSup, area, anglePen, pol, sup, con, q });
    const det = { quad: q, score, support: sup };
    cands.push(det);
    if (!best || score > best.score) best = det;
  };
  for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
    const [i, j] = pairs[a], [k, l] = pairs[b];
    if (i === k || i === l || j === k || j === l) continue;
    if (angDiff(all[i], all[k]) < 40 || angDiff(all[i], all[l]) < 40 || angDiff(all[j], all[k]) < 40 || angDiff(all[j], all[l]) < 40) continue;
    const c1 = intersect(all[i], all[k]), c2 = intersect(all[k], all[j]), c3 = intersect(all[j], all[l]), c4 = intersect(all[l], all[i]);
    if (!c1 || !c2 || !c3 || !c4) continue;
    const cs = [c1, c2, c3, c4];
    if (cs.some((c) => c.x < xMin || c.x > xMax || c.y < yMin || c.y > yMax)) continue;
    if (!isConvex(cs)) continue;
    // sides in order: i (c4→c1), k (c1→c2), j (c2→c3), l (c3→c4)
    const sideLines = [i, k, j, l];
    const ends: [Pt, Pt][] = [[c4, c1], [c1, c2], [c2, c3], [c3, c4]];
    const nb: [number, number][] = [[l, k], [i, j], [k, l], [j, i]];
    const supRaw = sideLines.map((ln, s) => sideSupport(ln, nb[s][0], nb[s][1], ends[s][0], ends[s][1]));
    const q = orderQuad(cs);
    // support per side of the ordered quad (match by midpoint)
    const sup = [0, 1, 2, 3].map((s) => {
      const mx = (q[s].x + q[(s + 1) % 4].x) / 2, my = (q[s].y + q[(s + 1) % 4].y) / 2;
      let bi = 0, bd = Infinity;
      ends.forEach(([p, r], t) => { const d = Math.hypot((p.x + r.x) / 2 - mx, (p.y + r.y) / 2 - my); if (d < bd) { bd = d; bi = t; } });
      return supRaw[bi];
    });
    consider(q, sup);
  }
  if (!opts.live) {
    const bq = blobQuad(E);
    if (bq) consider(bq, [0, 1, 2, 3].map((s) => support(E, bq[s], bq[(s + 1) % 4])));
  }
  let res = best as Detection | null;
  if (!res) return null;
  // A band or frame printed along the edge (ID card header, table border) makes an inner outline that
  // scores like the sheet itself: when a clearly outlined quad encloses the winner, take the outer one.
  for (let guard = 0; guard < 4; guard++) {
    const inner: Detection = res;
    const outer = cands.filter((c) => c !== inner && c.score > inner.score - 0.09 && Math.min(...c.support) >= 0.85 &&
      quadArea(c.quad) > quadArea(inner.quad) * 1.04 && inner.quad.every((p) => inside(c.quad, p, 2)))
      .sort((a, b) => b.score - a.score)[0];
    if (!outer) break;
    res = outer;
  }
  // corners may lie a little outside the picture (sheet cut off): keep the true geometry
  return res;
}

/** point inside a convex quad (with a tolerance in pixels) */
function inside(q: Quad, p: Pt, tol: number): boolean {
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // clockwise quad (y down): inside is to the right of each side
    if (((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len < -tol) return false;
  }
  return true;
}

/** bilinear sample of a grey image */
function at(L: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0; else if (x > w - 1.001) x = w - 1.001;
  if (y < 0) y = 0; else if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + w] * (1 - fx) + L[i + w + 1] * fx) * fy;
}

/**
 * Moves each side onto the exact edge in a larger grey image (quad given in that image's pixels).
 * Sides with no clear edge (e.g. running along the picture border) stay where they are.
 */
export function refineQuad(L: Float32Array, w: number, h: number, q: Quad): Quad {
  const diag = Math.hypot(w, h);
  const R = Math.max(5, Math.round(diag * 0.012));
  const lines: Line[] = [];
  for (let s = 0; s < 4; s++) {
    const p = q[s], e = q[(s + 1) % 4];
    const len = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    const dx = (e.x - p.x) / len, dy = (e.y - p.y) / len, nx = -dy, ny = dx;
    const base = { a: nx, b: ny, c: nx * p.x + ny * p.y, votes: 0 };
    const onBorder = [p, e].every((c) => c.x <= 1 || c.y <= 1 || c.x >= w - 1 || c.y >= h - 1) &&
      (Math.abs(p.x - e.x) < 2 || Math.abs(p.y - e.y) < 2);
    if (onBorder) { lines.push(base); continue; }
    const M = Math.max(12, Math.min(90, Math.round(len / 6)));
    // which way does brightness step across this side?
    let pol = 0;
    for (let k = 0; k < M; k++) {
      const t = 0.1 + (0.8 * k) / (M - 1), cx = p.x + dx * len * t, cy = p.y + dy * len * t;
      pol += at(L, w, h, cx + nx * 3, cy + ny * 3) - at(L, w, h, cx - nx * 3, cy - ny * 3);
    }
    const sgn = pol >= 0 ? 1 : -1;
    const found: Pt[] = [], str: number[] = [];
    for (let k = 0; k < M; k++) {
      const t = 0.1 + (0.8 * k) / (M - 1), cx = p.x + dx * len * t, cy = p.y + dy * len * t;
      if (cx < 2 || cy < 2 || cx > w - 3 || cy > h - 3) continue;
      const prof: number[] = [];
      for (let d = -R; d <= R; d += 0.5) {
        const x = cx + nx * d, y = cy + ny * d;
        prof.push((at(L, w, h, x - dx * 1.5, y - dy * 1.5) + at(L, w, h, x, y) + at(L, w, h, x + dx * 1.5, y + dy * 1.5)) / 3);
      }
      let bi = -1, bv = 0;
      for (let i = 1; i < prof.length - 1; i++) {
        const d = -R + i * 0.5;
        const g = (prof[i + 1] - prof[i - 1]) * sgn;
        const wgt = Math.exp(-(d * d) / (2 * (R * 0.7) ** 2));
        if (g * wgt > bv) { bv = g * wgt; bi = i; }
      }
      if (bi < 2 || bi > prof.length - 3 || bv < 1.5) continue;
      // sub-pixel peak of the derivative
      const g0 = (prof[bi] - prof[bi - 2]) * sgn, g1 = (prof[bi + 1] - prof[bi - 1]) * sgn, g2 = (prof[bi + 2] - prof[bi]) * sgn;
      const den = g0 - 2 * g1 + g2;
      const off = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (g0 - g2)) / den)) : 0;
      const d = -R + (bi + off) * 0.5;
      found.push({ x: cx + nx * d, y: cy + ny * d });
      str.push(bv);
    }
    if (found.length < Math.max(6, M * 0.35)) { lines.push(base); continue; }
    // robust fit (Tukey weights)
    let ln = fitLine(found);
    for (let it = 0; it < 4 && ln; it++) {
      const c = 2.5;
      const wts = found.map((f) => { const r = (ln!.a * f.x + ln!.b * f.y - ln!.c) / c; return Math.abs(r) >= 1 ? 0 : (1 - r * r) ** 2; });
      if (wts.filter((x) => x > 0).length < found.length * 0.3) { ln = null; break; }
      ln = fitLine(found, wts);
    }
    if (!ln) { lines.push(base); continue; }
    // keep the side's orientation and refuse wild jumps
    const moved = Math.abs(ln.a * (p.x + e.x) / 2 + ln.b * (p.y + e.y) / 2 - ln.c);
    const turned = Math.abs(ln.a * base.b - ln.b * base.a);
    lines.push(moved < R * 1.2 && turned < 0.08 ? ln : base);
  }
  const out: Pt[] = [];
  for (let s = 0; s < 4; s++) {
    const c = intersect(lines[(s + 3) % 4], lines[s]);
    if (!c || Math.hypot(c.x - q[s].x, c.y - q[s].y) > diag * 0.04) out.push(q[s]); else out.push(c);
  }
  if (!isConvex(out)) return q;
  const mx = w * 0.05, my = h * 0.05;
  return out.map((p) => ({ x: Math.max(-mx, Math.min(w + mx, p.x)), y: Math.max(-my, Math.min(h + my, p.y)) })) as Quad;
}
