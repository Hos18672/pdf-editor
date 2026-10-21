// Geometry for the document scanner: quads, homographies, real-world aspect ratio of a photographed sheet.

export interface Pt { x: number; y: number }
/** corners in image pixels: top-left, top-right, bottom-right, bottom-left */
export type Quad = [Pt, Pt, Pt, Pt];

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const fullQuad = (w: number, h: number): Quad => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
export const scaleQuad = (q: Quad, s: number): Quad => q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad;

export function quadArea(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
}

/** convex, no self-intersection, all turns the same way */
export function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

/** Orders 4 points as tl, tr, br, bl (clockwise on screen, starting top-left). */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const s = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // clockwise from left (screen y down)
  // start at the corner with the smallest x + y
  let k = 0;
  for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
  return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]] as Quad;
}

/** Interior angle at each corner, degrees. */
export function cornerAngles(q: Quad): number[] {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4], b = q[(i + 1) % 4];
    const v1x = a.x - p.x, v1y = a.y - p.y, v2x = b.x - p.x, v2y = b.y - p.y;
    const c = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
  });
}

/** 3×3 homography (row-major, h[8] = 1) mapping each src[i] to dst[i]. */
export function homography(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8×9 augmented matrix
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

export function applyH(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Line through two points as a·x + b·y = c with (a, b) unit length. */
export function lineOf(p: Pt, q: Pt) {
  const dx = q.x - p.x, dy = q.y - p.y, n = Math.hypot(dx, dy) || 1;
  const a = -dy / n, b = dx / n;
  return { a, b, c: a * p.x + b * p.y };
}
export function intersect(l1: { a: number; b: number; c: number }, l2: { a: number; b: number; c: number }): Pt | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det };
}

/**
 * Width / height of the real sheet, from its photographed corners (Zhang & He, "Whiteboard scanning
 * and image enhancement"): the perspective of the quad gives the camera's focal length, and with it
 * the true proportions. Falls back to a plausible phone focal length when the quad is nearly a
 * parallelogram (then the proportions barely depend on it).
 */
export function aspectOf(q: Quad, imgW: number, imgH: number): number {
  const u0 = imgW / 2, v0 = imgH / 2;
  // m1 tl, m2 tr, m3 bl, m4 br (homogeneous, relative to the principal point)
  const m = (p: Pt) => [p.x - u0, p.y - v0, 1];
  const m1 = m(q[0]), m2 = m(q[1]), m3 = m(q[3]), m4 = m(q[2]);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  const diag = Math.hypot(imgW, imgH);
  let f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  const fMin = 0.45 * diag, fMax = 2.2 * diag;
  if (!isFinite(f2) || f2 < fMin * fMin || f2 > fMax * fMax || Math.abs(n2[2] * n3[2]) < 1e-6) f2 = (0.75 * diag) ** 2;
  const num = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2];
  const den = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
  const r = Math.sqrt(num / den);
  if (isFinite(r) && r > 0.05 && r < 20) return r;
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return w / Math.max(1, h);
}

export interface Format { id: string; label: string; ratio: number; mm?: [number, number] }
// width / height of common sheets (portrait) and cards (landscape)
export const FORMATS: Record<string, Format> = {
  a4: { id: 'a4', label: 'A4', ratio: 210 / 297, mm: [210, 297] },
  letter: { id: 'letter', label: 'Letter', ratio: 215.9 / 279.4, mm: [215.9, 279.4] },
  legal: { id: 'legal', label: 'Legal', ratio: 215.9 / 355.6, mm: [215.9, 355.6] },
  a5: { id: 'a5', label: 'A5', ratio: 148 / 210, mm: [148, 210] },
  id1: { id: 'id1', label: 'ID card', ratio: 85.6 / 53.98, mm: [85.6, 53.98] },
  id3: { id: 'id3', label: 'Passport page', ratio: 125 / 88, mm: [125, 88] },
};

/**
 * Snaps a measured ratio to a known format (either orientation) when it is close enough;
 * returns the format and the ratio to use.
 */
export function snapRatio(r: number, ids: string[], tol = 0.04): { ratio: number; format: Format | null; rotated: boolean } {
  let best: { ratio: number; format: Format | null; rotated: boolean; err: number } = { ratio: r, format: null, rotated: false, err: tol };
  for (const id of ids) {
    const f = FORMATS[id];
    for (const rot of [false, true]) {
      const t = rot ? 1 / f.ratio : f.ratio;
      const err = Math.abs(Math.log(r / t));
      if (err < best.err) best = { ratio: t, format: f, rotated: rot, err };
    }
  }
  return { ratio: best.ratio, format: best.format, rotated: best.rotated };
}
