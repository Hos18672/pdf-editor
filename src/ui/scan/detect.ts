// Finds the sheet / card in a photo: its four corners, precisely enough to crop without a border.
//
// 1. A small copy of the photo (~400 px) is cleaned of text (grey closing) and softened.
// 2. Edges come from brightness and colour (white paper on a light desk still differs in colour).
// 3. Straight lines are found with an orientation-guided Hough transform; every two roughly parallel
//    pairs form a candidate quad, scored by how much of its outline is really an edge, its size and
//    shape. The largest bright blob gives one more candidate for sheets without clean straight edges.
// 4. The winner is refined on a larger copy: along each side the exact edge position is measured at
//    many points (sub-pixel) and a robust line fit gives the final corners.
// Everything sits inside detectKernels() so the same code also runs in the scanner's worker
// (public/scan/worker.js) — the live camera finds the page there, off the main thread.
import type { Pt, Quad } from './geom';

export interface Rgba { w: number; h: number; data: Uint8ClampedArray | Uint8Array }
/** agree: how well the outline matches the sheet found as a region (0…1; 0 when no region was found) */
export interface Detection { quad: Quad; score: number; support: number[]; agree?: number }

export interface Detector {
  luminance(img: Rgba): Float32Array;
  blur(a: Float32Array, w: number, h: number, sigma: number): Float32Array;
  edgeMap(img: Rgba): any;
  houghLines(E: any, max: number): any[];
  detectQuad(img: Rgba, opts?: { maxLines?: number; live?: boolean; ratios?: number[] }): Detection | null;
  refineQuad(L: Float32Array, w: number, h: number, q: Quad): Quad;
}

export function detectKernels(): Detector {
    const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  function quadArea(q: Pt[]): number {
    let a = 0;
    for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p.x * n.y - n.x * p.y; }
    return Math.abs(a) / 2;
  }

  function isConvex(q: Pt[]): boolean {
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

  function orderQuad(pts: Pt[]): Quad {
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4, cy = pts.reduce((s, p) => s + p.y, 0) / 4;
    const s = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); // clockwise from left (screen y down)
    // start at the corner with the smallest x + y
    let k = 0;
    for (let i = 1; i < 4; i++) if (s[i].x + s[i].y < s[k].x + s[k].y) k = i;
    return [s[k], s[(k + 1) % 4], s[(k + 2) % 4], s[(k + 3) % 4]] as Quad;
  }

  function cornerAngles(q: Quad): number[] {
    return q.map((p, i) => {
      const a = q[(i + 3) % 4], b = q[(i + 1) % 4];
      const v1x = a.x - p.x, v1y = a.y - p.y, v2x = b.x - p.x, v2y = b.y - p.y;
      const c = (v1x * v2x + v1y * v2y) / (Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1);
      return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
    });
  }

  function intersect(l1: { a: number; b: number; c: number }, l2: { a: number; b: number; c: number }): Pt | null {
    const det = l1.a * l2.b - l2.a * l1.b;
    if (Math.abs(det) < 1e-9) return null;
    return { x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det };
  }

  function aspectOf(q: Quad, imgW: number, imgH: number): number {
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

  const DEG = Math.PI / 180;

  function luminance(img: Rgba): Float32Array {
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
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const lo = row + (x - r < 0 ? 0 : x - r), hi = row + (x + r >= w ? w - 1 : x + r);
        let v = a[lo];
        if (max) { for (let k = lo + 1; k <= hi; k++) if (a[k] > v) v = a[k]; }
        else { for (let k = lo + 1; k <= hi; k++) if (a[k] < v) v = a[k]; }
        t[row + x] = v;
      }
    }
    // vertical pass row by row (streams through memory instead of striding down columns)
    for (let y = 0; y < h; y++) {
      const y0 = y - r < 0 ? 0 : y - r, y1 = y + r >= h ? h - 1 : y + r, row = y * w;
      o.set(t.subarray(y0 * w, y0 * w + w), row);
      for (let yy = y0 + 1; yy <= y1; yy++) {
        const src = yy * w;
        if (max) { for (let x = 0; x < w; x++) { const u = t[src + x]; if (u > o[row + x]) o[row + x] = u; } }
        else { for (let x = 0; x < w; x++) { const u = t[src + x]; if (u < o[row + x]) o[row + x] = u; } }
      }
    }
    return o;
  }

  function blur(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
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
    // vertical pass row by row (streams through memory)
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i, src = yy * w, kk = k[i + r];
        for (let x = 0; x < w; x++) o[row + x] += t[src + x] * kk;
      }
    }
    return o;
  }

  interface EdgeMap { w: number; h: number; on: Uint8Array; ang: Float32Array; mag: Float32Array; L: Float32Array; S: Float32Array; list: Int32Array }

  function edgeMap(img: Rgba, fine = false): EdgeMap {
    const { w, h } = img, n = w * h;
    const r = Math.max(1, Math.round(Math.min(w, h) / 170));
    // closing removes dark text and thin lines on the sheet, keeps its outline in place
    // (fine: kept, for things outlined only by a thin dark line, like a white frame on a pale wall)
    let L = fine ? luminance(img) : morph(morph(luminance(img), w, h, r, true), w, h, r, false);
    L = blur(L, w, h, fine ? 0.8 : 1.1);
    const S = blur(chroma(img), w, h, 1.4);
    const mag = new Float32Array(n), ang = new Float32Array(n), gx = new Float32Array(n), gy = new Float32Array(n);
    const bins = new Uint32Array(256);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lx = (L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1]) * 0.125;
      const ly = (L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1]) * 0.125;
      const sx = (S[i - w + 1] + 2 * S[i + 1] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - 1] - S[i + w - 1]) * 0.1;
      const sy = (S[i + w - 1] + 2 * S[i + w] + S[i + w + 1] - S[i - w - 1] - 2 * S[i - w] - S[i - w + 1]) * 0.1;
      const ml = lx * lx + ly * ly, ms = sx * sx + sy * sy;
      let m: number;
      if (ml >= ms) { m = Math.sqrt(ml); gx[i] = lx; gy[i] = ly; } else { m = Math.sqrt(ms); gx[i] = sx; gy[i] = sy; }
      mag[i] = m;
      bins[m >= 63.75 ? 255 : (m * 4) | 0]++;
    }
    bins[0] += 2 * w + 2 * (h - 2); // the border pixels (0)
    // thresholds from the gradient distribution
    const pct = (q: number) => { let c = 0; for (let b = 0; b < 256; b++) { c += bins[b]; if (c >= q * n) return b / 4; } return 64; };
    // (fine: faint long lines count too: hysteresis keeps them only where they join a stronger stretch)
    const high = fine ? Math.max(2.2, Math.min(10, pct(0.8))) : Math.max(2.5, Math.min(16, pct(0.9))), low = high * 0.45;
    // directions only where an edge can be
    for (let i = 0; i < n; i++) if (mag[i] >= low) ang[i] = Math.atan2(gy[i], gx[i]);
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
    return { w, h, on, ang, mag, L, S, list };
  }

  interface Line { a: number; b: number; c: number; border?: boolean; votes: number }

  /** angle between two line normals, 0…90° */
  const angDiff = (l1: Line, l2: Line) => {
    const d = Math.abs(Math.atan2(l1.b, l1.a) - Math.atan2(l2.b, l2.a)) % Math.PI;
    return (Math.min(d, Math.PI - d) * 180) / Math.PI;
  };

  function houghLines(E: EdgeMap, max: number): Line[] {
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
    // low enough for the short end of a long receipt (a quarter of the frame width or less)
    const minVotes = Math.max(12, Math.min(w, h) * 0.06);
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

  /**
   * Edge support just past a corner, along the side's own direction. A real corner is where the sheet
   * ends; when the side's edge carries on (the long side of a receipt past a fold that crosses it), the
   * "corner" is only a crease. Returns 0 when the extension runs out of the picture.
   */
  function beyond(E: EdgeMap, from: Pt, c: Pt, frac: number): number {
    const { w, h } = E;
    const dx = c.x - from.x, dy = c.y - from.y, len = Math.hypot(dx, dy);
    const ext = Math.max(6, len * frac);
    // start a little past the corner: the crossing side's own edge sits right at it
    const gap = Math.max(3, Math.min(w, h) * 0.015);
    const a = { x: c.x + (dx / len) * gap, y: c.y + (dy / len) * gap }, b = { x: c.x + (dx / len) * (gap + ext), y: c.y + (dy / len) * (gap + ext) };
    const inPic = (p: Pt) => p.x >= 2 && p.y >= 2 && p.x <= w - 3 && p.y <= h - 3;
    if (!inPic(a)) return 0;
    let e = b;
    if (!inPic(b)) {
      // clip to the picture; too short a stretch says nothing
      let lo = 0, hi = 1;
      for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (inPic({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m })) lo = m; else hi = m; }
      e = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
      if (Math.hypot(e.x - a.x, e.y - a.y) < Math.max(8, ext * 0.4)) return 0;
    }
    return support(E, a, e);
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

  /**
   * How much a side's brightness step flips back and forth along it (0 = always the same way, as at a
   * sheet's edge; 0.5 = half each way, as along the lines of a checked cloth or a tiled floor).
   */
  function flips(E: EdgeMap, p: Pt, q: Pt): { flip: number; step: number } {
    const { w, h, L } = E;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
    const steps = Math.max(8, Math.floor(len / 2));
    let pos = 0, neg = 0, all = 0;
    for (let s = 0; s <= steps; s++) {
      const t = 0.06 + (0.88 * s) / steps;
      const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
      const xi = Math.round(x + nx * 3), yi = Math.round(y + ny * 3), xo = Math.round(x - nx * 3), yo = Math.round(y - ny * 3);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
      const d = L[yi * w + xi] - L[yo * w + xo];
      all++;
      if (d > 6) pos++; else if (d < -6) neg++;
    }
    return { flip: pos + neg >= 6 ? Math.min(pos, neg) / (pos + neg) : 0, step: all ? (pos + neg) / all : 1 };
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
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = L[i] > thr ? 1 : 0;
    const big = largest(m, w, h);
    if (!big || big.size < n * 0.06 || big.size > n * 0.97) return null;
    return maskQuad(big.mask, w, h);
  }

  /** mean over a (2r+1)² square, constant time per pixel (edges clamped) */
  function boxBlur(a: Float32Array, w: number, h: number, r: number): Float32Array {
    const t = new Float32Array(a.length), o = new Float32Array(a.length), k = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      for (let i = -r - 1; i < r; i++) s += a[row + (i < 0 ? 0 : i >= w ? w - 1 : i)];
      for (let x = 0; x < w; x++) {
        const add = x + r >= w ? w - 1 : x + r, sub = x - r - 1 < 0 ? 0 : x - r - 1;
        s += a[row + add] - a[row + sub];
        t[row + x] = s * k;
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r - 1; i < r; i++) s += t[(i < 0 ? 0 : i >= h ? h - 1 : i) * w + x];
      for (let y = 0; y < h; y++) {
        const add = y + r >= h ? h - 1 : y + r, sub = y - r - 1 < 0 ? 0 : y - r - 1;
        s += t[add * w + x] - t[sub * w + x];
        o[y * w + x] = s * k;
      }
    }
    return o;
  }

  /** the largest 4-connected region of a 0/1 mask */
  function largest(m: Uint8Array, w: number, h: number): { mask: Uint8Array; size: number } | null {
    const n = w * h, lab = new Int32Array(n).fill(-1);
    let bestId = -1, bestSize = 0, id = 0;
    const q: number[] = [];
    for (let s = 0; s < n; s++) {
      if (lab[s] !== -1 || !m[s]) continue;
      let size = 0;
      lab[s] = id; q.length = 0; q.push(s);
      while (q.length) {
        const j = q.pop()!; size++;
        const x = j % w;
        if (x > 0 && lab[j - 1] === -1 && m[j - 1]) { lab[j - 1] = id; q.push(j - 1); }
        if (x < w - 1 && lab[j + 1] === -1 && m[j + 1]) { lab[j + 1] = id; q.push(j + 1); }
        if (j >= w && lab[j - w] === -1 && m[j - w]) { lab[j - w] = id; q.push(j - w); }
        if (j < n - w && lab[j + w] === -1 && m[j + w]) { lab[j + w] = id; q.push(j + w); }
      }
      if (size > bestSize) { bestSize = size; bestId = id; }
      id++;
    }
    if (bestId < 0) return null;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (lab[i] === bestId) out[i] = 1;
    return { mask: out, size: bestSize };
  }

  /** a region → its convex hull → the largest quad on it, sides straightened by line fits */
  function maskQuad(mask: Uint8Array, w: number, h: number): Quad | null {
    // extreme points per row → convex hull
    const pts: Pt[] = [];
    for (let y = 0; y < h; y++) {
      let l = -1, r = -1;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (l < 0) l = x; r = x; }
      if (l >= 0) { pts.push({ x: l, y }); if (r !== l) pts.push({ x: r + 1, y }); }
    }
    // top and bottom rows of each column too (flat top and bottom ends)
    for (let x = 0; x < w; x++) {
      let t = -1, b = -1;
      for (let y = 0; y < h; y++) if (mask[y * w + x]) { if (t < 0) t = y; b = y; }
      if (t >= 0) { pts.push({ x, y: t }); if (b !== t) pts.push({ x, y: b + 1 }); }
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
    // straighten each side with a line fit to the boundary near it; a side may only move outwards
    // (the hull already holds every point of the region)
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
    const ok = isConvex(corners) && corners.every((c, i) => Math.hypot(c.x - bq![i].x, c.y - bq![i].y) < Math.min(w, h) * 0.08);
    return ok ? orderQuad(corners) : orderQuad(bq);
  }

  /**
   * The sheet as a region: seeds on the printed parts (small dark marks on bright ground: text, a
   * barcode) and on the picture's border, then a watershed flood over the edge strength. The two
   * floods meet on the strongest edge between them — the paper's outline even when the desk is
   * nearly as white as the paper, and never a fold or a printed line inside the sheet, which lies
   * between seeds of the sheet itself. Returns the region and how clearly its outline is an edge.
   */
  /**
   * The sheet as the largest bright, colourless patch (no text needed: blurred frames, blank paper, a
   * patterned desk around it). Only trusted when the patch is compact and its outline is a real edge.
   */
  function paperBlob(img: Rgba, E: EdgeMap): { mask: Uint8Array; size: number; conf: number } | null {
    const { w, h, L, S } = E, n = w * h;
    const P = new Float32Array(n);
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) { const v = L[i] - 1.3 * S[i]; P[i] = v; hist[Math.max(0, Math.min(255, v | 0))]++; }
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = n - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    // the two sides must really differ (not one flat surface split in two)
    let a = 0, an = 0, b = 0, bn = 0;
    for (let i = 0; i < n; i++) if (P[i] > thr) { a += P[i]; an++; } else { b += P[i]; bn++; }
    if (!an || !bn || a / an - b / bn < 35) return null;
    const m0 = new Float32Array(n);
    for (let i = 0; i < n; i++) m0[i] = P[i] > thr ? 1 : 0;
    // opening: thin bridges to bright bits of the desk break off
    const r = Math.max(1, Math.round(Math.min(w, h) / 120));
    const op = morph(morph(m0, w, h, r, false), w, h, r, true);
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = op[i] > 0.5 ? 1 : 0;
    const big = largest(m, w, h);
    if (!big || big.size < n * 0.03 || big.size > n * 0.95) return null;
    const q = maskQuad(big.mask, w, h);
    if (!q) return null;
    const solid = big.size / Math.max(1, quadArea(q));
    if (solid < 0.86 || solid > 1.12) return null;
    let sup = 0, inPic = 0;
    for (let s = 0; s < 4; s++) {
      const p0 = q[s], p1 = q[(s + 1) % 4];
      // sides along the picture's border say nothing
      const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
      if (mx < 3 || my < 3 || mx > w - 4 || my > h - 4) continue;
      sup += support(E, p0, p1); inPic++;
    }
    if (inPic < 2) return null;
    const conf = Math.min(1, (sup / inPic) * (solid > 1 ? 2 - solid : solid) * 1.15);
    return { mask: big.mask, size: big.size, conf };
  }

  /**
   * The sheet by its colour against a tinted desk (cream, beige, wood): white paper is grey in every
   * shade, from its brightest part into the shadow of a crease, while the desk keeps its tint however
   * the light falls. So the hue alone separates them, where brightness can't (a crumpled receipt on a
   * cream desk is in places darker than the desk).
   */
  function tintBlob(img: Rgba, E: EdgeMap): { mask: Uint8Array; size: number; conf: number } | null {
    const { w, h, L } = E, n = w * h, d = img.data;
    // warmth of each pixel relative to its brightness ((r+g)/2 - b over the mean), smoothed
    const T0 = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], m = (r + g + b) / 3;
      T0[p] = m > 12 ? ((r + g) / 2 - b) / m : 0;
    }
    const T = boxBlur(T0, w, h, Math.max(1, Math.round(Math.min(w, h) / 200)));
    // the desk's tint: the picture's outer ring
    const ring: number[] = [];
    const bw = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (x < bw || y < bw || x >= w - bw || y >= h - bw) ring.push(T[y * w + x]);
    ring.sort((a, b) => a - b);
    const desk = ring[(ring.length * 0.5) | 0];
    if (desk < 0.06) return null; // a grey or white desk: no tint to go by
    // bright level (dark objects — a keyboard, a phone — are grey too)
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, L[i] | 0))]++;
    let c = 0, p95 = 255;
    for (let v = 255; v >= 0; v--) { c += hist[v]; if (c >= n * 0.05) { p95 = v; break; } }
    const cut = desk * 0.45;
    const m0 = new Float32Array(n);
    for (let i = 0; i < n; i++) m0[i] = T[i] < cut && T[i] > -desk && L[i] > p95 * 0.4 ? 1 : 0;
    // closing then opening: print and crease lines inside fill in, thin bridges to grey things break off
    const r = Math.max(1, Math.round(Math.min(w, h) / 120));
    const cl = morph(morph(m0, w, h, r, true), w, h, r, false);
    const op = morph(morph(cl, w, h, r, false), w, h, r, true);
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = op[i] > 0.5 ? 1 : 0;
    const big = largest(m, w, h);
    if (!big || big.size < n * 0.03 || big.size > n * 0.9) return null;
    const q = maskQuad(big.mask, w, h);
    if (!q) return null;
    const solid = big.size / Math.max(1, quadArea(q));
    if (solid < 0.85 || solid > 1.1) return null;
    // how clearly the tint changes across the outline
    let inT = 0, outT = 0, k = 0;
    for (let s = 0; s < 4; s++) {
      const p0 = q[s], p1 = q[(s + 1) % 4], len = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
      const nx = -(p1.y - p0.y) / len, ny = (p1.x - p0.x) / len, dd = Math.max(3, Math.min(w, h) * 0.02);
      for (let t = 0.1; t <= 0.9; t += 0.1) {
        const x = p0.x + (p1.x - p0.x) * t, y = p0.y + (p1.y - p0.y) * t;
        const xi = Math.round(x + nx * dd), yi = Math.round(y + ny * dd), xo = Math.round(x - nx * dd), yo = Math.round(y - ny * dd);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
        inT += T[yi * w + xi]; outT += T[yo * w + xo]; k++;
      }
    }
    if (k < 12) return null;
    const step = (outT - inT) / k / desk; // 1: paper fully grey, desk fully tinted
    const conf = Math.min(1, Math.max(0, (step - 0.3) / 0.4)) * Math.min(1, (solid > 1 ? 2 - solid : solid) * 1.08);
    return { mask: big.mask, size: big.size, conf };
  }

  /** share of print marks around each pixel (dark small marks on bright ground, as for the region) */
  function printDensity(img: Rgba, E: EdgeMap): Float32Array {
    const { w, h, L: Lc } = E, n = w * h;
    const Y = luminance(img);
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Lc[i] | 0))]++;
    let c = 0, p95 = 255;
    for (let v = 255; v >= 0; v--) { c += hist[v]; if (c >= n * 0.05) { p95 = v; break; } }
    const mk = new Float32Array(n);
    for (let i = 0; i < n; i++) if (Lc[i] > p95 * 0.55 && Lc[i] - Y[i] > Math.max(22, Lc[i] * 0.14)) mk[i] = 1;
    const r = Math.max(2, Math.round(Math.min(w, h) / 45));
    return boxBlur(boxBlur(mk, w, h, r), w, h, r);
  }

  function paperRegion(img: Rgba, E: EdgeMap): { mask: Uint8Array; size: number; conf: number } | null {
    const { w, h, L: Lc, mag } = E, n = w * h;
    const Y = luminance(img);
    // bright level of the scene
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Lc[i] | 0))]++;
    let c = 0, p95 = 255;
    for (let v = 255; v >= 0; v--) { c += hist[v]; if (c >= n * 0.05) { p95 = v; break; } }
    // marks: much darker than their closed surroundings, on bright ground
    const mk = new Float32Array(n);
    for (let i = 0; i < n; i++) if (Lc[i] > p95 * 0.55 && Lc[i] - Y[i] > Math.max(22, Lc[i] * 0.14)) mk[i] = 1;
    const rd = Math.max(3, Math.round(Math.min(w, h) / 28));
    const dens = boxBlur(boxBlur(mk, w, h, Math.max(1, Math.round(rd * 0.55))), w, h, Math.max(1, Math.round(rd * 0.55)));
    // areas where marks are dense, sizeable ones only (specks on the desk, a key on a keyboard are not
    // a sheet); the seeds are the marks inside them (the density itself spreads past the sheet's edge)
    const area = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (dens[i] > 0.07 && Lc[i] > p95 * 0.55) area[i] = 1;
    const seed = new Uint8Array(n);
    const lab = new Int32Array(n).fill(-1), q: number[] = [], comp: number[] = [];
    let any = 0;
    for (let s = 0; s < n; s++) {
      if (lab[s] !== -1 || !area[s]) continue;
      comp.length = 0;
      lab[s] = s; q.length = 0; q.push(s);
      while (q.length) {
        const j = q.pop()!; comp.push(j);
        const x = j % w;
        if (x > 0 && lab[j - 1] === -1 && area[j - 1]) { lab[j - 1] = s; q.push(j - 1); }
        if (x < w - 1 && lab[j + 1] === -1 && area[j + 1]) { lab[j + 1] = s; q.push(j + 1); }
        if (j >= w && lab[j - w] === -1 && area[j - w]) { lab[j - w] = s; q.push(j - w); }
        if (j < n - w && lab[j + w] === -1 && area[j + w]) { lab[j + w] = s; q.push(j + w); }
      }
      if (comp.length < n * 0.004) continue;
      for (const j of comp) if (mk[j]) { seed[j] = 1; any++; }
    }
    if (any < n * 0.002) return null;
    // label: 1 sheet, 2 surroundings; border seeds stay clear of printed parts that run off the picture
    const lb = new Uint8Array(n);
    const LV = 1024, head = new Int32Array(LV).fill(-1), next = new Int32Array(n);
    const lvl = (i: number) => { const v = Math.round(mag[i] * 8); return v < LV ? v : LV - 1; };
    const push = (i: number, l: number) => { next[i] = head[l]; head[l] = i; };
    for (let i = 0; i < n; i++) if (seed[i]) { lb[i] = 1; push(i, lvl(i)); }
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!lb[i] && dens[i] < 0.02) { lb[i] = 2; push(i, lvl(i)); } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!lb[i] && dens[i] < 0.02) { lb[i] = 2; push(i, lvl(i)); } }
    for (let l = 0; l < LV; l++) {
      while (head[l] !== -1) {
        const i = head[l]; head[l] = next[i];
        const x = i % w, L0 = lb[i];
        for (let k = 0; k < 4; k++) {
          const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < w - 1 ? i + 1 : -1) : k === 2 ? i - w : i + w;
          if (j < 0 || j >= n || lb[j]) continue;
          lb[j] = L0;
          const lj = lvl(j);
          push(j, lj > l ? lj : l);
        }
      }
    }
    const m = new Uint8Array(n);
    for (let i = 0; i < n; i++) m[i] = lb[i] === 1 ? 1 : 0;
    const big = largest(m, w, h);
    if (!big) return null;
    // how much of the outline is a real edge (vs. a flood that met in the middle of flat ground)
    const edgeHigh = (() => {
      const b = new Uint32Array(256);
      for (let i = 0; i < n; i++) b[Math.min(255, (mag[i] * 4) | 0)]++;
      let cc = 0; for (let k = 0; k < 256; k++) { cc += b[k]; if (cc >= n * 0.9) return Math.max(2.5, k / 4); }
      return 16;
    })();
    let bn = 0, strong = 0;
    const near = morph(mag, w, h, 2, true);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!big.mask[i] || (big.mask[i - 1] && big.mask[i + 1] && big.mask[i - w] && big.mask[i + w])) continue;
      bn++;
      // the strongest edge within a pixel or two of the outline
      if (near[i] >= edgeHigh * 0.6) strong++;
    }
    const conf = bn ? strong / bn : 0;
    return { mask: big.mask, size: big.size, conf };
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
  function detectQuad(img: Rgba, opts: { maxLines?: number; live?: boolean; ratios?: number[] } = {}): Detection | null {
    const first = detectWith(img, opts, false);
    if (first && (first.score > 0.62 || (first.agree ?? 0) > 0.5)) return first;
    // nothing clear: look again with thin lines kept (a picture frame, a sign or a screen on a wall,
    // outlined only by a fine dark edge or its shadow, which the first look smooths away with the print)
    const fine = detectWith(img, opts, true);
    if (fine && fine.score > Math.max(0.55, (first?.score ?? 0) + 0.03)) return fine;
    return first;
  }

  function detectWith(img: Rgba, opts: { maxLines?: number; live?: boolean; ratios?: number[] }, fineEdges: boolean): Detection | null {
    const E = edgeMap(img, fineEdges);
    const { w, h } = E;
    const minDim = Math.min(w, h);
    const lines = houghLines(E, (opts.maxLines ?? (opts.live ? 18 : 22)) + (fineEdges ? 8 : 0));
    if ((globalThis as any).__detDebug) { (globalThis as any).__detLines = lines; (globalThis as any).__detE = E; }
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
    // print (small dark marks on bright ground): a side with print just outside it cuts through the
    // sheet (a crease or a fold across a crumpled receipt taken for its end, on a desk as pale as paper)
    const PD = printDensity(img, E);
    const printOut = (p: Pt, q: Pt): number => {
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const nx = (q.y - p.y) / len, ny = -(q.x - p.x) / len; // outward for a clockwise quad (y down)
      const dd = Math.max(4, minDim * 0.05);
      let o = 0, c = 0, ins = 0;
      for (let t = 0.1; t <= 0.9; t += 0.05) {
        const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t;
        const xo = Math.round(x + nx * dd), yo = Math.round(y + ny * dd), xi = Math.round(x - nx * dd), yi = Math.round(y - ny * dd);
        if (xo < 0 || yo < 0 || xo >= w || yo >= h || xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        o += PD[yo * w + xo]; ins += PD[yi * w + xi]; c++;
      }
      if (c < 6) return 0;
      o /= c; ins /= c;
      // print outside, and about as much as inside: the sheet goes on
      return Math.max(0, Math.min(1, (o - 0.025) / 0.05)) * Math.min(1, o / Math.max(0.02, ins * 0.6));
    };
    const xMin = -0.04 * w, xMax = 1.04 * w, yMin = -0.04 * h, yMax = 1.04 * h;
    let best: Detection | null = null;
    const cands: Detection[] = [];
    const consider = (q: Quad, sup: number[], force = false): Detection | null => {
      const area = quadArea(q) / (w * h);
      if (area < (force ? 0.02 : 0.05)) return null;
      const lens = [0, 1, 2, 3].map((s) => Math.hypot(q[(s + 1) % 4].x - q[s].x, q[(s + 1) % 4].y - q[s].y));
      if (Math.min(...lens) < minDim * (force ? 0.05 : 0.1)) return null;
      const angs = cornerAngles(q);
      if (angs.some((a) => a < 30 || a > 150)) return null;
      const per = lens.reduce((s, l) => s + l, 0);
      const fit = lens.reduce((s, l, k) => s + l * sup[k], 0) / per;
      const minSup = Math.min(...sup);
      if (minSup < 0.22 && !force) return null;
      const anglePen = angs.reduce((s, a) => s + Math.max(0, Math.abs(a - 90) - 22) / 40, 0);
      // a sheet is usually brighter than what it lies on, on every side
      const con = [0, 1, 2, 3].map((s) => contrast(E, q[s], q[(s + 1) % 4]));
      const pol = con.every((c) => c > 6) ? 0.03 : con.every((c) => c < -6) ? -0.05 : 0;
      const borderSides = sup.filter((s) => s === 0.42).length;
      // sides whose edge runs on past a corner: that corner is a fold or a printed line, not the sheet's end
      let runOn = 0;
      for (let s = 0; s < 4; s++) {
        if (sup[s] === 0.42) continue;
        const p = q[s], r = q[(s + 1) % 4];
        runOn += Math.max(0, beyond(E, p, r, 0.22) - 0.4) + Math.max(0, beyond(E, r, p, 0.22) - 0.4);
      }
      // the expected shape (ID card, passport page) when the caller knows it
      let shape = 0;
      if (opts.ratios?.length) {
        const r = aspectOf(q, w, h);
        shape = opts.ratios.some((t) => Math.abs(Math.log(r / t)) < 0.09 || Math.abs(Math.log(r * t)) < 0.09) ? 0.07 : 0;
      }
      // sides that run along a pattern on the desk (checked cloth, tiles): the step flips along them
      let texture = 0;
      for (let s = 0; s < 4; s++) if (sup[s] !== 0.42) {
        const f = flips(E, q[s], q[(s + 1) % 4]);
        texture += Math.max(0, f.flip - 0.12);
      }
      let cut = 0;
      for (let s = 0; s < 4; s++) if (sup[s] !== 0.42) cut += printOut(q[s], q[(s + 1) % 4]);
      const score = -0.35 * cut + 0.5 * fit + 0.3 * minSup + 0.38 * Math.sqrt(area) - 0.3 * anglePen + pol - 0.05 * borderSides + shape - 0.6 * runOn - 0.9 * texture;
      if ((globalThis as any).__detDebug) (globalThis as any).__detDebug.push({ score, fit, minSup, area, anglePen, pol, sup, con, q, runOn, cut });
      const det = { quad: q, score, support: sup };
      cands.push(det);
      if (!best || score > best.score) best = det;
      return det;
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
    // the sheet as a region: outlines that cut through it (a fold, a printed rule, the edge of a
    // shadow) or reach far past it (the desk, the picture's border) lose against ones that follow it
    // the sheet as a region: from its print (text marks), or as a clean bright patch; the patch wins
    // when it is as sure (a pattern on the desk can pass for print)
    let reg = paperRegion(img, E);
    const regOk = !!reg && reg.conf > 0.45 && reg.size > w * h * 0.03 && reg.size < w * h * 0.97;
    const blob = paperBlob(img, E);
    if (blob && (!regOk || blob.conf >= reg!.conf - 0.05)) reg = blob;
    // on a tinted desk the colour outlines the sheet best (shading can't break it up)
    const tint = tintBlob(img, E);
    if (tint && tint.conf > 0.6 && (!reg || reg.conf <= 0.45 || tint.size >= reg.size * 0.9)) reg = { ...tint, conf: Math.max(tint.conf, reg && reg.conf > 0.45 ? reg.conf : 0) };
    let regQ: Detection | null = null, overlap: ((q: Quad) => number) | null = null, regW = 0;
    if (reg && reg.size > w * h * 0.03 && reg.size < w * h * 0.97 && reg.conf > 0.45) {
      const rq = maskQuad(reg.mask, w, h);
      // overlap (intersection over union) of a quad with the region, on a grid of about 2500 points
      const st = Math.max(1, Math.round(Math.sqrt((w * h) / 2500)));
      const px: number[] = [], py: number[] = [], pm: number[] = [];
      for (let y = st >> 1; y < h; y += st) for (let x = st >> 1; x < w; x += st) { px.push(x); py.push(y); pm.push(reg.mask[y * w + x]); }
      const np = px.length;
      let rn = 0; for (let k = 0; k < np; k++) rn += pm[k];
      // how badly a quad disagrees with the region: cutting the region off counts fully (a fold or a
      // printed rule taken for the edge); reaching past it counts a little, and only beyond a margin
      // (blank paper the flood didn't reach because a crease or a shadow stopped it)
      overlap = (q: Quad) => {
        // inside = right of every side (clockwise, y down)
        const A: number[] = [], B: number[] = [], C: number[] = [];
        for (let s = 0; s < 4; s++) { const a = q[s], b = q[(s + 1) % 4]; A.push(-(b.y - a.y)); B.push(b.x - a.x); C.push(-(b.y - a.y) * a.x + (b.x - a.x) * a.y); }
        let miss = 0, extra = 0, qn = 0;
        for (let k = 0; k < np; k++) {
          const x = px[k], y = py[k];
          const ins = A[0] * x + B[0] * y - C[0] >= 0 && A[1] * x + B[1] * y - C[1] >= 0 && A[2] * x + B[2] * y - C[2] >= 0 && A[3] * x + B[3] * y - C[3] >= 0;
          if (ins) { qn++; if (!pm[k]) extra++; } else if (pm[k]) miss++;
        }
        return 2 * (rn ? miss / rn : 0) + 0.6 * Math.max(0, (qn ? extra / qn : 1) - 0.12);
      };
      regW = Math.min(1, reg.conf);
      if (rq) regQ = consider(rq, [0, 1, 2, 3].map((s) => support(E, rq[s], rq[(s + 1) % 4])), true);
      if (regQ) regQ.score = Math.max(regQ.score, 0.62);
    }
    let res = best as Detection | null;
    if (!res) return null;
    const ious = new Map<Detection, number>();
    const iouOf = (c: Detection) => { let v = ious.get(c); if (v === undefined) { v = overlap ? overlap(c.quad) : 0; ious.set(c, v); } return v; };
    if (overlap) {
      const adj = (c: Detection) => c.score - regW * iouOf(c);
      const top = cands.slice().sort((a, b) => b.score - a.score).slice(0, 60);
      if (regQ && !top.includes(regQ)) top.push(regQ);
      res = top.reduce((a, b) => (adj(b) > adj(a) ? b : a));
      if ((globalThis as any).__detDebug) (globalThis as any).__detReg = { conf: reg!.conf, size: reg!.size / (w * h), regQ: regQ?.quad, disagree: iouOf(res), mask: reg!.mask };
    }
    // A band or frame printed along the edge (ID card header, table border) makes an inner outline that
    // scores like the sheet itself: when a clearly outlined quad encloses the winner, take the outer one.
    for (let guard = 0; guard < 4; guard++) {
      const inner: Detection = res;
      const outer = cands.filter((c) => c !== inner && c.score > inner.score - 0.09 && Math.min(...c.support) >= 0.85 &&
        quadArea(c.quad) > quadArea(inner.quad) * 1.04 && inner.quad.every((p) => inside(c.quad, p, 2)) && iouOf(c) <= iouOf(inner) + 0.04)
        .sort((a, b) => b.score - a.score)[0];
      if (!outer) break;
      res = outer;
    }
    if (overlap && reg) res = { ...res, agree: Math.max(0, Math.min(1, (reg.conf - 0.6) / 0.3)) * Math.max(0, 1 - iouOf(res) / 0.12) };
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
  function refineQuad(L: Float32Array, w: number, h: number, q: Quad): Quad {
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

  return { luminance, blur, edgeMap, houghLines, detectQuad, refineQuad };
}

const D = detectKernels();
export const luminance = D.luminance;
export const blur = D.blur;
export const edgeMap = D.edgeMap;
export const houghLines = D.houghLines;
export const detectQuad = D.detectQuad;
export const refineQuad = D.refineQuad;
