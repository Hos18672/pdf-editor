// Pixel work for the scanner: perspective crop, sharpening of blurry photos, and the page filters.
//
// Everything lives inside one self-contained function so the same code runs on the main thread and
// in the scanner's worker (src/ui/scan/worker.ts → public/scan/worker.js).

/** auto = Magic (white paper, vivid ink), color = Photo (natural, no flattening) */
export type Filter = 'auto' | 'color' | 'gray' | 'bw' | 'original' | 'lighten' | 'enhance';
export interface PixelImage { w: number; h: number; data: Uint8ClampedArray }
export interface Job {
  src: PixelImage;
  /** tl, tr, br, bl corners in src pixels (x0, y0, x1, y1, …) */
  quad: number[];
  outW: number; outH: number;
  filter: Filter;
  /** 'auto': measure the blur and undo it; 'off': leave sharpness alone */
  sharpen: 'auto' | 'off';
  /** corner radius in output pixels (ID cards), 0 for none */
  radius: number;
  /** curved sides (see bend.ts), in src pixels and in the quad's corner order */
  bend?: number[][] | null;
  /** follow the printed lines and straighten them (sheets of paper, not cards) */
  flatten?: 'rows' | 'cols' | null;
}
export interface JobResult { img: PixelImage; blur: number; times?: Record<string, number> }
/** a straightened page before its look: as photographed, and with the blur taken out (null: wasn't blurred) */
export interface Prepared { warped: PixelImage; sharp: PixelImage | null; blur: number; times?: Record<string, number> }
export interface Kernels {
  process(job: Job): JobResult;
  prepare(job: Omit<Job, 'filter' | 'radius'>): Prepared;
  /** applies a look to a straightened page (in place unless turned), then `rot` quarter turns and corners */
  finish(img: PixelImage, filter: Filter, blur: number, radius: number, rot: number): PixelImage;
  shrink(img: PixelImage, max: number): PixelImage;
  estimateBlur(img: PixelImage): number;
}

export function scanKernels(): Kernels {
  // ---------------------------------------------------------------- helpers
  function gaussKernel(sigma: number): Float32Array {
    const r = Math.max(1, Math.ceil(sigma * 2.6));
    const k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    return k;
  }

  /** separable Gaussian blur of a float plane (edges clamped) */
  function blurPlane(a: Float32Array, w: number, h: number, sigma: number, out?: Float32Array, tmp?: Float32Array): Float32Array {
    const k = gaussKernel(sigma), K = k.length, r = (K - 1) >> 1;
    const t = tmp || new Float32Array(a.length), o = out || new Float32Array(a.length);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = 0;
        if (x >= r && x < w - r) { const b = row + x - r; for (let i = 0; i < K; i++) v += a[b + i] * k[i]; }
        else for (let i = -r; i <= r; i++) { const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i; v += a[row + xx] * k[i + r]; }
        t[row + x] = v;
      }
    }
    // vertical pass row by row (streams through memory instead of striding down columns)
    for (let y = 0; y < h; y++) {
      const ob = y * w;
      for (let x = 0; x < w; x++) o[ob + x] = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        const kb = k[i + r], tb = yy * w;
        for (let x = 0; x < w; x++) o[ob + x] += t[tb + x] * kb;
      }
    }
    return o;
  }

  /** about a Gaussian blur of the given sigma: two running-mean passes each way, constant time per pixel */
  function boxSmooth(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
    const b = Math.max(1, Math.round(Math.sqrt(6 * sigma * sigma + 1) / 2 - 0.5));
    let cur = a;
    for (let pass = 0; pass < 2; pass++) {
      const t = new Float32Array(cur.length), o = new Float32Array(cur.length), k = 1 / (2 * b + 1);
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let s = 0;
        for (let i = -b - 1; i < b; i++) s += cur[row + (i < 0 ? 0 : i >= w ? w - 1 : i)];
        for (let x = 0; x < w; x++) {
          s += cur[row + (x + b >= w ? w - 1 : x + b)] - cur[row + (x - b - 1 < 0 ? 0 : x - b - 1)];
          t[row + x] = s * k;
        }
      }
      // vertical: running sums for a whole row at a time (streams through memory)
      const acc = new Float32Array(w);
      for (let i = -b - 1; i < b; i++) { const r0 = (i < 0 ? 0 : i >= h ? h - 1 : i) * w; for (let x = 0; x < w; x++) acc[x] += t[r0 + x]; }
      for (let y = 0; y < h; y++) {
        const ra = (y + b >= h ? h - 1 : y + b) * w, rs = (y - b - 1 < 0 ? 0 : y - b - 1) * w, ro = y * w;
        for (let x = 0; x < w; x++) { acc[x] += t[ra + x] - t[rs + x]; o[ro + x] = acc[x] * k; }
      }
      cur = o;
    }
    return cur;
  }

  function lumaPlane(img: PixelImage): Float32Array {
    const n = img.w * img.h, d = img.data, Y = new Float32Array(n);
    for (let i = 0, p = 0; p < n; i += 4, p++) Y[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return Y;
  }

  /** bilinear resize of a float plane */
  function resizePlane(a: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
    const o = new Float32Array(W * H);
    const sx = w / W, sy = h / H;
    for (let y = 0; y < H; y++) {
      let fy = (y + 0.5) * sy - 0.5; if (fy < 0) fy = 0; if (fy > h - 1) fy = h - 1;
      const y0 = fy | 0, y1 = y0 + 1 < h ? y0 + 1 : y0, ty = fy - y0;
      for (let x = 0; x < W; x++) {
        let fx = (x + 0.5) * sx - 0.5; if (fx < 0) fx = 0; if (fx > w - 1) fx = w - 1;
        const x0 = fx | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, tx = fx - x0;
        const a0 = a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx;
        const a1 = a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx;
        o[y * W + x] = a0 * (1 - ty) + a1 * ty;
      }
    }
    return o;
  }

  /** downscale of a float plane: box-average by a whole factor, then bilinear to the exact size */
  function shrinkPlane(a: Float32Array, w: number, h: number, W: number, H: number): Float32Array {
    const f = Math.max(1, Math.floor(Math.min(w / W, h / H)));
    if (f === 1) return resizePlane(a, w, h, W, H);
    const bw = Math.floor(w / f), bh = Math.floor(h / f), b = new Float32Array(bw * bh), inv = 1 / (f * f);
    for (let y = 0; y < bh; y++) for (let yy = 0; yy < f; yy++) {
      const src = (y * f + yy) * w, dst = y * bw;
      for (let x = 0; x < bw; x++) { let v = 0; const s0 = src + x * f; for (let k = 0; k < f; k++) v += a[s0 + k]; b[dst + x] += v * inv; }
    }
    return resizePlane(b, bw, bh, W, H);
  }

  // ---------------------------------------------------------------- perspective crop
  function solveH(src: number[], dst: number[]): number[] {
    const A: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const x = src[2 * i], y = src[2 * i + 1], u = dst[2 * i], v = dst[2 * i + 1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      const tmp = A[c]; A[c] = A[p]; A[p] = tmp;
      const d = A[c][c] || 1e-12;
      for (let k = c; k < 9; k++) A[c][k] /= d;
      for (let r = 0; r < 8; r++) if (r !== c) {
        const f = A[r][c];
        if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
      }
    }
    return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
  }

  /** displacement of one side at a parameter 0…1 (linear between samples) */
  function sideAt(a: number[], t: number, out: Float32Array, o: number): void {
    const n = a.length / 2 - 1;
    let f = t * n; if (f < 0) f = 0; if (f > n) f = n;
    const i = Math.min(n - 1, f | 0), k = f - i;
    out[o] = a[2 * i] + (a[2 * i + 2] - a[2 * i]) * k;
    out[o + 1] = a[2 * i + 1] + (a[2 * i + 3] - a[2 * i + 1]) * k;
  }

  /**
   * splits a side's displacement samples (x, y pairs, zero at both corners) into its broad bow (left in
   * `d`) and the local waves (returned)
   */
  function bandSplit(d: number[]): number[] {
    const n = d.length / 2, sg = Math.max(1.5, n * 0.1), r = Math.ceil(sg * 2.5);
    // mirrored with a sign flip past the ends, so the broad part stays zero at the corners
    const at = (i: number, c: number) => { while (i < 0 || i > n - 1) i = i < 0 ? -i : 2 * (n - 1) - i; return d[2 * i + c]; };
    const sgnAt = (i: number) => { let f = 1; while (i < 0 || i > n - 1) { i = i < 0 ? -i : 2 * (n - 1) - i; f = -f; } return f; };
    const lo: number[] = new Array(2 * n).fill(0);
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
      let v = 0, ks = 0;
      for (let j = -r; j <= r; j++) { const g = Math.exp(-(j * j) / (2 * sg * sg)); v += g * sgnAt(i + j) * at(i + j, c); ks += g; }
      lo[2 * i + c] = v / ks;
    }
    const hi = d.map((v, i) => v - lo[i]);
    for (let i = 0; i < 2 * n; i++) d[i] = lo[i];
    return hi;
  }

  /**
   * output rectangle → quad in the source; bilinear sampling, white outside the photo. With a bend, the
   * curved sides are blended across the page (Coons patch) on top of the perspective.
   */
  function warp(src: PixelImage, quad: number[], W: number, H: number, inset: number, bend?: number[][] | null, field?: LineField | null): PixelImage {
    const m = -inset;
    const Hm = solveH([m, m, W - m, m, W - m, H - m, m, H - m], quad);
    const out = new Uint8ClampedArray(W * H * 4);
    const sw = src.w, sh = src.h, sd = src.data;
    // per column: top / bottom side displacement; per row: left / right
    let Dt: Float32Array | null = null, Db: Float32Array | null = null, Dl: Float32Array | null = null, Dr: Float32Array | null = null;
    let Ht: Float32Array | null = null, Hb: Float32Array | null = null, Hl: Float32Array | null = null, Hr: Float32Array | null = null, lx = 1, ly = 1;
    let eT: Float32Array | null = null, eB: Float32Array | null = null, eL: Float32Array | null = null, eR: Float32Array | null = null;
    const span = W - 2 * m, spanY = H - 2 * m;
    if (bend && bend.some((a) => a.some((v) => v !== 0))) {
      Dt = new Float32Array(W * 2); Db = new Float32Array(W * 2); Dl = new Float32Array(H * 2); Dr = new Float32Array(H * 2);
      // a side's broad bow is blended across the whole page; its local waves (a bulge, a curled bit)
      // only move the paper near that side
      const lo = bend.map((a) => Array.from(a)), hi = lo.map((a) => bandSplit(a));
      Ht = new Float32Array(W * 2); Hb = new Float32Array(W * 2); Hl = new Float32Array(H * 2); Hr = new Float32Array(H * 2);
      for (let x = 0; x < W; x++) {
        const u = (x + 0.5 - m) / span;
        sideAt(lo[0], u, Dt, 2 * x); sideAt(lo[2], 1 - u, Db, 2 * x); sideAt(hi[0], u, Ht, 2 * x); sideAt(hi[2], 1 - u, Hb, 2 * x);
      }
      for (let y = 0; y < H; y++) {
        const v = (y + 0.5 - m) / spanY;
        sideAt(lo[1], v, Dr, 2 * y); sideAt(lo[3], 1 - v, Dl, 2 * y); sideAt(hi[1], v, Hr, 2 * y); sideAt(hi[3], 1 - v, Hl, 2 * y);
      }
      lx = Math.max(8, W * 0.06); ly = Math.max(8, H * 0.06);
      lx = ly = Math.max(lx, ly) * 0.5 + Math.min(lx, ly) * 0.5;
      eT = new Float32Array(H); eB = new Float32Array(H); eL = new Float32Array(W); eR = new Float32Array(W);
      for (let y = 0; y < H; y++) { eT[y] = Math.exp(-Math.max(0, y + 0.5 - m) / ly); eB[y] = Math.exp(-Math.max(0, H - m - y - 0.5) / ly); }
      for (let x = 0; x < W; x++) { eL[x] = Math.exp(-Math.max(0, x + 0.5 - m) / lx); eR[x] = Math.exp(-Math.max(0, W - m - x - 0.5) / lx); }
    }
    // straightened text lines: a vertical offset per column, from the strips' values at this row
    const fdy = field ? new Float32Array(W) : null;
    for (let y = 0; y < H; y++) {
      if (field) { if (field.cols) fieldCols(field, y, W, fdy!); else fieldRow(field, y, W, fdy!); }
      for (let x = 0; x < W; x++) {
        const off = fdy ? fdy[x] : 0;
        const xc = x + 0.5 + (field?.cols ? off : 0), yc = y + 0.5 + (field?.cols ? 0 : off);
        const v1 = (yc - m) / spanY, v0 = 1 - v1;
        const z = Hm[6] * xc + Hm[7] * yc + Hm[8];
        let u = (Hm[0] * xc + Hm[1] * yc + Hm[2]) / z - 0.5, v = (Hm[3] * xc + Hm[4] * yc + Hm[5]) / z - 0.5;
        if (Dt) {
          const u1 = (xc - m) / span, u0 = 1 - u1;
          const yy = yc < 0 ? 0 : yc >= H ? H - 1 : yc | 0, xx = xc < 0 ? 0 : xc >= W ? W - 1 : xc | 0;
          // decay of the local waves with the distance from each side
          const dT = eT![yy], dB = eB![yy], dL = eL![xx], dR = eR![xx];
          u += v0 * Dt[2 * xx] + v1 * Db![2 * xx] + u0 * Dl![2 * yy] + u1 * Dr![2 * yy] + dT * Ht![2 * xx] + dB * Hb![2 * xx] + dL * Hl![2 * yy] + dR * Hr![2 * yy];
          v += v0 * Dt[2 * xx + 1] + v1 * Db![2 * xx + 1] + u0 * Dl![2 * yy + 1] + u1 * Dr![2 * yy + 1] + dT * Ht![2 * xx + 1] + dB * Hb![2 * xx + 1] + dL * Hl![2 * yy + 1] + dR * Hr![2 * yy + 1];
        }
        const o = (y * W + x) * 4;
        if (u < -1 || v < -1 || u > sw || v > sh) { out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = 255; continue; }
        if (u < 0) u = 0; if (v < 0) v = 0; if (u > sw - 1.001) u = sw - 1.001; if (v > sh - 1.001) v = sh - 1.001;
        const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
        const i00 = (y0 * sw + x0) * 4, i01 = i00 + 4, i10 = i00 + sw * 4, i11 = i10 + 4;
        const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
        out[o] = sd[i00] * w00 + sd[i01] * w01 + sd[i10] * w10 + sd[i11] * w11;
        out[o + 1] = sd[i00 + 1] * w00 + sd[i01 + 1] * w01 + sd[i10 + 1] * w10 + sd[i11 + 1] * w11;
        out[o + 2] = sd[i00 + 2] * w00 + sd[i01 + 2] * w01 + sd[i10 + 2] * w10 + sd[i11 + 2] * w11;
        out[o + 3] = 255;
      }
    }
    return { w: W, h: H, data: out };
  }

  // ---------------------------------------------------------------- straight text lines
  /** vertical offsets that make printed lines straight: values at strip centres `xs` for every output row */
  interface LineField { xs: Float32Array; ns: number; H: number; dy: Float32Array; cols?: boolean }

  /** a field measured on the page turned on its side (text running down): x offsets along row y */
  function fieldCols(f: LineField, y: number, W: number, out: Float32Array): void {
    const { xs, ns, H, dy } = f; // H here is the page's width
    const yc = y + 0.5;
    let s = 0, t = 0;
    if (ns === 1) { s = 0; t = 0; }
    else if (yc <= xs[0]) { s = 0; t = (yc - xs[0]) / (xs[1] - xs[0]); }
    else if (yc >= xs[ns - 1]) { s = ns - 2; t = (yc - xs[ns - 2]) / (xs[ns - 1] - xs[ns - 2]); }
    else { while (s < ns - 2 && yc > xs[s + 1]) s++; t = (yc - xs[s]) / (xs[s + 1] - xs[s]); }
    const s1 = Math.min(ns - 1, s + 1);
    for (let x = 0; x < W; x++) { const xx = x < H ? x : H - 1; out[x] = dy[s * H + xx] * (1 - t) + dy[s1 * H + xx] * t; }
  }

  function fieldRow(f: LineField, y: number, W: number, out: Float32Array): void {
    const { xs, ns, H, dy } = f;
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    if (ns === 1) { out.fill(dy[yy]); return; }
    let s = 0;
    for (let x = 0; x < W; x++) {
      const xc = x + 0.5;
      while (s < ns - 2 && xc > xs[s + 1]) s++;
      // past the outer strips: carried on along the slope there (a curled edge keeps curling)
      if (xc <= xs[0]) out[x] = dy[yy] + ((dy[yy] - dy[H + yy]) * (xs[0] - xc)) / (xs[1] - xs[0]);
      else if (xc >= xs[ns - 1]) out[x] = dy[(ns - 1) * H + yy] + ((dy[(ns - 1) * H + yy] - dy[(ns - 2) * H + yy]) * (xc - xs[ns - 1])) / (xs[ns - 1] - xs[ns - 2]);
      else { const t = (xc - xs[s]) / (xs[s + 1] - xs[s]); out[x] = dy[s * H + yy] * (1 - t) + dy[(s + 1) * H + yy] * t; }
    }
  }

  function transpose(img: PixelImage): PixelImage {
    const w = img.w, h = img.h, s32 = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
    const out = new Uint8ClampedArray(w * h * 4), o = new Uint32Array(out.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + y] = s32[y * w + x];
    return { w: h, h: w, data: out };
  }

  /**
   * Follows the printed lines across a straightened page and works out how far each part of each line
   * sits above or below where it would on flat paper — a crumpled receipt, a page bent over a fold.
   * Text is found as small dark marks, smeared sideways into line bands; in narrow vertical strips the
   * band centres are linked from strip to strip into lines. Each line should run level: the offsets
   * between lines are interpolated, so the paper between them moves with them.
   * Returns null when there aren't enough lines to be sure, or nothing to straighten.
   */
  function lineField(img: PixelImage): LineField | null {
    const W = img.w, H = img.h;
    const k = Math.min(1, 640 / W);
    const w = Math.max(32, Math.round(W * k)), h = Math.max(32, Math.round(H * k)), n = w * h;
    const kx = W / w, ky = H / h;
    const Y = k < 1 ? shrinkPlane(lumaPlane(img), W, H, w, h) : lumaPlane(img);
    const bg = closing(Y, w, h, Math.max(4, Math.round(w / 70)));
    // text: clearly darker than the paper around it, smeared along the line
    const hx = Math.max(4, Math.round(w / 45));
    const I = new Uint8Array(n);
    for (let p = 0; p < n; p++) I[p] = (bg[p] - Y[p]) / Math.max(30, bg[p]) > 0.22 ? 1 : 0;
    const D = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      const ink = (x: number) => I[row + (x < 0 ? 0 : x >= w ? w - 1 : x)];
      for (let x = -hx - 1; x < hx; x++) s += ink(x);
      for (let x = 0; x < w; x++) { s += ink(x + hx) - ink(x - hx - 1); D[row + x] = s / (2 * hx + 1); }
    }
    // only for text that runs across (a page still lying sideways is left alone): in square tiles, ink
    // summed along each row ripples from line to line; summed along each column it evens out
    let rh = 0, rv = 0;
    {
      const T = Math.max(24, Math.round(w / 6)), rs = new Float32Array(T), cs = new Float32Array(T);
      for (let ty = 0; ty + T <= h; ty += T) for (let tx = 0; tx + T <= w; tx += T) {
        rs.fill(0); cs.fill(0);
        let tot = 0;
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const v = I[(ty + y) * w + tx + x]; rs[y] += v; cs[x] += v; tot += v; }
        if (tot < T * T * 0.02) continue;
        const m = tot / T;
        let vr = 0, vc = 0;
        for (let i = 0; i < T; i++) { vr += (rs[i] - m) ** 2; vc += (cs[i] - m) ** 2; }
        // a vote per tile (a barcode or a crease doesn't outweigh the text)
        if (vr > vc * 1.4) rh++; else if (vc > vr * 1.4) rv++;
      }
    }
    // clearly sideways (a page not turned yet): left alone
    if (rv > rh * 1.5) return null;
    // narrow strips (half overlapping), band centres in each
    const sw = w / Math.max(3, Math.min(24, Math.round(w / 53))), step = sw / 2;
    const ns = Math.max(3, Math.floor((w - sw) / step + 1e-6) + 1);
    const cx = new Float32Array(ns);
    const peaks: number[][] = [];
    // running sums along each row, so a strip's ink per row is one subtraction
    const CS = new Float32Array(h * (w + 1));
    for (let y = 0; y < h; y++) { let a = 0; const o = y * (w + 1); for (let x = 0; x < w; x++) { a += D[y * w + x]; CS[o + x + 1] = a; } }
    const P = new Float32Array(h), Q = new Float32Array(h);
    const L = Math.max(6, Math.round(h / 120));
    for (let s = 0; s < ns; s++) {
      const x0 = Math.round(s * step), x1 = Math.min(w, Math.round(s * step + sw));
      cx[s] = (x0 + x1) / 2;
      for (let y = 0; y < h; y++) P[y] = (CS[y * (w + 1) + x1] - CS[y * (w + 1) + x0]) / (x1 - x0);
      for (let y = 0; y < h; y++) { let v = 0, c = 0; for (let d = -2; d <= 2; d++) { const yy = y + d; if (yy >= 0 && yy < h) { v += P[yy]; c++; } } Q[y] = v / c; }
      const list: number[] = [];
      for (let y = 3; y < h - 3; y++) {
        const v = Q[y];
        if (v < 0.08) continue;
        let top = true;
        for (let d = 1; d <= 4 && top; d++) { if ((y - d >= 0 && Q[y - d] > v) || (y + d < h && Q[y + d] >= v)) top = false; }
        if (!top) continue;
        let lo1 = v, lo2 = v;
        for (let d = 1; d <= L * 2 && y - d >= 0; d++) lo1 = Math.min(lo1, Q[y - d]);
        for (let d = 1; d <= L * 2 && y + d < h; d++) lo2 = Math.min(lo2, Q[y + d]);
        if (v - Math.max(lo1, lo2) < 0.06) continue;
        // the middle of the band at half height: the body of the letters, little moved by which
        // letters reach up or down in this strip
        const half = v * 0.5;
        let yt = y, yb = y;
        while (yt > 0 && Q[yt - 1] > half) yt--;
        while (yb < h - 1 && Q[yb + 1] > half) yb++;
        const ft = yt > 0 ? yt - (Q[yt] - half) / Math.max(1e-6, Q[yt] - Q[yt - 1]) : yt;
        const fb = yb < h - 1 ? yb + (Q[yb] - half) / Math.max(1e-6, Q[yb] - Q[yb + 1]) : yb;
        // a solid block (barcode, QR code, logo) is no line of text, but its top and bottom edges run
        // level on flat paper just the same
        if (yb - yt > L * 4) { if (yt > 0) list.push(ft); if (yb < h - 1) list.push(fb); continue; }
        list.push((ft + fb) / 2);
      }
      // tall solid blocks: their top and bottom edges
      for (let y = 1; y < h - 1; y++) {
        if (Q[y] <= 0.45 || Q[y - 1] > 0.45) continue;
        let e = y; while (e < h - 1 && Q[e + 1] > 0.45) e++;
        if (e - y > L * 4 && e < h - 1) {
          const a0 = y - (Q[y] - 0.45) / Math.max(1e-6, Q[y] - Q[y - 1]), a1 = e + (Q[e] - 0.45) / Math.max(1e-6, Q[e] - Q[e + 1]);
          for (const v of [a0, a1]) if (!list.some((u) => Math.abs(u - v) < L * 0.5)) list.push(v);
        }
        y = e;
      }
      list.sort((a, b) => a - b);
      peaks.push(list);
    }
    // typical line spacing
    const gaps: number[] = [];
    for (const l of peaks) for (let i = 1; i < l.length; i++) gaps.push(l[i] - l[i - 1]);
    if (gaps.length < 8) return null;
    gaps.sort((a, b) => a - b);
    const sp = gaps[gaps.length >> 1];
    // link band centres from strip to strip (mutually nearest, close enough). Gaps between the columns
    // of a table may be wide: a line is followed across up to a fifth of the page
    const gmax = Math.max(3, Math.ceil((w * 0.2) / step));
    interface Track { s: number[]; y: number[] }
    const tracks: Track[] = [];
    let open: Track[] = [];
    for (let s = 0; s < ns; s++) {
      const l = peaks[s], used = new Uint8Array(l.length), next: Track[] = [];
      const cands = open.filter((t) => s - t.s[t.s.length - 1] <= gmax);
      const pred = (t: Track) => {
        const n0 = t.s.length, ly = t.y[n0 - 1];
        // the track's own slope over its last stretch (not much over a short one)
        let k = n0 - 1; while (k > 0 && t.s[n0 - 1] - t.s[k - 1] <= 4) k--;
        const slope = k < n0 - 1 ? ((t.y[n0 - 1] - t.y[k]) / (t.s[n0 - 1] - t.s[k])) * Math.min(1, (t.s[n0 - 1] - t.s[k]) / 3) : 0;
        return ly + slope * (s - t.s[n0 - 1]);
      };
      const py = cands.map(pred);
      cands.forEach((t, ti) => {
        let bi = -1, bd = sp * 0.3;
        for (let i = 0; i < l.length; i++) { const d = Math.abs(l[i] - py[ti]); if (!used[i] && d < bd) { bd = d; bi = i; } }
        if (bi < 0) { next.push(t); return; }
        // mutual: no other open track expects this centre more closely
        if (cands.some((o, oi) => o !== t && Math.abs(py[oi] - l[bi]) < bd - 0.5)) { next.push(t); return; }
        used[bi] = 1; t.s.push(s); t.y.push(l[bi]); next.push(t);
      });
      for (let i = 0; i < l.length; i++) if (!used[i]) { const t = { s: [s], y: [l[i]] }; tracks.push(t); next.push(t); }
      open = next.filter((t) => s - t.s[t.s.length - 1] < gmax);
    }
    // Each piece of a line says how much higher or lower the paper sits at one place than at another
    // along it. All pieces together, with the paper bending smoothly in between, give one offset per
    // strip and height (least squares): lines broken by wide gaps still come out level end to end.
    const gy = Math.max(3, sp * 0.5), G = Math.max(2, Math.ceil(h / gy) + 1), NN = ns * G;
    const ea: number[] = [], eb: number[] = [], eg: number[] = [], et: number[] = [], er: number[] = [];
    const tol = Math.max(1.2, sp * 0.12);
    for (const t0 of tracks) {
      if (t0.s.length < 2) continue;
      // a point that jumps away from both neighbours is a misread (a mark above or below the line)
      const keep = t0.y.map((y, i, a) => {
        const nb = [a[i - 1], a[i + 1]].filter((v) => v !== undefined);
        if (nb.length === 2) { const m3 = [nb[0], y, nb[1]].sort((p, q) => p - q)[1]; return Math.abs(y - m3) <= tol; }
        return Math.abs(y - nb[0]) <= tol * 2;
      });
      const ts = t0.s.filter((_, i) => keep[i]), ty = t0.y.filter((_, i) => keep[i]);
      if (ts.length < 2) continue;
      const m = ty.reduce((a, b) => a + b, 0) / ty.length;
      if (ty.some((y) => Math.abs(y - m) > sp * 1.2)) continue;
      let g = m / gy; if (g > G - 1.001) g = G - 1.001;
      for (let i = 1; i < ts.length; i++) { ea.push(ts[i - 1]); eb.push(ts[i]); eg.push(g | 0); et.push(g - (g | 0)); er.push(ty[i] - ty[i - 1]); }
    }
    const NE = ea.length;
    if (NE < 12) return null;
    const ew = new Float32Array(NE).fill(1);
    // smoothness: bends across (second differences along the row), and up the page
    const LS2 = 0.35, LG2 = 1.2, LG1 = 0.06, L0 = 0.004, MU = 0.3;
    // normal equations, solved exactly: unknowns ordered row by row (g, then strip), so every term
    // couples unknowns at most two rows apart and the matrix is a band of width 2·ns
    const idx = (st: number, g: number) => g * ns + st;
    const bw = 2 * ns, BW1 = bw + 1;
    const A = new Float64Array(NN * BW1), rhs = new Float64Array(NN), f = new Float64Array(NN);
    // A[i][i - d] for d = 0…bw, kept as A[i·BW1 + d]
    const add = (i: number, j: number, v: number) => { if (j > i) { const t = i; i = j; j = t; } A[i * BW1 + i - j] += v; };
    const outer = (ix: number[], cf: number[], wgt: number) => {
      for (let p = 0; p < ix.length; p++) for (let q = 0; q <= p; q++) {
        const v = cf[p] * cf[q] * wgt;
        if (ix[p] === ix[q]) add(ix[p], ix[q], p === q ? v : 2 * v); else add(ix[p], ix[q], v);
      }
    };
    const solve = () => {
      A.fill(0); rhs.fill(0);
      for (let e = 0; e < NE; e++) {
        if (!ew[e]) continue;
        const g0 = eg[e], t = et[e];
        const ix = [idx(eb[e], g0), idx(eb[e], g0 + 1), idx(ea[e], g0), idx(ea[e], g0 + 1)], cf = [1 - t, t, t - 1, -t];
        outer(ix, cf, ew[e]);
        for (let p = 0; p < 4; p++) rhs[ix[p]] += cf[p] * er[e] * ew[e];
      }
      for (let st = 1; st < ns - 1; st++) for (let g = 0; g < G; g++) outer([idx(st - 1, g), idx(st, g), idx(st + 1, g)], [1, -2, 1], LS2 * LS2);
      for (let st = 0; st < ns; st++) {
        for (let g = 1; g < G - 1; g++) outer([idx(st, g - 1), idx(st, g), idx(st, g + 1)], [1, -2, 1], LG2 * LG2);
        for (let g = 1; g < G; g++) outer([idx(st, g - 1), idx(st, g)], [-1, 1], LG1 * LG1);
      }
      for (let i = 0; i < NN; i++) A[i * BW1] += L0 * L0;
      // only how the paper moves along each row is measured: its average is kept at zero
      const ones = new Array(ns).fill(1);
      for (let g = 0; g < G; g++) outer(Array.from({ length: ns }, (_, st) => idx(st, g)), ones, MU * MU);
      // banded Cholesky, in place
      for (let i = 0; i < NN; i++) {
        const j0 = Math.max(0, i - bw);
        for (let j = j0; j <= i; j++) {
          let sum = A[i * BW1 + i - j];
          const k0 = Math.max(j0, j - bw);
          for (let k = k0; k < j; k++) sum -= A[i * BW1 + i - k] * A[j * BW1 + j - k];
          if (j === i) A[i * BW1] = Math.sqrt(Math.max(sum, 1e-12));
          else A[i * BW1 + i - j] = sum / A[j * BW1];
        }
      }
      for (let i = 0; i < NN; i++) { let sum = rhs[i]; for (let k = Math.max(0, i - bw); k < i; k++) sum -= A[i * BW1 + i - k] * f[k]; f[i] = sum / A[i * BW1]; }
      for (let i = NN - 1; i >= 0; i--) { let sum = f[i]; for (let k = i + 1; k <= Math.min(NN - 1, i + bw); k++) sum -= A[k * BW1 + k - i] * f[k]; f[i] = sum / A[i * BW1]; }
    };
    for (let round = 0; round < 3; round++) {
      solve();
      if (round === 2) break;
      // pieces that disagree with the rest (two lines mixed up, a mark read as a line) count less
      const res = new Float32Array(NE);
      for (let e = 0; e < NE; e++) {
        const g0 = eg[e], t = et[e];
        res[e] = Math.abs((f[idx(eb[e], g0)] - f[idx(ea[e], g0)]) * (1 - t) + (f[idx(eb[e], g0 + 1)] - f[idx(ea[e], g0 + 1)]) * t - er[e]);
      }
      const srt = Array.from(res).sort((p, q) => p - q);
      const c = Math.max(2.5, 4 * 1.4826 * srt[NE >> 1]);
      for (let e = 0; e < NE; e++) { const u = res[e] / c; ew[e] = u >= 1 ? 0 : (1 - u * u) ** 2; }
    }
    // per strip, offsets at every full-size row; tiny ones (the letters' own shapes) left alone
    const dy = new Float32Array(ns * H), sh = 0.5;
    let maxD = 0;
    for (let s = 0; s < ns; s++) for (let Yr = 0; Yr < H; Yr++) {
      let g = (Yr + 0.5) / ky / gy; if (g > G - 1.001) g = G - 1.001;
      const g0 = g | 0, t = g - g0;
      const v0 = f[idx(s, g0)] * (1 - t) + f[idx(s, g0 + 1)] * t;
      const v = v0 > sh ? v0 - sh : v0 < -sh ? v0 + sh : 0;
      dy[s * H + Yr] = v * ky;
      if (Math.abs(v * ky) > maxD) maxD = Math.abs(v * ky);
    }
    if (maxD < 0.6) return null;
    const xs = new Float32Array(ns);
    for (let s = 0; s < ns; s++) xs[s] = cx[s] * kx;
    return { xs, ns, H, dy };
  }

  // ---------------------------------------------------------------- blur: measure and undo
  function gradMag(Y: Float32Array, w: number, h: number): Float32Array {
    const g = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (Y[i - w + 1] + 2 * Y[i + 1] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - 1] - Y[i + w - 1]) / 8;
      const gy = (Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - w] - Y[i - w + 1]) / 8;
      g[i] = Math.sqrt(gx * gx + gy * gy);
    }
    return g;
  }

  /**
   * Blur radius (Gaussian sigma, in pixels) from strong edges: blurring an edge again by s0 lowers
   * its steepest gradient by sqrt(s² + s0²) / s, which gives s (Zhuo & Sim, defocus map estimation).
   */
  function estimateBlurY(Y: Float32Array, w: number, h: number): number {
    const s0 = 1.2;
    const g1 = gradMag(Y, w, h), g2 = gradMag(blurPlane(Y, w, h, s0), w, h);
    const bins = new Uint32Array(512);
    let n = 0;
    for (let i = 0; i < g1.length; i++) { const b = Math.min(511, (g1[i] * 4) | 0); bins[b]++; n++; }
    let c = 0, thr = 128;
    for (let b = 511; b >= 0; b--) { c += bins[b]; if (c >= n * 0.02) { thr = b / 4; break; } }
    thr = Math.max(thr, 6);
    const est: number[] = [];
    for (let y = 2; y < h - 2; y += 1) for (let x = 2; x < w - 2; x += 1) {
      const i = y * w + x, m = g1[i];
      if (m < thr) continue;
      // local maximum among the 8 neighbours = centre of the edge
      if (m < g1[i - 1] || m < g1[i + 1] || m < g1[i - w] || m < g1[i + w] || m < g1[i - w - 1] || m < g1[i + w + 1] || m < g1[i - w + 1] || m < g1[i + w - 1]) continue;
      const r = m / Math.max(1e-3, g2[i]);
      if (r <= 1.01) { est.push(8); continue; }
      est.push(Math.min(8, s0 / Math.sqrt(r * r - 1)));
      if (est.length > 40000) break;
    }
    if (est.length < 30) return 0;
    est.sort((a, b) => a - b);
    return est[(est.length * 0.55) | 0] * 1.22; // calibrated on text pages blurred by a known amount
  }

  /**
   * Richardson–Lucy deconvolution of the brightness with a Gaussian of the measured blur. Runs on a
   * smaller copy when the blur is wide (a blurred photo holds no finer detail anyway), and adds the
   * recovered detail back to the colour image.
   */
  function deblur(img: PixelImage, sigma: number): void {
    const w = img.w, h = img.h;
    // work at a scale where the remaining blur is about 1.4 px
    const target = 1.05;
    const s = Math.min(1, target / sigma);
    const W = Math.max(8, Math.round(w * s)), H = Math.max(8, Math.round(h * s));
    const Yfull = lumaPlane(img);
    const Y = s < 1 ? shrinkPlane(Yfull, w, h, W, H) : Yfull;
    const sig = Math.max(0.6, Math.sqrt(Math.max(0, sigma * sigma - 0.55 * 0.55)) * s * 0.92);
    const n = W * H;
    const obs = new Float32Array(n);
    for (let i = 0; i < n; i++) obs[i] = Math.max(2, Y[i]) / 255;
    let u = new Float32Array(obs);
    const c = new Float32Array(n), t = new Float32Array(n), ratio = new Float32Array(n), corr = new Float32Array(n);
    const iters = Math.round(Math.min(8, 3 + sig * 3));
    for (let it = 0; it < iters; it++) {
      blurPlane(u, W, H, sig, c, t);
      for (let i = 0; i < n; i++) {
        let r = obs[i] / (c[i] > 1e-3 ? c[i] : 1e-3);
        r = r < 0.55 ? 0.55 : r > 1.8 ? 1.8 : r; // damped: keeps noise and ringing in check
        ratio[i] = r;
      }
      blurPlane(ratio, W, H, sig, corr, t);
      // over-relaxed step (corr^1.5): about the effect of twice as many plain iterations
      for (let i = 0; i < n; i++) { const cr = corr[i]; let v = u[i] * cr * Math.sqrt(cr); v = v < 0 ? 0 : v > 1.15 ? 1.15 : v; u[i] = v; }
    }
    const delta = new Float32Array(n);
    for (let i = 0; i < n; i++) delta[i] = (u[i] - obs[i]) * 255;
    const D = s < 1 ? resizePlane(delta, W, H, w, h) : delta;
    const d = img.data;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = D[p];
      d[i] = d[i] + v; d[i + 1] = d[i + 1] + v; d[i + 2] = d[i + 2] + v;
    }
  }

  function unsharp(img: PixelImage, sigma: number, amount: number): void {
    const w = img.w, h = img.h, d = img.data;
    const Y = lumaPlane(img), B = blurPlane(Y, w, h, sigma);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = (Y[p] - B[p]) * amount;
      d[i] = d[i] + v; d[i + 1] = d[i + 1] + v; d[i + 2] = d[i + 2] + v;
    }
  }

  // ---------------------------------------------------------------- paper & lighting
  /**
   * Paper colour across the page (shadows, uneven light, tinted paper): the bright end of each
   * block's brightness; blocks inside photos or dark areas are filled in from their neighbours.
   * Returns per-pixel paper colour as three planes.
   */
  function paperPlanes(img: PixelImage): Paper | null {
    const w = img.w, h = img.h, d = img.data;
    const B = Math.max(10, Math.round(Math.max(w, h) / 44));
    const gw = Math.ceil(w / B), gh = Math.ceil(h / B), gn = gw * gh;
    const bgY = new Float32Array(gn), bR = new Float32Array(gn), bG = new Float32Array(gn), bB = new Float32Array(gn);
    const hist = new Uint32Array(256);
    const step = B >= 24 ? 2 : 1;
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      const x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
      let cnt = 0;
      for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
        const i = (y * w + x) * 4;
        hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++; cnt++;
      }
      let c = 0, p90 = 255;
      for (let v = 255; v >= 0; v--) { c += hist[v]; if (c >= cnt * 0.1) { p90 = v; break; } }
      let sr = 0, sg = 0, sb = 0, m = 0;
      for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
        const i = (y * w + x) * 4;
        const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (v >= p90 - 3) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; m++; }
      }
      const k = by * gw + bx;
      bgY[k] = p90;
      bR[k] = m ? sr / m : p90; bG[k] = m ? sg / m : p90; bB[k] = m ? sb / m : p90;
    }
    // blocks much darker than their surroundings, or more colourful (a tinted table header, a stamp),
    // are content, not paper
    const ok = new Uint8Array(gn);
    const tmp: number[] = [], tc: number[] = [];
    const bC = new Float32Array(gn);
    for (let k = 0; k < gn; k++) bC[k] = Math.max(bR[k], bG[k], bB[k]) - Math.min(bR[k], bG[k], bB[k]);
    let good = 0;
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      tmp.length = 0; tc.length = 0;
      for (let yy = Math.max(0, by - 3); yy <= Math.min(gh - 1, by + 3); yy++)
        for (let xx = Math.max(0, bx - 3); xx <= Math.min(gw - 1, bx + 3); xx++) { tmp.push(bgY[yy * gw + xx]); tc.push(bC[yy * gw + xx]); }
      tmp.sort((a, b) => a - b); tc.sort((a, b) => a - b);
      const med = tmp[(tmp.length * 0.6) | 0], medC = tc[(tc.length * 0.5) | 0];
      const k = by * gw + bx;
      if (bgY[k] >= med * 0.8 && bgY[k] > 40 && bC[k] <= medC + 8) { ok[k] = 1; good++; }
    }
    if (good < gn * 0.25) return null;
    // fill the gaps from valid neighbours
    for (let pass = 0; pass < gw + gh; pass++) {
      let changed = 0;
      const nxt = ok.slice();
      for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
        const k = by * gw + bx;
        if (ok[k]) continue;
        let sr = 0, sg = 0, sb = 0, sy = 0, m = 0;
        for (let yy = Math.max(0, by - 1); yy <= Math.min(gh - 1, by + 1); yy++)
          for (let xx = Math.max(0, bx - 1); xx <= Math.min(gw - 1, bx + 1); xx++) {
            const j = yy * gw + xx;
            if (ok[j]) { sr += bR[j]; sg += bG[j]; sb += bB[j]; sy += bgY[j]; m++; }
          }
        if (m) { bR[k] = sr / m; bG[k] = sg / m; bB[k] = sb / m; bgY[k] = sy / m; nxt[k] = 1; changed++; }
      }
      ok.set(nxt);
      if (!changed) break;
    }
    // smooth the block grid
    const sm = (a: Float32Array) => {
      let cur = a;
      for (let it = 0; it < 2; it++) {
        const o = new Float32Array(gn);
        for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
          let s = 0, m = 0;
          for (let yy = Math.max(0, by - 1); yy <= Math.min(gh - 1, by + 1); yy++)
            for (let xx = Math.max(0, bx - 1); xx <= Math.min(gw - 1, bx + 1); xx++) { s += cur[yy * gw + xx]; m++; }
          o[by * gw + bx] = s / m;
        }
        cur = o;
      }
      return cur;
    };
    const R = sm(bR), G = sm(bG), Bp = sm(bB);
    return { gw, gh, B, R, G, Bl: Bp };
  }

  interface Paper { gw: number; gh: number; B: number; R: Float32Array; G: Float32Array; Bl: Float32Array }

  /** 1 / paper colour along one row (bilinear between block centres) */
  function paperRow(P: Paper, y: number, w: number, ir: Float32Array, ig: Float32Array, ib: Float32Array, xi: Int32Array, xt: Float32Array): void {
    const { gw, gh, B } = P;
    let fy = (y + 0.5) / B - 0.5; if (fy < 0) fy = 0; if (fy > gh - 1) fy = gh - 1;
    const y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const x0 = xi[x], x1 = x0 + 1 < gw ? x0 + 1 : x0, tx = xt[x];
      const k00 = y0 * gw + x0, k01 = y0 * gw + x1, k10 = y1 * gw + x0, k11 = y1 * gw + x1;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const r = P.R[k00] * w00 + P.R[k01] * w01 + P.R[k10] * w10 + P.R[k11] * w11;
      const g = P.G[k00] * w00 + P.G[k01] * w01 + P.G[k10] * w10 + P.G[k11] * w11;
      const b = P.Bl[k00] * w00 + P.Bl[k01] * w01 + P.Bl[k10] * w10 + P.Bl[k11] * w11;
      ir[x] = 1 / (r > 30 ? r : 30); ig[x] = 1 / (g > 30 ? g : 30); ib[x] = 1 / (b > 30 ? b : 30);
    }
  }

  /**
   * running max (or min) over 2r+1 samples along rows or columns, any radius in constant time per pixel
   * (van Herk / Gil-Werman)
   */
  function runMax(a: Float32Array, w: number, h: number, r: number, max: boolean, vertical: boolean): Float32Array {
    if (vertical) return runMaxV(a, w, h, r, max);
    const n = vertical ? h : w, lines = vertical ? w : h, step = vertical ? w : 1, k = 2 * r + 1, N = n + 2 * r;
    const o = new Float32Array(a.length), src = new Float32Array(N), g = new Float32Array(N), hh = new Float32Array(N);
    const pad = max ? -1e9 : 1e9;
    for (let l = 0; l < lines; l++) {
      const base = vertical ? l : l * w;
      for (let i = 0; i < r; i++) { src[i] = pad; src[N - 1 - i] = pad; }
      for (let i = 0, j = base; i < n; i++, j += step) src[i + r] = a[j];
      for (let b = 0; b < N; b += k) {
        const e = b + k < N ? b + k : N;
        let v = src[b]; g[b] = v;
        if (max) { for (let i = b + 1; i < e; i++) { const u = src[i]; if (u > v) v = u; g[i] = v; } v = src[e - 1]; hh[e - 1] = v; for (let i = e - 2; i >= b; i--) { const u = src[i]; if (u > v) v = u; hh[i] = v; } }
        else { for (let i = b + 1; i < e; i++) { const u = src[i]; if (u < v) v = u; g[i] = v; } v = src[e - 1]; hh[e - 1] = v; for (let i = e - 2; i >= b; i--) { const u = src[i]; if (u < v) v = u; hh[i] = v; } }
      }
      const r2 = 2 * r;
      if (max) for (let i = 0, j = base; i < n; i++, j += step) { const x = hh[i], y = g[i + r2]; o[j] = x > y ? x : y; }
      else for (let i = 0, j = base; i < n; i++, j += step) { const x = hh[i], y = g[i + r2]; o[j] = x < y ? x : y; }
    }
    return o;
  }
  /** runMax down the columns, row by row (memory is read in order, not strided) */
  function runMaxV(a: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
    const k = 2 * r + 1, N = h + 2 * r, pad = max ? -1e9 : 1e9;
    // padded rows: index i ↔ source row i - r
    const row = (i: number) => i - r;
    const g = new Float32Array(N * w), hh = new Float32Array(N * w), o = new Float32Array(a.length);
    const put = (dst: Float32Array, i: number) => {
      const y = row(i), b = i * w;
      if (y < 0 || y >= h) dst.fill(pad, b, b + w); else dst.set(a.subarray(y * w, y * w + w), b);
    };
    for (let b0 = 0; b0 < N; b0 += k) {
      const e = Math.min(N, b0 + k);
      put(g, b0);
      for (let i = b0 + 1; i < e; i++) {
        put(g, i);
        const c = i * w, p = c - w;
        if (max) for (let x = 0; x < w; x++) { if (g[p + x] > g[c + x]) g[c + x] = g[p + x]; }
        else for (let x = 0; x < w; x++) { if (g[p + x] < g[c + x]) g[c + x] = g[p + x]; }
      }
      put(hh, e - 1);
      for (let i = e - 2; i >= b0; i--) {
        put(hh, i);
        const c = i * w, p = c + w;
        if (max) for (let x = 0; x < w; x++) { if (hh[p + x] > hh[c + x]) hh[c + x] = hh[p + x]; }
        else for (let x = 0; x < w; x++) { if (hh[p + x] < hh[c + x]) hh[c + x] = hh[p + x]; }
      }
    }
    const r2 = 2 * r;
    for (let y = 0; y < h; y++) {
      const ob = y * w, hb = y * w, gb = (y + r2) * w;
      if (max) for (let x = 0; x < w; x++) { const u = hh[hb + x], v = g[gb + x]; o[ob + x] = u > v ? u : v; }
      else for (let x = 0; x < w; x++) { const u = hh[hb + x], v = g[gb + x]; o[ob + x] = u < v ? u : v; }
    }
    return o;
  }
  /** grey closing with a square of side 2r+1: removes dark marks narrower than that, keeps the edges of larger shapes in place */
  function closing(a: Float32Array, w: number, h: number, r: number): Float32Array {
    const d = runMax(runMax(a, w, h, r, true, false), w, h, r, true, true);
    return runMax(runMax(d, w, h, r, false, false), w, h, r, false, true);
  }

  /** marks (M = 1) the regions below `level` whose outline is a sharp step nearly all the way round */
  function sharpAreas(R: Float32Array, w: number, h: number, r: number, level: number, M: Float32Array): void {
    const n = w * h, lab = new Int32Array(n).fill(-1);
    const stack: number[] = [], comp: number[] = [];
    const minArea = (2 * r + 1) * (2 * r + 1);
    for (let s = 0; s < n; s++) {
      if (lab[s] !== -1 || R[s] >= level) continue;
      comp.length = 0; stack.length = 0;
      lab[s] = s; stack.push(s);
      let lo = 9;
      while (stack.length) {
        const j = stack.pop()!; comp.push(j);
        if (R[j] < lo) lo = R[j];
        const x = j % w;
        if (x > 0 && lab[j - 1] === -1 && R[j - 1] < level) { lab[j - 1] = s; stack.push(j - 1); }
        if (x < w - 1 && lab[j + 1] === -1 && R[j + 1] < level) { lab[j + 1] = s; stack.push(j + 1); }
        if (j >= w && lab[j - w] === -1 && R[j - w] < level) { lab[j - w] = s; stack.push(j - w); }
        if (j < n - w && lab[j + w] === -1 && R[j + w] < level) { lab[j + w] = s; stack.push(j + w); }
      }
      if (comp.length < minArea) continue;
      const depth = 1 - lo;
      if (depth < 0.12) continue;
      // along the outline: does brightness rise by most of the depth within two pixels outwards?
      let edge = 0, sharp = 0;
      for (const j of comp) {
        const x = j % w, y = (j / w) | 0;
        for (let k = 0; k < 4; k++) {
          const dx = k === 0 ? -1 : k === 1 ? 1 : 0, dy = k === 2 ? -1 : k === 3 ? 1 : 0;
          const x1 = x + dx, y1 = y + dy;
          if (x1 < 0 || y1 < 0 || x1 >= w || y1 >= h) continue;
          if (R[y1 * w + x1] < level) continue;
          edge++;
          const x3 = Math.min(w - 1, Math.max(0, x + 3 * dx)), y3 = Math.min(h - 1, Math.max(0, y + 3 * dy));
          const xb = Math.min(w - 1, Math.max(0, x - dx)), yb = Math.min(h - 1, Math.max(0, y - dy));
          if (R[y3 * w + x3] - R[yb * w + xb] >= 0.4 * Math.min(depth, 1 - R[yb * w + xb] + 0.02)) sharp++;
          break;
        }
      }
      if (edge && sharp / edge >= 0.72) for (const j of comp) M[j] = 1;
    }
  }

  /**
   * Fine shading across the page, relative to the block-wise paper colour: creases, folds and the sharp
   * edge of a shadow are followed to the pixel (the paper blocks only see light that changes slowly).
   * Text is removed by a closing; what is left darker than half the paper (logos, photos, QR codes) or
   * coloured (tinted table headers, stamps) is content and keeps the block-wise paper.
   */
  function fineShade(img: PixelImage, P: Paper | null): Float32Array {
    const W = img.w, H = img.h;
    // half size on big pages: the shading needs no more detail, and it is 4× cheaper
    const f = W * H > 4.2e6 ? 2 : 1;
    const w = Math.max(8, Math.round(W / f)), h = Math.max(8, Math.round(H / f)), n = w * h;
    const r = Math.max(3, Math.min(12, Math.round(Math.sqrt(W * H) / 220 / f)));
    const d = img.data;
    const Yf = lumaPlane(img), Chf = new Float32Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) Chf[p] = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    const Y = f > 1 ? shrinkPlane(Yf, W, H, w, h) : Yf, Ch = f > 1 ? shrinkPlane(Chf, W, H, w, h) : Chf;
    const C = closing(Y, w, h, r);
    // paper brightness and colourfulness from the blocks (block grid scaled to this size)
    const PY = new Float32Array(n), PC = new Float32Array(n);
    const ir = new Float32Array(w), ig = new Float32Array(w), ib = new Float32Array(w), xi = new Int32Array(w), xt = new Float32Array(w);
    const Pf = P ? { ...P, B: P.B / f } : null;
    if (Pf) for (let x = 0; x < w; x++) { let fx = (x + 0.5) / Pf.B - 0.5; if (fx < 0) fx = 0; if (fx > Pf.gw - 1) fx = Pf.gw - 1; xi[x] = fx | 0; xt[x] = fx - (fx | 0); }
    for (let y = 0; y < h; y++) {
      if (Pf) paperRow(Pf, y, w, ir, ig, ib, xi, xt); else { ir.fill(1 / 255); ig.fill(1 / 255); ib.fill(1 / 255); }
      for (let x = 0; x < w; x++) {
        const R = 1 / ir[x], G = 1 / ig[x], B = 1 / ib[x];
        PY[y * w + x] = 0.299 * R + 0.587 * G + 0.114 * B;
        PC[y * w + x] = Math.max(R, G, B) - Math.min(R, G, B);
      }
    }
    // colourfulness of the page itself, smoothed over about a letter
    const ChB = boxSmooth(Ch, w, h, r * 0.6);
    const S = new Float32Array(n), M = new Float32Array(n), Rt = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const ratio = C[p] / Math.max(20, PY[p]);
      Rt[p] = ratio;
      M[p] = ratio < 0.25 || ChB[p] - PC[p] > 9 ? 1 : 0;
      S[p] = ratio < 0.3 ? 0.3 : ratio > 1.12 ? 1.12 : ratio;
    }
    // Dark areas left after the closing are either printed (a logo, a photo, a QR code, a grey box) or
    // shading (the dark side of a crease, a shadow). Printed areas end in a sharp step all around;
    // shading fades out on at least one side. Checked at two depths, so a pale logo inside a shadow
    // still stands out.
    sharpAreas(Rt, w, h, r, 0.88, M);
    sharpAreas(Rt, w, h, r, 0.72, M);
    // The closing also takes away narrow dark bands that are not print: the valley of a fold, the
    // dark line of a crease. A smaller closing removes only the strokes of text; what it keeps on top
    // of the large one is a band — printed (a thick rule, a QR module: sharp all round) or shading
    // (soft on at least one side), which then joins the shading.
    const r2 = Math.max(2, Math.round(r / 3));
    if (r2 < r) {
      const C2 = closing(Y, w, h, r2), R2 = new Float32Array(n), P2 = new Float32Array(n);
      for (let p = 0; p < n; p++) R2[p] = C2[p] / Math.max(1, C[p]);
      sharpAreas(R2, w, h, r2, 0.93, P2);
      for (let p = 0; p < n; p++) if (R2[p] < 0.97 && !P2[p]) {
        const ratio = C2[p] / Math.max(20, PY[p]);
        S[p] = ratio < 0.3 ? 0.3 : ratio > 1.12 ? 1.12 : ratio;
      }
    }
    // content and a margin around it keep the block-wise paper (factor 1)
    const Md = runMax(runMax(M, w, h, r, true, false), w, h, r, true, true);
    const Mb = boxSmooth(Md, w, h, Math.max(1, r * 0.4));
    for (let p = 0; p < n; p++) S[p] = S[p] * (1 - Mb[p]) + Mb[p];
    const Sb = blurPlane(S, w, h, 0.8 / f + 0.3);
    return f > 1 ? resizePlane(Sb, w, h, W, H) : Sb;
  }

  function percentile(hist: Uint32Array, total: number, q: number): number {
    let c = 0;
    for (let v = 0; v < hist.length; v++) { c += hist[v]; if (c >= total * q) return v; }
    return hist.length - 1;
  }

  /**
   * documents: the paper's own colour and shadows divided out. Magic (auto): white paper, black text,
   * livelier colours. Enhance: cleaner and crisper but closer to the photo. Lighten: just even, bright light.
   */
  function docFilter(img: PixelImage, mode: 'auto' | 'gray' | 'bw' | 'lighten' | 'enhance'): void {
    const w = img.w, h = img.h, d = img.data, n = w * h;
    const P = paperPlanes(img);
    // 1 / fine shading per pixel (creases, folds, hard shadow edges)
    const FS = fineShade(img, P);
    for (let p = 0; p < n; p++) FS[p] = 1 / FS[p];
    const ir = new Float32Array(w).fill(1 / 255), ig = new Float32Array(w).fill(1 / 255), ib = new Float32Array(w).fill(1 / 255);
    const xi = new Int32Array(w), xt = new Float32Array(w);
    if (P) for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) / P.B - 0.5; if (fx < 0) fx = 0; if (fx > P.gw - 1) fx = P.gw - 1;
      xi[x] = fx | 0; xt[x] = fx - (fx | 0);
    }
    // brightness distribution relative to the paper (every 3rd row is plenty); for black & white
    // also per block, to find how dark the ink is locally
    const hist = new Uint32Array(1024);
    let hn = 0;
    const KB = Math.max(16, Math.round(Math.max(w, h) / 40)), kw = Math.ceil(w / KB), kh = Math.ceil(h / KB);
    const bh = mode === 'bw' ? new Uint32Array(kw * kh * 64) : null;
    for (let y = 0; y < h; y += 3) {
      if (P) paperRow(P, y, w, ir, ig, ib, xi, xt);
      const brow = ((y / KB) | 0) * kw;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const v = (0.299 * d[i] * ir[x] + 0.587 * d[i + 1] * ig[x] + 0.114 * d[i + 2] * ib[x]) * FS[y * w + x];
        hist[v >= 1.279 ? 1023 : (v * 800) | 0]++; hn++;
        if (bh) bh[(brow + ((x / KB) | 0)) * 64 + (v >= 1.24 ? 63 : (v * 51) | 0)]++;
      }
    }
    // tone curve as a table over normalised values 0…1.25
    const LN = 4096, LS = (LN - 1) / 1.25;
    const lut = new Float32Array(LN);
    // black point from the darkest ink, white a little below the paper (so shadows and grain vanish)
    const ink = percentile(hist, hn, 0.004) / 800;
    const black = mode === 'lighten' ? 0 : mode === 'enhance' ? Math.min(0.3, ink * 0.75) : Math.min(0.42, ink);
    // white just below where the paper's own brightness tails off (after the shading is divided out the
    // paper is a narrow peak near 1): pale rules, light tints and faint print stay, grain goes
    let peak = 640, pv = 0;
    for (let b = 640; b < 960; b++) if (hist[b] > pv) { pv = hist[b]; peak = b; }
    let lo = peak;
    while (lo > 560 && hist[lo] > pv * 0.12) lo--;
    const paperLo = lo / 800;
    const white = mode === 'lighten' ? 0.97 : mode === 'enhance' ? Math.min(0.95, Math.max(0.9, paperLo + 0.02)) : Math.min(0.93, Math.max(0.86, paperLo - 0.005));
    const gamma = mode === 'lighten' ? 0.92 : mode === 'enhance' ? 1.06 : 1.12;
    const sat = mode === 'lighten' ? 1.05 : mode === 'enhance' ? 1.18 : 1.3;
    for (let k = 0; k < LN; k++) {
      let t = (k / LS - black) / (white - black); t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (mode === 'bw') {
        // halfway between ink and paper keeps strokes their true width, even when blurred
        let v = (t - 0.47) / 0.16; v = v < 0 ? 0 : v > 1 ? 1 : v;
        lut[k] = v * v * (3 - 2 * v) * 255;
      } else lut[k] = Math.pow(t, gamma) * 255;
    }
    const L = (v: number) => lut[v <= 0 ? 0 : v >= 1.25 ? LN - 1 : (v * LS) | 0];
    if (bh) {
      // Black & white: each place is cut halfway between its own ink and the paper, so faint or
      // blurred text keeps its strokes and bold text doesn't swell.
      const ink = new Float32Array(kw * kh);
      for (let k = 0; k < kw * kh; k++) {
        let tot = 0; for (let b = 0; b < 64; b++) tot += bh[k * 64 + b];
        let c = 0, v = 63;
        for (let b = 0; b < 64; b++) { c += bh[k * 64 + b]; if (c >= tot * 0.04) { v = b; break; } }
        ink[k] = tot ? (v + 0.5) / 51 : 1;
      }
      // spread ink levels a little into empty neighbours, then smooth
      const spread = new Float32Array(kw * kh), T = new Float32Array(kw * kh);
      for (let y = 0; y < kh; y++) for (let x = 0; x < kw; x++) {
        let m = ink[y * kw + x];
        for (let yy = Math.max(0, y - 1); yy <= Math.min(kh - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(kw - 1, x + 1); xx++) m = Math.min(m, ink[yy * kw + xx]);
        spread[y * kw + x] = m;
      }
      const gT = black + 0.5 * (0.95 - black);
      for (let y = 0; y < kh; y++) for (let x = 0; x < kw; x++) {
        let sm = 0, c = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(kh - 1, y + 1); yy++) for (let xx = Math.max(0, x - 1); xx <= Math.min(kw - 1, x + 1); xx++) { sm += spread[yy * kw + xx]; c++; }
        const k = sm / c;
        // no real ink here: fall back to the page-wide cut
        T[y * kw + x] = k < 0.8 ? Math.max(gT, k + 0.58 * (0.95 - k)) : Math.max(gT, 0.86);
      }
      const ti = new Int32Array(w), tt = new Float32Array(w);
      for (let x = 0; x < w; x++) { let fx = (x + 0.5) / KB - 0.5; if (fx < 0) fx = 0; if (fx > kw - 1) fx = kw - 1; ti[x] = fx | 0; tt[x] = fx - (fx | 0); }
      for (let y = 0; y < h; y++) {
        if (P) paperRow(P, y, w, ir, ig, ib, xi, xt);
        let fy = (y + 0.5) / KB - 0.5; if (fy < 0) fy = 0; if (fy > kh - 1) fy = kh - 1;
        const y0 = fy | 0, y1 = Math.min(kh - 1, y0 + 1), ty = fy - y0;
        for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
          const x0 = ti[x], x1 = x0 + 1 < kw ? x0 + 1 : x0, tx = tt[x];
          const thr = (T[y0 * kw + x0] * (1 - tx) + T[y0 * kw + x1] * tx) * (1 - ty) + (T[y1 * kw + x0] * (1 - tx) + T[y1 * kw + x1] * tx) * ty;
          const v = (0.299 * d[i] * ir[x] + 0.587 * d[i + 1] * ig[x] + 0.114 * d[i + 2] * ib[x]) * FS[y * w + x];
          let a = (v - thr) / 0.07 + 0.5; a = a < 0 ? 0 : a > 1 ? 1 : a;
          d[i] = d[i + 1] = d[i + 2] = a * a * (3 - 2 * a) * 255;
        }
      }
      return;
    }
    if (mode === 'gray') {
      for (let y = 0; y < h; y++) {
        if (P) paperRow(P, y, w, ir, ig, ib, xi, xt);
        for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
          const f = FS[y * w + x];
          d[i] = d[i + 1] = d[i + 2] = L((0.299 * d[i] * ir[x] + 0.587 * d[i + 1] * ig[x] + 0.114 * d[i + 2] * ib[x]) * f);
        }
      }
      return;
    }
    // Colour: the same curve on each channel. A phone camera adds pink and green speckles to dark print
    // (strongest in QR codes and barcodes); real coloured print has one colour across its strokes. So
    // the colour is averaged over the print nearby (at half size, weighted by how dark each pixel is):
    // the speckles cancel out, a blue logo or a red total keeps its colour, and black print stays black.
    const w2 = (w + 1) >> 1, h2 = (h + 1) >> 1, n2 = w2 * h2;
    const CR = new Float32Array(n2), CB = new Float32Array(n2), CA = new Float32Array(n2);
    for (let y = 0; y < h; y++) {
      if (P) paperRow(P, y, w, ir, ig, ib, xi, xt);
      const o2 = (y >> 1) * w2;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const f = FS[y * w + x], R = L(d[i] * ir[x] * f), G = L(d[i + 1] * ig[x] * f), B = L(d[i + 2] * ib[x] * f);
        const yy = 0.299 * R + 0.587 * G + 0.114 * B, a = 1 - yy / 255;
        // the look so far, kept in the pixels (chroma is put back below)
        d[i] = R; d[i + 1] = G; d[i + 2] = B;
        if (a <= 0.02) continue;
        const q = o2 + (x >> 1);
        CR[q] += a * (R - yy); CB[q] += a * (B - yy); CA[q] += a;
      }
    }
    const sg2 = Math.max(1, Math.max(w, h) / 1600);
    const SR = boxSmooth(CR, w2, h2, sg2), SB = boxSmooth(CB, w2, h2, sg2), SA = boxSmooth(CA, w2, h2, sg2);
    for (let q = 0; q < n2; q++) {
      const a = SA[q];
      if (a < 1e-4) { SR[q] = SB[q] = 0; continue; }
      let cr = SR[q] / a, cb = SB[q] / a;
      // faint average colour is what's left of the noise: grey
      const m = Math.hypot(cr, cb);
      let t = (m - 9) / 14; t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
      cr *= t * sat; cb *= t * sat;
      SR[q] = cr; SB[q] = cb; SA[q] = a / 4; // ink weight per full-size pixel
    }
    for (let y = 0; y < h; y++) {
      let fy = (y + 0.5) / 2 - 0.5; if (fy < 0) fy = 0; if (fy > h2 - 1) fy = h2 - 1;
      const y0 = fy | 0, y1 = y0 + 1 < h2 ? y0 + 1 : y0, ty = fy - y0;
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        let fx = (x + 0.5) / 2 - 0.5; if (fx < 0) fx = 0; if (fx > w2 - 1) fx = w2 - 1;
        const x0 = fx | 0, x1 = x0 + 1 < w2 ? x0 + 1 : x0, tx = fx - x0;
        const q00 = y0 * w2 + x0, q01 = y0 * w2 + x1, q10 = y1 * w2 + x0, q11 = y1 * w2 + x1;
        const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
        let cr = SR[q00] * w00 + SR[q01] * w01 + SR[q10] * w10 + SR[q11] * w11;
        let cb = SB[q00] * w00 + SB[q01] * w01 + SB[q10] * w10 + SB[q11] * w11;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const yy = 0.299 * R + 0.587 * G + 0.114 * B;
        // as much colour as this pixel has ink compared with its surroundings (no halo on the paper)
        const al = SA[q00] * w00 + SA[q01] * w01 + SA[q10] * w10 + SA[q11] * w11, a = 1 - yy / 255;
        const k = al > 1e-4 ? Math.min(1, a / al) : 0;
        cr *= k; cb *= k;
        d[i] = yy + cr; d[i + 2] = yy + cb; d[i + 1] = yy - (0.299 * cr + 0.114 * cb) / 0.587;
      }
    }
    void n;
  }

  /** photos, cards and passports: natural colours, balanced levels, no paper flattening */
  function colorFilter(img: PixelImage): void {
    const d = img.data, n = img.w * img.h;
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (let i = 0; i < n * 4; i += 4) { hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++; }
    const lv = (hh: Uint32Array) => {
      const lo = percentile(hh, n, 0.004), hi = percentile(hh, n, 0.996);
      // limit the stretch so pale cards don't turn garish
      const span = Math.max(hi - lo, 255 / 1.5);
      return [lo, span];
    };
    const R = lv(hr), G = lv(hg), B = lv(hb);
    // keep the white point shared a little, so tinted cards keep their tint
    const span = (R[1] + G[1] + B[1]) / 3;
    const mix = (s: number) => 0.6 * s + 0.4 * span;
    const r1 = mix(R[1]), g1 = mix(G[1]), b1 = mix(B[1]);
    for (let i = 0; i < n * 4; i += 4) {
      let r = (d[i] - R[0]) / r1, g = (d[i + 1] - G[0]) / g1, b = (d[i + 2] - B[0]) / b1;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = y + (r - y) * 1.12; g = y + (g - y) * 1.12; b = y + (b - y) * 1.12;
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255;
    }
  }

  function roundCorners(img: PixelImage, r: number): void {
    if (r < 1) return;
    const w = img.w, h = img.h, d = img.data;
    const corners = [[r, r], [w - r, r], [w - r, h - r], [r, h - r]];
    for (let c = 0; c < 4; c++) {
      const cx = corners[c][0], cy = corners[c][1];
      const xs = c === 0 || c === 3 ? 0 : Math.floor(w - r), ys = c < 2 ? 0 : Math.floor(h - r);
      for (let y = ys; y < Math.min(h, ys + Math.ceil(r) + 1); y++) for (let x = xs; x < Math.min(w, xs + Math.ceil(r) + 1); x++) {
        const dx = (c === 0 || c === 3) ? cx - (x + 0.5) : (x + 0.5) - cx;
        const dy = c < 2 ? cy - (y + 0.5) : (y + 0.5) - cy;
        if (dx <= 0 || dy <= 0) continue;
        const dd = Math.sqrt(dx * dx + dy * dy) - r; // > 0 outside the arc
        if (dd <= -0.5) continue;
        const a = dd >= 0.5 ? 1 : dd + 0.5; // anti-aliased edge
        const i = (y * w + x) * 4;
        d[i] = d[i] + (255 - d[i]) * a; d[i + 1] = d[i + 1] + (255 - d[i + 1]) * a; d[i + 2] = d[i + 2] + (255 - d[i + 2]) * a;
      }
    }
  }

  /** measured on the middle of the page (at most ~1.5 MP: plenty of edges, a fraction of the time) */
  function estimateBlur(img: PixelImage): number {
    const w = img.w, h = img.h;
    const cw = Math.min(w, 1400), ch = Math.min(h, 1100), x0 = (w - cw) >> 1, y0 = (h - ch) >> 1;
    const Y = new Float32Array(cw * ch), d = img.data;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = ((y + y0) * w + x + x0) * 4;
      Y[y * cw + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
    return estimateBlurY(Y, cw, ch);
  }

  /** local contrast: a wide unsharp mask on the brightness (makes faint print and colours stand out) */
  function clarity(img: PixelImage, amount: number): void {
    const w = img.w, h = img.h, d = img.data;
    // on a quarter-size copy: wide blur is cheap there
    const k = 4, W = Math.max(4, Math.round(w / k)), H = Math.max(4, Math.round(h / k));
    const Y = lumaPlane(img), small = shrinkPlane(Y, w, h, W, H);
    const B = resizePlane(blurPlane(small, W, H, Math.max(2, Math.max(W, H) / 90)), W, H, w, h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      const v = (Y[p] - B[p]) * amount;
      d[i] = d[i] + v; d[i + 1] = d[i + 1] + v; d[i + 2] = d[i + 2] + v;
    }
  }

  /** quarter turns clockwise */
  function turn(img: PixelImage, rot: number): PixelImage {
    const r = ((rot % 4) + 4) % 4;
    if (!r) return img;
    const w = img.w, h = img.h, s = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
    const W = r % 2 ? h : w, H = r % 2 ? w : h;
    const out = new Uint8ClampedArray(W * H * 4), o = new Uint32Array(out.buffer);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = r === 1 ? h - 1 - y : r === 2 ? w - 1 - x : y;
      const Y = r === 1 ? x : r === 2 ? h - 1 - y : w - 1 - x;
      o[Y * W + X] = s[y * w + x];
    }
    return { w: W, h: H, data: out };
  }

  /** box-averaged copy whose longest side is at most `max` */
  function shrink(img: PixelImage, max: number): PixelImage {
    const k = Math.max(img.w, img.h) / max;
    if (k <= 1) return { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
    const W = Math.max(1, Math.round(img.w / k)), H = Math.max(1, Math.round(img.h / k));
    const out = new Uint8ClampedArray(W * H * 4), d = img.data, w = img.w;
    for (let Y = 0; Y < H; Y++) {
      const y0 = Math.floor(Y * k), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((Y + 1) * k)));
      for (let X = 0; X < W; X++) {
        const x0 = Math.floor(X * k), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((X + 1) * k)));
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        const o = (Y * W + X) * 4;
        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
      }
    }
    return { w: W, h: H, data: out };
  }

  function prepare(job: Omit<Job, 'filter' | 'radius'>): Prepared {
    const T: Record<string, number> = {};
    let t0 = Date.now();
    const lap = (k: string) => { const t = Date.now(); T[k] = t - t0; t0 = t; };
    // a hair inside the found outline, so no sliver of the desk shows along the edges
    // (a little more on curved sides: the traced curve is smooth, a real edge has small waves)
    const m = Math.max(1.5, (job.bend ? 0.006 : 0.0035) * Math.max(job.outW, job.outH));
    let warped = warp(job.src, job.quad, job.outW, job.outH, m, job.bend);
    lap('warp');
    if (job.flatten) {
      // text lines run along the rows, or down the columns on a page that will be turned a quarter
      const cols = job.flatten === 'cols';
      const g = lineField(cols ? transpose(warped) : warped);
      lap('lines');
      if (g) {
        g.cols = cols;
        warped = warp(job.src, job.quad, job.outW, job.outH, m, job.bend, g);
        lap('flatten');
      }
    }
    let blur = 0, sharp: PixelImage | null = null;
    if (job.sharpen === 'auto') {
      blur = estimateBlur(warped);
      lap('estimate');
      if (blur > 1.1) { sharp = { w: warped.w, h: warped.h, data: new Uint8ClampedArray(warped.data) }; deblur(sharp, Math.min(5, blur)); lap('deblur'); }
    }
    return { warped, sharp, blur, times: T };
  }

  function finish(img: PixelImage, filter: Filter, blur: number, radius: number, rot: number): PixelImage {
    if (filter !== 'original') {
      if (filter === 'color') colorFilter(img);
      else docFilter(img, filter);
      if (filter === 'enhance') clarity(img, 0.28);
      if (filter !== 'bw') unsharp(img, 1.0, blur > 1.1 ? 0.35 : filter === 'lighten' ? 0.4 : 0.6);
    }
    const out = turn(img, rot);
    roundCorners(out, radius);
    return out;
  }

  function process(job: Job): JobResult {
    const p = prepare({ ...job, sharpen: job.filter === 'original' ? 'off' : job.sharpen });
    const t = Date.now();
    const img = finish(p.sharp ?? p.warped, job.filter, p.blur, job.radius, 0);
    return { img, blur: p.blur, times: { ...p.times, look: Date.now() - t } };
  }

  return { process, prepare, finish, shrink, estimateBlur };
}
