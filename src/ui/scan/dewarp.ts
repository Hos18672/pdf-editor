// Curved pages, with AI: the UVDoc model (Verhoeven, Magne, Sorkine-Hornung, SIGGRAPH Asia 2023;
// MIT licence, weights from github.com/tanguymagne/UVDoc, stored here as 16-bit floats) looks at the
// page as the classical steps straightened it and says, on a 31 × 45 lattice, where every part of the
// flat page really lies — bulges, a curl towards the spine, the squeeze where paper turns away.
//
// It never draws anything: it only moves the existing pixels (one resampling, like the classical warp),
// so no text can be invented. And it is used only when it helps:
//   · only on sheets that look bent (curved sides, or printed lines that wander);
//   · its map must be smooth, keep the page's order (no folds) and keep the page's edges;
//   · the printed lines must come out straighter than without it.
// Otherwise the classical result stays. The model runs in its own worker (aiWorker.ts) with
// onnxruntime-web (WebAssembly, on the device; nothing is sent anywhere).
import type { Bentness, Grid, Job, Kernels, PixelImage } from './kernels';

export const MODEL_W = 488, MODEL_H = 712, GRID_W = 31, GRID_H = 45;
/** margin around the page in the model's picture (it was trained on pages with some background) */
export const PAD = 0.04;

type Geo = Omit<Job, 'filter' | 'radius'>;
export interface AiInfo {
  /** the model ran (the page looked bent) */
  ran: boolean;
  /** its result is used */
  used: boolean;
  why: string;
  /** printed lines' wander without / with it (line spacings) */
  before?: Bentness | null; after?: Bentness | null;
  ms?: number;
}

/** pixels → the model's input: RGB planes, 0…1 */
export function modelInput(img: PixelImage): Float32Array {
  const n = img.w * img.h, out = new Float32Array(3 * n), d = img.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) { out[p] = d[i] / 255; out[n + p] = d[i + 1] / 255; out[2 * n + p] = d[i + 2] / 255; }
  return out;
}

/** the model's lattice ([x plane, y plane], −1…1 over its padded picture) → page fractions per node */
export function gridFromModel(o: Float32Array, pad = PAD): Grid {
  const n = GRID_W * GRID_H, g = new Float32Array(2 * n), k = 1 + 2 * pad;
  for (let p = 0; p < n; p++) { g[2 * p] = ((o[p] + 1) / 2) * k - pad; g[2 * p + 1] = ((o[n + p] + 1) / 2) * k - pad; }
  return { gw: GRID_W, gh: GRID_H, g };
}

/** a usable map: page order kept (no folds), edges near the found outline, no wild stretching */
export function checkGrid(G: Grid, tol = 0.08): string | null {
  const { gw, gh, g } = G;
  const X = (i: number, j: number) => g[2 * (j * gw + i)], Y = (i: number, j: number) => g[2 * (j * gw + i) + 1];
  const cw = 1 / (gw - 1), ch = 1 / (gh - 1);
  let minA = Infinity, maxA = 0;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    // cell area (cross product of its sides), relative to an even lattice's
    const ax = X(i + 1, j) - X(i, j), ay = Y(i + 1, j) - Y(i, j), bx = X(i, j + 1) - X(i, j), by = Y(i, j + 1) - Y(i, j);
    const a = (ax * by - ay * bx) / (cw * ch);
    if (a < minA) minA = a; if (a > maxA) maxA = a;
  }
  if (!(minA > 0.25)) return 'folds or squeezes the page';
  if (maxA > 4) return 'stretches the page too much';
  const edge = (vals: number[], want: number) => vals.reduce((s, v) => s + v, 0) / vals.length - want;
  const L = edge(Array.from({ length: gh }, (_, j) => X(0, j)), 0), R = edge(Array.from({ length: gh }, (_, j) => X(gw - 1, j)), 1);
  const T = edge(Array.from({ length: gw }, (_, i) => Y(i, 0)), 0), B = edge(Array.from({ length: gw }, (_, i) => Y(i, gh - 1)), 1);
  if ([L, R, T, B].some((d) => Math.abs(d) > tol)) return 'disagrees with the page outline';
  return null;
}

/**
 * The model never takes in more than the page outline (found, or set by hand in the crop): where its
 * edges reach past the outline onto the desk, they are pulled back onto it, the correction fading out
 * over the outer tenth of the page. Edges inside the outline (the model seeing desk the outline let in)
 * are kept.
 */
export function pinGrid(G: Grid, fade = 0.1): Grid {
  const { gw, gh } = G, g = new Float32Array(G.g);
  const eL = new Float32Array(gh), eR = new Float32Array(gh), eT = new Float32Array(gw), eB = new Float32Array(gw);
  for (let j = 0; j < gh; j++) { eL[j] = Math.min(0, g[2 * (j * gw)]); eR[j] = Math.max(0, g[2 * (j * gw + gw - 1)] - 1); }
  for (let i = 0; i < gw; i++) { eT[i] = Math.min(0, g[2 * i + 1]); eB[i] = Math.max(0, g[2 * ((gh - 1) * gw + i) + 1] - 1); }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const s = i / (gw - 1), t = j / (gh - 1), p = 2 * (j * gw + i);
    g[p] -= Math.exp(-s / fade) * eL[j] + Math.exp(-(1 - s) / fade) * eR[j];
    g[p + 1] -= Math.exp(-t / fade) * eT[i] + Math.exp(-(1 - t) / fade) * eB[i];
  }
  return { gw, gh, g };
}

/** the lattice of a page turned `rot` quarter turns clockwise (lattices are kept for the unturned page) */
export function turnGrid(G: Grid, rot: number): Grid {
  let cur = G;
  for (let r = ((rot % 4) + 4) % 4; r > 0; r--) {
    // one turn clockwise: the turned picture's (x, y) shows the old (y, 1 − x); fractions turn alike
    const { gw, gh, g } = cur, nw = gh, nh = gw, out = new Float32Array(g.length);
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const oi = j, oj = gh - 1 - i, s = 2 * (oj * gw + oi), d = 2 * (j * nw + i);
      // old page point (u, v) → turned page (1 − v, u)
      out[d] = 1 - g[s + 1]; out[d + 1] = g[s];
    }
    cur = { gw: nw, gh: nh, g: out };
  }
  return cur;
}

/** Does this page look bent enough to try the model? (curved sides, or printed lines that wander) */
export function looksBent(K: Kernels, job: Geo): { bent: boolean; before: Bentness | null; probe: PixelImage } {
  const k = Math.min(1, 900 / Math.max(job.outW, job.outH));
  const probe = K.warpTo(job, Math.max(32, Math.round(job.outW * k)), Math.max(32, Math.round(job.outH * k)), 0);
  const before = K.bentness(probe);
  const q = job.quad, side = Math.max(Math.hypot(q[2] - q[0], q[3] - q[1]), Math.hypot(q[6] - q[0], q[7] - q[1]), 1);
  const reach = job.bend ? Math.max(0, ...job.bend.flatMap((a) => a.map(Math.abs))) / side : 0;
  return { bent: reach > 0.004 || (before ? before.rms > 0.06 : false), before, probe };
}

/**
 * The whole AI step for one page (in the AI worker, or in tests): decides whether to try, runs the
 * model on the classically straightened page, checks its map and keeps it only if it helps.
 */
export async function aiFlatten(K: Kernels, job: Geo, run: (input: Float32Array) => Promise<Float32Array>, force: boolean | 'use' = false): Promise<{ grid: Grid | null; info: AiInfo }> {
  const t0 = Date.now();
  const { bent, before, probe } = looksBent(K, job);
  if (!bent && !force) return { grid: null, info: { ran: false, used: false, why: 'flat page', before } };
  const pic = K.warpTo(job, MODEL_W, MODEL_H, PAD);
  const out = await run(modelInput(pic));
  let grid = gridFromModel(out);
  const bad = checkGrid(grid);
  const ms = Date.now() - t0;
  if (bad) return { grid: null, info: { ran: true, used: false, why: `model's map ${bad}`, before, ms } };
  grid = pinGrid(grid);
  const after = K.bentness(K.warpTo(job, probe.w, probe.h, 0, grid));
  // lines straighter (or, without enough lines to measure, at least a visibly curved sheet)
  let used: boolean, why: string;
  if (before && after) { used = after.rms < before.rms * 0.85; why = used ? 'lines straighter' : 'lines not straighter'; }
  else if (!before && !after) { used = !!job.bend; why = used ? 'curved sides, too little text to measure' : 'too little text to measure'; }
  else { used = !!after; why = used ? 'lines found only after flattening' : 'lines lost after flattening'; }
  if (force === 'use') used = true;
  return { grid: used ? grid : null, info: { ran: true, used, why, before, after, ms } };
}
