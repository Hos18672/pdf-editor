// Which way is up? Text lines make the ink profile across them ripple strongly (that gives sideways
// vs upright), and in Latin script ascenders (b d f h k l t, capitals) outweigh descenders (g j p q y),
// so each line carries more ink above its x-height band than below (that gives upright vs upside down).

// Inside orientKernels() (no outside names) so it can run in the scanner's worker too.

export interface Gray { w: number; h: number; data: Uint8ClampedArray | Uint8Array }

export interface Orientation { turns: number; sure: boolean; ripple: [number, number]; asc: number | null }

export function orientKernels(): { textOrientation(img: Gray): Orientation | null } {
  /** horizontal (dx=1) or vertical run-length smear of the ink: letters of a line merge into a bar */
  function smear(ink: Uint8Array, w: number, h: number, r: number, horiz: boolean): Uint8Array {
    const o = new Uint8Array(w * h);
    if (horiz) {
      for (let y = 0; y < h; y++) {
        let last = -1e9;
        for (let x = 0; x < w; x++) {
          if (ink[y * w + x]) { if (x - last <= r) for (let k = Math.max(0, last); k < x; k++) o[y * w + k] = 1; o[y * w + x] = 1; last = x; }
        }
      }
    } else {
      for (let x = 0; x < w; x++) {
        let last = -1e9;
        for (let y = 0; y < h; y++) {
          if (ink[y * w + x]) { if (y - last <= r) for (let k = Math.max(0, last); k < y; k++) o[k * w + x] = 1; o[y * w + x] = 1; last = y; }
        }
      }
    }
    return o;
  }

  /**
   * Clockwise quarter turns that make the text upright. `sure` is false when the evidence is weak
   * (little text, handwriting, tables): then the caller keeps the page as it is.
   */
  function textOrientation(img: Gray): Orientation | null {
    const { w, h, data } = img;
    // ink mask on a page that is already cleaned (paper white)
    const ink = new Uint8Array(w * h);
    let total = 0;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 128) { ink[p] = 1; total++; }
    if (total < w * h * 0.004) return null;
    const r = Math.max(3, Math.round(Math.min(w, h) / 120));
    const hs = smear(ink, w, h, r, true), vs = smear(ink, w, h, r, false);
    const rows = new Float64Array(h), cols = new Float64Array(w), rowsI = new Float64Array(h), colsI = new Float64Array(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (hs[p]) rows[y]++;
      if (vs[p]) cols[x]++;
      if (ink[p]) { rowsI[y]++; colsI[x]++; }
    }
    const ripple = (p: Float64Array) => {
      let d = 0, s = 0;
      for (let i = 1; i < p.length; i++) { d += Math.abs(p[i] - p[i - 1]); s += p[i]; }
      return s ? (d / s) * Math.sqrt(p.length) : 0;
    };
    const rH = ripple(rows), rV = ripple(cols);
    const sideways = rV > rH * 1.3;
    const upright = rH > rV * 1.3;
    if (!sideways && !upright) return { turns: 0, sure: false, ripple: [rH, rV], asc: null };
    const a = ascRatio(sideways ? colsI : rowsI);
    if (upright) {
      // turning a page upside down is only done on clear evidence
      if (a !== null && a < 1 / 1.7) return { turns: 2, sure: true, ripple: [rH, rV], asc: a };
      return { turns: 0, sure: a !== null && a > 1.2, ripple: [rH, rV], asc: a };
    }
    // lines run top-to-bottom: ascenders at the right (high x) → the text's top faces right → turn left
    if (a === null || (a < 1.7 && a > 1 / 1.7)) return { turns: 0, sure: false, ripple: [rH, rV], asc: a };
    return { turns: a > 1 ? 1 : 3, sure: true, ripple: [rH, rV], asc: a };
  }


  /**
   * Ink above the x-height band ÷ ink below it, summed over the lines (> 1: tops at the low end of the
   * profile). Null with too few lines.
   */
  function ascRatio(p: Float64Array): number | null {
    const n = p.length;
    const sorted = [...p].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(n * 0.95)] || 1;
    const t = p95 * 0.12;
    let A = 0, D = 0, lines = 0;
    let i = 0;
    while (i < n) {
      if (p[i] <= t) { i++; continue; }
      let j = i;
      while (j < n && p[j] > t) j++;
      if (j - i >= 4) {
        let m = 0;
        for (let k = i; k < j; k++) m = Math.max(m, p[k]);
        let c0 = i, c1 = j - 1;
        while (c0 < j && p[c0] < m * 0.5) c0++;
        while (c1 > i && p[c1] < m * 0.5) c1--;
        let a = 0, d = 0;
        for (let k = i; k < c0; k++) a += p[k];
        for (let k = c1 + 1; k < j; k++) d += p[k];
        // only lines with a real x-height band count
        if (c1 - c0 >= 2 && a + d > 0) { A += a; D += d; lines++; }
      }
      i = j;
    }
    if (lines < 4) return null;
    return (A + 1) / (D + 1);
  }

  return { textOrientation };
}

export const textOrientation = orientKernels().textOrientation;
export const textTurns = (img: Gray): number | null => { const o = textOrientation(img); return o && o.sure ? o.turns : null; };
