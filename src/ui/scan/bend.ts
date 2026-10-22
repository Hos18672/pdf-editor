// Curved pages: a curled sheet or a book page has sides that bow between the corners. traceBend follows
// each side's real edge and returns how far it bows; the warp then maps the page through a Coons patch
// (the four curved sides blended across the page), so it comes out flat.
import { applyH, homography, isConvex, type Pt, type Quad } from './geom';

/** samples per side */
export const BEND_N = 49;
/**
 * Displacement of each side from the straight line between its corners, in image pixels: four arrays
 * (sides c0→c1, c1→c2, c2→c3, c3→c0) of BEND_N points (x0, y0, x1, y1 …), zero at both ends.
 */
export type Bend = number[][];

const UNIT: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
/** (u, v) on the unit square of side s at parameter t, in the side's direction */
const sideUV = (s: number, t: number): [number, number] => (s === 0 ? [t, 0] : s === 1 ? [1, t] : s === 2 ? [1 - t, 1] : [0, 1 - t]);

function at(L: Float32Array, w: number, h: number, x: number, y: number): number {
  if (x < 0) x = 0; if (y < 0) y = 0; if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (L[i] * (1 - fx) + L[i + 1] * fx) * (1 - fy) + (L[i + w] * (1 - fx) + L[i + w + 1] * fx) * fy;
}

/** locally weighted straight-line fit at `t0` (Gaussian window `sg` in t): follows local bulges, no end bias */
function localFit(t: number[], y: number[], wt: number[], sg: number, t0: number): number | null {
  let s0 = 0, s1 = 0, s2 = 0, b0 = 0, b1 = 0;
  for (let k = 0; k < t.length; k++) {
    if (!(wt[k] > 0)) continue;
    const d = (t[k] - t0) / sg;
    if (d > 3 || d < -3) continue;
    const g = wt[k] * Math.exp(-0.5 * d * d), x = t[k] - t0;
    s0 += g; s1 += g * x; s2 += g * x * x; b0 += g * y[k]; b1 += g * x * y[k];
  }
  if (s0 < 1e-6) return null;
  const det = s0 * s2 - s1 * s1;
  // too few points to see a slope: the local mean
  if (det < 1e-9 * s0 * s0) return b0 / s0;
  return (s2 * b0 - s1 * b1) / det;
}
/** a smooth curve as a table over t = 0…1 (linear between entries) */
const tableAt = (c: number[], t: number) => { const n = c.length - 1; let f = t * n; if (f < 0) f = 0; if (f > n) f = n; const i = Math.min(n - 1, f | 0); return c[i] + (c[i + 1] - c[i]) * (f - i); };

/**
 * Follows the four sides of a found page (quad in the grey image's pixels) along their real edges.
 * Returns the corners where the curved sides meet and the bend relative to them, or null when every
 * side is straight (or no edge could be followed with confidence).
 */
export function traceBend(L: Float32Array, w: number, h: number, q: Quad): { quad: Quad; bend: Bend } | null {
  const H = homography(UNIT, q);
  const curves: (number[] | null)[] = [];
  const normals: Pt[][] = [];
  const P = (s: number, t: number) => { const [u, v] = sideUV(s, t); return applyH(H, u, v); };
  for (let s = 0; s < 4; s++) {
    const a = q[s], e = q[(s + 1) % 4];
    const len = Math.hypot(e.x - a.x, e.y - a.y) || 1;
    // inward normal at a parameter (corners run clockwise on screen)
    const nAt = (t: number): Pt => {
      const p0 = P(s, Math.max(0, t - 0.01)), p1 = P(s, Math.min(1, t + 0.01));
      const dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.hypot(dx, dy) || 1;
      return { x: -dy / l, y: dx / l };
    };
    normals.push([nAt(0), nAt(1)]);
    const onBorder = [a, e].every((c) => c.x <= 2 || c.y <= 2 || c.x >= w - 2 || c.y >= h - 2) && (Math.abs(a.x - e.x) < 3 || Math.abs(a.y - e.y) < 3);
    if (onBorder || len < 60) { curves.push(null); continue; }
    // a sample every ~10 px, so local bulges of a crumpled sheet are seen
    const M = Math.max(41, Math.min(161, Math.round(len / 10)));
    const R = Math.round(Math.max(6, Math.min(160, len * 0.1)));
    const S = 2 * R + 1;
    const ts: number[] = [], pts: Pt[] = [], ns: Pt[] = [];
    for (let k = 0; k < M; k++) { const t = 0.03 + (0.94 * k) / (M - 1); ts.push(t); pts.push(P(s, t)); ns.push(nAt(t)); }
    // which way the brightness steps across the side (paper vs. background)
    let pol = 0;
    for (let k = 0; k < M; k++) pol += at(L, w, h, pts[k].x + ns[k].x * 3, pts[k].y + ns[k].y * 3) - at(L, w, h, pts[k].x - ns[k].x * 3, pts[k].y - ns[k].y * 3);
    const sgn = pol >= 0 ? 1 : -1;
    // edge strength along the normal at each sample
    const E = new Float32Array(M * S);
    const miss = new Uint8Array(M);
    const peaks: number[] = [];
    const PR = new Float32Array(M * (S + 2));
    for (let k = 0; k < M; k++) {
      const p = pts[k], n = ns[k], tx = n.y, ty = -n.x;
      const out = p.x - n.x * R < 1 || p.y - n.y * R < 1 || p.x - n.x * R > w - 2 || p.y - n.y * R > h - 2 ||
        p.x + n.x * R < 1 || p.y + n.y * R < 1 || p.x + n.x * R > w - 2 || p.y + n.y * R > h - 2;
      if (out) { miss[k] = 1; continue; }
      const prof = new Float32Array(S + 2);
      for (let i = 0; i < S + 2; i++) {
        const d = i - R - 1, x = p.x + n.x * d, y = p.y + n.y * d;
        prof[i] = (at(L, w, h, x - tx * 2, y - ty * 2) + at(L, w, h, x, y) + at(L, w, h, x + tx * 2, y + ty * 2)) / 3;
      }
      PR.set(prof, k * (S + 2));
      let mx = 0;
      for (let i = 0; i < S; i++) { const g = (prof[i + 2] - prof[i]) * sgn; const v = g > 0 ? g : 0; E[k * S + i] = v; if (v > mx) mx = v; }
      peaks.push(mx);
    }
    if (peaks.length < M * 0.6) { curves.push(null); continue; }
    peaks.sort((x, y) => x - y);
    const gref = Math.max(6, peaks[(peaks.length * 0.7) | 0]);
    // what the desk and the paper look like here (far out, far in): an edge with paper on its outer side
    // is a crease or a fold inside the sheet, not the sheet's side
    const far = (a: number, b: number) => {
      const v: number[] = [];
      for (let k = 0; k < M; k++) if (!miss[k]) { let m = 0; for (let i = a; i < b; i++) m += PR[k * (S + 2) + i]; v.push(m / (b - a)); }
      v.sort((x, y) => x - y); return v[v.length >> 1];
    };
    const desk = far(0, 4), paperV = far(S - 2, S + 2), gap = Math.abs(paperV - desk);
    const PL = new Float32Array(M * S);
    if (gap > 6) for (let k = 0; k < M; k++) {
      if (miss[k]) continue;
      const o = k * (S + 2);
      for (let i = 0; i < S; i++) {
        // just outside candidate i (a few px towards the desk)
        let m = 0, c = 0;
        for (let j = Math.max(0, i - 6); j < i - 1; j++) { m += PR[o + j]; c++; }
        if (!c) continue;
        m /= c;
        const t = (Math.abs(m - desk) - Math.abs(m - paperV)) / gap;
        PL[k * S + i] = t > 0 ? Math.min(1, t * 1.5) : 0;
      }
    }
    const score = (k: number, i: number) => (miss[k] ? 0 : Math.min(1, E[k * S + i] / gref) * (1 - 0.7 * PL[k * S + i]));
    // best smooth path through 41 of the samples (dynamic programming): which edge is the side
    const MC = 41, kc = Array.from({ length: MC }, (_, j) => Math.round((j * (M - 1)) / (MC - 1)));
    const spacing = (len * 0.94) / (MC - 1);
    const maxStep = Math.max(2, Math.ceil(spacing * 0.22));
    const cost = new Float32Array(MC * S), from = new Int16Array(MC * S);
    for (let j = 0; j < MC; j++) {
      const k = kc[j];
      for (let i = 0; i < S; i++) {
        const d = i - R;
        const local = -score(k, i) + 0.12 * (d / R) * (d / R);
        if (j === 0) { cost[i] = local; continue; }
        let best = Infinity, bj = i;
        for (let jj = Math.max(0, i - maxStep); jj <= Math.min(S - 1, i + maxStep); jj++) {
          const dd = (i - jj) / maxStep, c = cost[(j - 1) * S + jj] + 0.35 * dd * dd;
          if (c < best) { best = c; bj = jj; }
        }
        cost[j * S + i] = best + local; from[j * S + i] = bj;
      }
    }
    let bi = 0;
    for (let i = 1; i < S; i++) if (cost[(MC - 1) * S + i] < cost[(MC - 1) * S + bi]) bi = i;
    const coarse = new Array<number>(MC);
    for (let j = MC - 1; j >= 0; j--) { coarse[j] = bi; if (j) bi = from[j * S + bi]; }
    // then every sample, close to that path: the side's own small waves
    const B = maxStep, BW = 2 * B + 1;
    const ctr = new Int32Array(M);
    for (let k = 0; k < M; k++) {
      const f = (k * (MC - 1)) / (M - 1), j0 = Math.min(MC - 2, f | 0), u = f - j0;
      ctr[k] = Math.round(coarse[j0] * (1 - u) + coarse[j0 + 1] * u);
    }
    const fc = new Float32Array(M * BW), ff = new Int8Array(M * BW);
    for (let k = 0; k < M; k++) for (let o = 0; o < BW; o++) {
      const i = ctr[k] + o - B;
      const local = i < 0 || i >= S ? 1 : -score(k, i) + 0.15 * ((o - B) / B) ** 2;
      if (!k) { fc[o] = local; continue; }
      let best = Infinity, bo = o;
      for (let oo = Math.max(0, o - 3); oo <= Math.min(BW - 1, o + 3); oo++) {
        // a step against the previous sample, measured in the image (the centre line moves too)
        const step = ctr[k] + o - (ctr[k - 1] + oo);
        const c = fc[(k - 1) * BW + oo] + 0.35 * (step / 2) * (step / 2);
        if (c < best) { best = c; bo = oo; }
      }
      fc[k * BW + o] = best + local; ff[k * BW + o] = bo;
    }
    let bo = 0;
    for (let o = 1; o < BW; o++) if (fc[(M - 1) * BW + o] < fc[(M - 1) * BW + bo]) bo = o;
    const path = new Array<number>(M), str = new Array<number>(M);
    for (let k = M - 1; k >= 0; k--) {
      const i = Math.max(0, Math.min(S - 1, ctr[k] + bo - B));
      path[k] = i - R; str[k] = miss[k] ? 0 : Math.min(1, E[k * S + i] / gref);
      if (k) bo = ff[k * BW + bo];
    }
    const seen = M - miss.reduce((s2, v) => s2 + v, 0);
    const good = str.filter((v) => v > 0.35).length;
    if (good < seen * 0.75) { curves.push(null); continue; }
    // smooth curve that follows the edge's own bulges (a crumpled sheet's sides wave, not just bow):
    // a local straight-line fit over a window of about 2.5 % of the side, robust to stray samples
    const sg = Math.max(15, len * 0.025) / len;
    let wt = str.map((v) => (v > 0.35 ? v : 0));
    let fit = ts.map((t) => localFit(ts, path, wt, sg, t));
    for (let it = 0; it < 3; it++) {
      wt = ts.map((t, k) => { const f = fit[k]; if (str[k] <= 0.35 || f === null) return 0; const r = (path[k] - f) / 3; return Math.abs(r) >= 1 ? 0 : str[k] * (1 - r * r) ** 2; });
      fit = ts.map((t) => localFit(ts, path, wt, sg, t));
    }
    const TN = 101, c: number[] = [];
    let okc = true;
    // a stiffer curve over a window four times as wide: the side may wave around it only a little (a
    // deep notch is a corner folded over itself, which no straightening can undo)
    const dmax = Math.max(3, len * 0.008);
    for (let j = 0; j < TN; j++) {
      const t = j / (TN - 1), v = localFit(ts, path, wt, sg, t), v2 = localFit(ts, path, wt, sg * 4, t);
      if (v === null || v2 === null) { okc = false; break; }
      c.push(v2 + Math.max(-dmax, Math.min(dmax, v - v2)));
    }
    if (!okc) { curves.push(null); continue; }
    // smooth over the clamped spots
    for (let it = 0; it < 2; it++) { const c2 = c.slice(); for (let j = 1; j < TN - 1; j++) c[j] = 0.25 * c2[j - 1] + 0.5 * c2[j] + 0.25 * c2[j + 1]; }
    let se = 0, sw = 0;
    for (let k = 0; k < M; k++) if (wt[k] > 0) { const r = path[k] - tableAt(c, ts[k]); se += wt[k] * r * r; sw += wt[k]; }
    if (!sw || Math.sqrt(se / sw) > 2.2 || wt.filter((v) => v > 0).length < seen * 0.6) { curves.push(null); continue; }
    // how much it bows away from the chord between its ends
    const o0 = c[0], o1 = c[TN - 1];
    let sag = 0;
    for (let j = 0; j < TN; j++) { const t = j / (TN - 1); sag = Math.max(sag, Math.abs(c[j] - (o0 + (o1 - o0) * t))); }
    if (sag < Math.max(1.8, len * 0.004) || sag > R * 0.9 || Math.abs(o0) > R * 1.15 || Math.abs(o1) > R * 1.15) { curves.push(null); continue; }
    curves.push(c);
  }
  if (curves.every((c) => !c)) return null;
  // corners where the curved sides meet
  const off = (s: number, t: number) => { const c = curves[s]; return c ? tableAt(c, t) : 0; };
  const nq = q.map((p, s) => {
    const prev = (s + 3) % 4, n0 = normals[s][0], n1 = normals[prev][1];
    return { x: p.x + n0.x * off(s, 0) + n1.x * off(prev, 1), y: p.y + n0.y * off(s, 0) + n1.y * off(prev, 1) };
  }) as Quad;
  if (!isConvex(nq)) return null;
  const H2 = homography(UNIT, nq);
  const bend: Bend = [];
  for (let s = 0; s < 4; s++) {
    const arr: number[] = [];
    if (!curves[s]) { for (let j = 0; j < BEND_N; j++) arr.push(0, 0); bend.push(arr); continue; }
    const raw: Pt[] = [];
    for (let j = 0; j < BEND_N; j++) {
      const t = j / (BEND_N - 1);
      const p0 = P(s, Math.max(0, t - 0.01)), p1 = P(s, Math.min(1, t + 0.01));
      const dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.hypot(dx, dy) || 1;
      const base = P(s, t), o = off(s, t);
      const cpt = { x: base.x - (dy / l) * o, y: base.y + (dx / l) * o };
      const [u, v] = sideUV(s, t), b2 = applyH(H2, u, v);
      raw.push({ x: cpt.x - b2.x, y: cpt.y - b2.y });
    }
    // exactly zero at the corners
    const a0 = raw[0], a1 = raw[BEND_N - 1];
    for (let j = 0; j < BEND_N; j++) { const t = j / (BEND_N - 1); arr.push(raw[j].x - (a0.x + (a1.x - a0.x) * t), raw[j].y - (a0.y + (a1.y - a0.y) * t)); }
    bend.push(arr);
  }
  return { quad: nq, bend };
}

export const scaleBend = (b: Bend, sx: number, sy = sx): Bend => b.map((a) => a.map((v, i) => v * (i % 2 ? sy : sx)));
/** the bend after `rot` clockwise quarter turns of the output (matches turnQuad) */
export const turnBend = (b: Bend, rot: number): Bend => { const r = ((rot % 4) + 4) % 4; return [0, 1, 2, 3].map((i) => b[(i - r + 4) % 4]); };
/** largest displacement (to widen the crop region) */
export const bendReach = (b: Bend | null | undefined) => (b ? Math.max(0, ...b.flatMap((a) => a.map(Math.abs))) : 0);
