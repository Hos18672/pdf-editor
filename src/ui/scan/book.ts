// Book scans: an open book photographed as one spread is cut at the gutter into its two pages. The
// spread's curved top and bottom edges are shared out between the pages, so each page still comes out
// flat (the warp follows its own curved sides).
import { BEND_N, type Bend } from './bend';
import { aspectOf, type Pt, type Quad } from './geom';

/** point on side s (c_s → c_s+1) of a quad with curved sides, at parameter u (0…1) */
function sidePt(q: Quad, bend: Bend | null, s: number, u: number): Pt {
  const a = q[s], b = q[(s + 1) % 4];
  let x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
  const arr = bend?.[s];
  if (arr) {
    const f = Math.max(0, Math.min(1, u)) * (BEND_N - 1);
    const k = Math.min(BEND_N - 2, Math.floor(f)), t = f - k;
    x += arr[2 * k] * (1 - t) + arr[2 * k + 2] * t;
    y += arr[2 * k + 1] * (1 - t) + arr[2 * k + 3] * t;
  }
  return { x, y };
}

/** the stretch u0…u1 of side s, as the bow of a new side between its ends */
function subSide(q: Quad, bend: Bend, s: number, u0: number, u1: number): number[] {
  const A = sidePt(q, bend, s, u0), B = sidePt(q, bend, s, u1);
  const out: number[] = [];
  for (let k = 0; k < BEND_N; k++) {
    const v = k / (BEND_N - 1), P = sidePt(q, bend, s, u0 + (u1 - u0) * v);
    out.push(P.x - (A.x + (B.x - A.x) * v), P.y - (A.y + (B.y - A.y) * v));
  }
  return out;
}
const straight = () => new Array(BEND_N * 2).fill(0);

/**
 * Where the gutter runs (0…1 across the spread, from its left side): the darkest narrow band near the
 * middle that has brighter paper on both sides (the shadow in the fold). The middle when there is none.
 */
export function findGutter(q: Quad, bend: Bend | null, L: Float32Array | Uint8ClampedArray, w: number, h: number, scale: number): number {
  const lum = (x: number, y: number) => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x * scale))), yi = Math.max(0, Math.min(h - 1, Math.round(y * scale)));
    return L[yi * w + xi];
  };
  const T0 = 0.36, T1 = 0.64, STEP = 0.004;
  const ts: number[] = [], prof: number[] = [];
  for (let t = T0; t <= T1 + 1e-9; t += STEP) {
    const A = sidePt(q, bend, 0, t), B = sidePt(q, bend, 2, 1 - t);
    let s = 0, n = 0;
    for (let k = 0; k <= 60; k++) {
      const v = 0.08 + 0.84 * (k / 60);
      s += lum(A.x + (B.x - A.x) * v, A.y + (B.y - A.y) * v); n++;
    }
    ts.push(t); prof.push(s / n);
  }
  // a little smoothing
  const sm = prof.map((_, i) => { let s = 0, n = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < prof.length) { s += prof[j]; n++; } return s / n; });
  const gap = Math.round(0.035 / STEP);
  let best = 0.5, bestDip = 6;
  for (let i = gap; i < sm.length - gap; i++) {
    const t = ts[i];
    if (t < 0.42 || t > 0.58) continue;
    const dip = Math.min(sm[i - gap], sm[i + gap]) - sm[i] - Math.abs(t - 0.5) * 40;
    if (dip > bestDip) { bestDip = dip; best = t; }
  }
  return best;
}

export interface Half { quad: Quad; bend: Bend | null }

/** The spread as its left and right page, or null when it doesn't look like two pages side by side. */
export function splitSpread(q: Quad, bend: Bend | null, w: number, h: number, gutter = 0.5): [Half, Half] | null {
  if (aspectOf(q, w, h) < 1.05) return null;
  const t = gutter;
  const T = sidePt(q, bend, 0, t), B = sidePt(q, bend, 2, 1 - t);
  const left: Half = {
    quad: [q[0], T, B, q[3]],
    bend: bend ? [subSide(q, bend, 0, 0, t), straight(), subSide(q, bend, 2, 1 - t, 1), bend[3].slice()] : null,
  };
  const right: Half = {
    quad: [T, q[1], q[2], B],
    bend: bend ? [subSide(q, bend, 0, t, 1), bend[1].slice(), subSide(q, bend, 2, 0, 1 - t), straight()] : null,
  };
  return [left, right];
}
