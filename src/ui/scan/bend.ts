// Curved pages: a curled sheet or a book page has sides that bow between the corners. traceBend follows
// each side's real edge and returns how far it bows; the warp then maps the page through a Coons patch
// (the four curved sides blended across the page), so it comes out flat.
import { applyH, homography, isConvex, type Pt, type Quad } from './geom';

/** samples per side */
export const BEND_N = 25;
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

/** weighted least squares polynomial (degree d) in t */
function polyFit(t: number[], y: number[], wt: number[], d: number): number[] | null {
  const n = d + 1, A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < t.length; k++) {
    if (!(wt[k] > 0)) continue;
    const p: number[] = [1];
    for (let j = 1; j < n; j++) p.push(p[j - 1] * t[k]);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i][j] += wt[k] * p[i] * p[j]; A[i][n] += wt[k] * p[i] * y[k]; }
  }
  for (let c = 0; c < n; c++) {
    let pv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
    [A[c], A[pv]] = [A[pv], A[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  return A.map((row, i) => row[n] / A[i][i]);
}
const polyAt = (c: number[], t: number) => c.reduceRight((s, v) => s * t + v, 0);

/**
 * Follows the four sides of a found page (quad in the grey image's pixels) along their real edges.
 * Returns the corners where the curved sides meet and the bend relative to them, or null when every
 * side is straight (or no edge could be followed with confidence).
 */
export function traceBend(L: Float32Array, w: number, h: number, q: Quad): { quad: Quad; bend: Bend } | null {
  const H = homography(UNIT, q);
  const M = 41;
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
      let mx = 0;
      for (let i = 0; i < S; i++) { const g = (prof[i + 2] - prof[i]) * sgn; const v = g > 0 ? g : 0; E[k * S + i] = v; if (v > mx) mx = v; }
      peaks.push(mx);
    }
    if (peaks.length < M * 0.6) { curves.push(null); continue; }
    peaks.sort((x, y) => x - y);
    const gref = Math.max(6, peaks[(peaks.length * 0.7) | 0]);
    // best smooth path through the samples (dynamic programming)
    const spacing = (len * 0.94) / (M - 1);
    const maxStep = Math.max(2, Math.ceil(spacing * 0.22));
    const cost = new Float32Array(M * S), from = new Int16Array(M * S);
    for (let k = 0; k < M; k++) {
      for (let i = 0; i < S; i++) {
        const d = i - R;
        const local = miss[k] ? 0 : -Math.min(1, E[k * S + i] / gref) + 0.12 * (d / R) * (d / R);
        if (k === 0) { cost[i] = local; continue; }
        let best = Infinity, bj = i;
        for (let j = Math.max(0, i - maxStep); j <= Math.min(S - 1, i + maxStep); j++) {
          const dd = (i - j) / maxStep, c = cost[(k - 1) * S + j] + 0.35 * dd * dd;
          if (c < best) { best = c; bj = j; }
        }
        cost[k * S + i] = best + local; from[k * S + i] = bj;
      }
    }
    let bi = 0;
    for (let i = 1; i < S; i++) if (cost[(M - 1) * S + i] < cost[(M - 1) * S + bi]) bi = i;
    const path = new Array<number>(M), str = new Array<number>(M);
    for (let k = M - 1; k >= 0; k--) { path[k] = bi - R; str[k] = miss[k] ? 0 : Math.min(1, E[k * S + bi] / gref); if (k) bi = from[k * S + bi]; }
    const seen = M - miss.reduce((s2, v) => s2 + v, 0);
    const good = str.filter((v) => v > 0.35).length;
    if (good < seen * 0.75) { curves.push(null); continue; }
    // smooth curve: robust cubic fit
    let wt = str.map((v) => (v > 0.35 ? v : 0));
    let c = polyFit(ts, path, wt, 3);
    for (let it = 0; it < 3 && c; it++) {
      wt = ts.map((t, k) => { if (str[k] <= 0.35) return 0; const r = (path[k] - polyAt(c!, t)) / 3; return Math.abs(r) >= 1 ? 0 : str[k] * (1 - r * r) ** 2; });
      c = polyFit(ts, path, wt, 3);
    }
    if (!c) { curves.push(null); continue; }
    let se = 0, sw = 0;
    for (let k = 0; k < M; k++) if (wt[k] > 0) { const r = path[k] - polyAt(c, ts[k]); se += wt[k] * r * r; sw += wt[k]; }
    if (!sw || Math.sqrt(se / sw) > 2.2 || wt.filter((v) => v > 0).length < seen * 0.6) { curves.push(null); continue; }
    // how much it bows away from the chord between its ends
    const o0 = polyAt(c, 0), o1 = polyAt(c, 1);
    let sag = 0;
    for (let k = 0; k <= 20; k++) { const t = k / 20; sag = Math.max(sag, Math.abs(polyAt(c, t) - (o0 + (o1 - o0) * t))); }
    if (sag < Math.max(1.8, len * 0.004) || sag > R * 0.9 || Math.abs(o0) > R * 1.15 || Math.abs(o1) > R * 1.15) { curves.push(null); continue; }
    curves.push(c);
  }
  if (curves.every((c) => !c)) return null;
  // corners where the curved sides meet
  const off = (s: number, t: number) => { const c = curves[s]; return c ? polyAt(c, t) : 0; };
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
