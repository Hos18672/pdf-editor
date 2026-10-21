// Pixel work for the scanner: perspective crop, sharpening of blurry photos, and the page filters.
//
// Everything lives inside one self-contained function so the same code runs on the main thread and
// in the scanner's worker (src/ui/scan/worker.ts → public/scan/worker.js).

export type Filter = 'auto' | 'color' | 'gray' | 'bw' | 'original';
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
}
export interface JobResult { img: PixelImage; blur: number; times?: Record<string, number> }
export interface Kernels {
  process(job: Job): JobResult;
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

  /** output rectangle → quad in the source; bilinear sampling, white outside the photo */
  function warp(src: PixelImage, quad: number[], W: number, H: number, inset: number): PixelImage {
    const m = -inset;
    const Hm = solveH([m, m, W - m, m, W - m, H - m, m, H - m], quad);
    const out = new Uint8ClampedArray(W * H * 4);
    const sw = src.w, sh = src.h, sd = src.data;
    for (let y = 0; y < H; y++) {
      const yc = y + 0.5;
      for (let x = 0; x < W; x++) {
        const xc = x + 0.5;
        const z = Hm[6] * xc + Hm[7] * yc + Hm[8];
        let u = (Hm[0] * xc + Hm[1] * yc + Hm[2]) / z - 0.5, v = (Hm[3] * xc + Hm[4] * yc + Hm[5]) / z - 0.5;
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
    // blocks much darker than their surroundings are content, not paper
    const ok = new Uint8Array(gn);
    const tmp: number[] = [];
    let good = 0;
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
      tmp.length = 0;
      for (let yy = Math.max(0, by - 3); yy <= Math.min(gh - 1, by + 3); yy++)
        for (let xx = Math.max(0, bx - 3); xx <= Math.min(gw - 1, bx + 3); xx++) tmp.push(bgY[yy * gw + xx]);
      tmp.sort((a, b) => a - b);
      const med = tmp[(tmp.length * 0.6) | 0];
      const k = by * gw + bx;
      if (bgY[k] >= med * 0.8 && bgY[k] > 40) { ok[k] = 1; good++; }
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

  function percentile(hist: Uint32Array, total: number, q: number): number {
    let c = 0;
    for (let v = 0; v < hist.length; v++) { c += hist[v]; if (c >= total * q) return v; }
    return hist.length - 1;
  }

  /** documents: white paper, black text, colours kept and a little livelier */
  function docFilter(img: PixelImage, mode: 'auto' | 'gray' | 'bw'): void {
    const w = img.w, h = img.h, d = img.data, n = w * h;
    const P = paperPlanes(img);
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
        const v = 0.299 * d[i] * ir[x] + 0.587 * d[i + 1] * ig[x] + 0.114 * d[i + 2] * ib[x];
        hist[v >= 1.279 ? 1023 : (v * 800) | 0]++; hn++;
        if (bh) bh[(brow + ((x / KB) | 0)) * 64 + (v >= 1.24 ? 63 : (v * 51) | 0)]++;
      }
    }
    // tone curve as a table over normalised values 0…1.25
    const LN = 4096, LS = (LN - 1) / 1.25;
    const lut = new Float32Array(LN);
    // black point from the darkest ink, white a little below the paper (so shadows and grain vanish)
    const black = Math.min(0.42, percentile(hist, hn, 0.004) / 800);
    const white = 0.9;
    for (let k = 0; k < LN; k++) {
      let t = (k / LS - black) / (white - black); t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (mode === 'bw') {
        // halfway between ink and paper keeps strokes their true width, even when blurred
        let v = (t - 0.47) / 0.16; v = v < 0 ? 0 : v > 1 ? 1 : v;
        lut[k] = v * v * (3 - 2 * v) * 255;
      } else lut[k] = Math.pow(t, 1.12) * 255;
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
          const v = 0.299 * d[i] * ir[x] + 0.587 * d[i + 1] * ig[x] + 0.114 * d[i + 2] * ib[x];
          let a = (v - thr) / 0.07 + 0.5; a = a < 0 ? 0 : a > 1 ? 1 : a;
          d[i] = d[i + 1] = d[i + 2] = a * a * (3 - 2 * a) * 255;
        }
      }
      return;
    }
    for (let y = 0; y < h; y++) {
      if (P) paperRow(P, y, w, ir, ig, ib, xi, xt);
      for (let x = 0, i = y * w * 4; x < w; x++, i += 4) {
        const r = d[i] * ir[x], g = d[i + 1] * ig[x], b = d[i + 2] * ib[x];
        if (mode !== 'auto') { d[i] = d[i + 1] = d[i + 2] = L(0.299 * r + 0.587 * g + 0.114 * b); continue; }
        // colour: the same curve on each channel, then a touch more saturation
        const R = L(r), G = L(g), B = L(b);
        const yy = 0.299 * R + 0.587 * G + 0.114 * B;
        d[i] = yy + (R - yy) * 1.25; d[i + 1] = yy + (G - yy) * 1.25; d[i + 2] = yy + (B - yy) * 1.25;
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

  function process(job: Job): JobResult {
    const T: Record<string, number> = {};
    let t0 = Date.now();
    const lap = (k: string) => { const t = Date.now(); T[k] = t - t0; t0 = t; };
    // a hair inside the found outline, so no sliver of the desk shows along the edges
    const m = Math.max(1.5, 0.0035 * Math.max(job.outW, job.outH));
    const img = warp(job.src, job.quad, job.outW, job.outH, m);
    lap('warp');
    let blur = 0;
    if (job.filter !== 'original') {
      if (job.sharpen === 'auto') {
        blur = estimateBlur(img);
        lap('estimate');
        if (blur > 1.1) { deblur(img, Math.min(5, blur)); lap('deblur'); }
      }
      if (job.filter === 'color') colorFilter(img);
      else docFilter(img, job.filter);
      lap('filter');
      if (job.filter !== 'bw') { unsharp(img, 1.0, blur > 1.1 ? 0.35 : 0.6); lap('unsharp'); }
    }
    roundCorners(img, job.radius);
    return { img, blur, times: T };
  }

  return { process, estimateBlur };
}
