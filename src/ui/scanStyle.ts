// Finds the look of text printed in a scan / picture page (font family, weight, width, softness), so
// edited text can be drawn the same way instead of as crisp vector text in a standard font.
import type { ScanStyle } from '../engine/types';

export const SCAN_FAMILIES = ['Carlito', 'Arimo', 'Tinos', 'Roboto'] as const;
export const scanCss = (s: Pick<ScanStyle, 'family'>) => `"PE ${s.family}"`;

/** run key → style; filled when a line is first opened for editing */
export const scanStyles = new Map<string, ScanStyle>();

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const hexLum = (h: string) => { const v = parseInt(h.replace('#', ''), 16); return lum((v >> 16) & 255, (v >> 8) & 255, v & 255); };

/**
 * @param canvas the rendered page
 * @param box    the line in canvas pixels: left of the baseline, baseline y, width, font size (px)
 */
export async function matchScanStyle(canvas: HTMLCanvasElement, box: { x: number; y: number; w: number; size: number }, text: string,
  colors: { bg: string; fg: string }): Promise<ScanStyle | null> {
  const str = text.trim();
  if (!str || box.size < 4 || box.w < 4) return null;
  const pad = Math.ceil(box.size * 0.8);
  const x0 = Math.max(0, Math.floor(box.x - pad)), y0 = Math.max(0, Math.floor(box.y - box.size * 1.15));
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w + pad)), y1 = Math.min(canvas.height, Math.ceil(box.y + box.size * 0.35));
  const W = x1 - x0, H = y1 - y0;
  if (W < 4 || H < 4) return null;
  let src: Uint8ClampedArray;
  try { src = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, W, H).data; } catch { return null; }

  // ink mask of the original, and how soft its edges are
  const bgL = hexLum(colors.bg), fgL = hexLum(colors.fg);
  const span = Math.max(24, Math.abs(bgL - fgL));
  const dark = fgL < bgL;
  const ink = new Uint8Array(W * H);
  let inkN = 0, mid = 0, minX = W, maxX = -1, minY = H;
  for (let i = 0, p = 0; p < W * H; i += 4, p++) {
    const t = (dark ? bgL - lum(src[i], src[i + 1], src[i + 2]) : lum(src[i], src[i + 1], src[i + 2]) - bgL) / span; // 0 paper … 1 ink
    if (t > 0.5) {
      ink[p] = 1; inkN++;
      const x = p % W, y = (p / W) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y;
    }
    if (t > 0.2 && t < 0.8) mid++;
  }
  if (inkN < 8 || maxX <= minX) return null;
  // The crop reaches past the line on both sides: keep only ink that continues the line without a
  // word-sized gap (letters the hidden layer missed), not a neighbouring word.
  {
    const cols = new Array(W).fill(0);
    for (let p = 0; p < W * H; p++) if (ink[p]) cols[p % W]++;
    const gapMax = Math.max(2, Math.round(box.size * 0.3));
    const L = Math.max(0, Math.round(box.x - x0)), R = Math.min(W - 1, Math.round(box.x + box.w - x0));
    let r = R, gap = 0;
    for (let x = R; x < W; x++) { if (cols[x]) { r = x; gap = 0; } else if (++gap > gapMax) break; }
    let l = L; gap = 0;
    for (let x = L; x >= 0; x--) { if (cols[x]) { l = x; gap = 0; } else if (++gap > gapMax) break; }
    // drop ink outside [l, r]
    inkN = 0; minX = W; maxX = -1; minY = H;
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      if (x < l || x > r) { ink[p] = 0; continue; }
      if (ink[p]) { inkN++; if (x < minX) minX = x; if (x > maxX) maxX = x; const y = (p / W) | 0; if (y < minY) minY = y; }
    }
    if (inkN < 8 || maxX <= minX) return null;
  }
  // where the letters really sit (the hidden text layer of a scan is often a little off):
  // baseline = last row that is still well inked (descenders are thin), top = first inked row
  const rows = new Array(H).fill(0);
  for (let p = 0; p < W * H; p++) if (ink[p]) rows[(p / W) | 0]++;
  const maxRow = Math.max(...rows);
  let base = H, top = minY;
  for (let y = H - 1; y >= 0; y--) if (rows[y] >= maxRow * 0.22) { base = y + 1; break; }
  // walk up from the baseline while rows are inked (stops at the gap to the line above)
  const thr = Math.max(1, maxRow * 0.04);
  top = base - 1;
  while (top > 0 && (rows[top - 1] >= thr || (top > 1 && rows[top - 2] >= thr))) top--;
  const inkH = Math.max(2, base - top); // tallest letters above the baseline
  const inkW = maxX - minX + 1;
  const layerBase = box.y - y0;

  // softness: share of half-tone pixels around the letters → blur radius relative to the letter height
  const soft = mid / Math.max(1, inkN);
  const blurRel = Math.max(0, Math.min(0.06, (soft - 0.25) * 0.05));
  await Promise.all(SCAN_FAMILIES.flatMap((f) => [400, 700].map((w) => document.fonts?.load(`${w} 40px ${scanCss({ family: f })}`).catch(() => null))));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  // stroke density of the scan's letters: inked share of the box the letters span
  const density = inkN / Math.max(1, inkW * inkH);
  type Cand = { family: ScanStyle['family']; bold: boolean; fs: number; stretch: number; left: number; iou: number; density: number };
  const cands: Cand[] = [];
  for (const family of SCAN_FAMILIES) for (const bold of [false, true]) {
    const font = (px: number) => `${bold ? 700 : 400} ${px}px ${scanCss({ family })}`;
    ctx.font = font(100);
    const m = ctx.measureText(str);
    const asc = m.actualBoundingBoxAscent || 72;
    const fs = (100 * inkH) / asc; // font size whose tallest letters match the scan
    ctx.font = font(fs);
    const mm = ctx.measureText(str);
    const glyphW = (mm.actualBoundingBoxRight + mm.actualBoundingBoxLeft) || mm.width;
    const stretch = Math.max(0.6, Math.min(1.6, inkW / glyphW));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(stretch, 0, 0, 1, minX + mm.actualBoundingBoxLeft * stretch, base);
    ctx.fillStyle = '#000';
    // soften the candidate like the scan, so thin and bold strokes compare fairly after thresholding
    ctx.filter = blurRel * fs > 0.3 ? `blur(${(blurRel * fs).toFixed(2)}px)` : 'none';
    ctx.fillText(str, 0, 0);
    ctx.filter = 'none';
    const d = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let n = 0, cx0 = W, cx1 = -1, cy0 = H, cy1 = -1;
    for (let p = 0, i = 3; p < W * H; p++, i += 4) if (d[i] > 127) {
      mask[p] = 1; n++;
      const x = p % W, y = (p / W) | 0;
      if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y;
    }
    // overlap, allowing for a small misalignment between the scan and the hidden text
    const r = Math.max(1, Math.round(inkH * 0.08));
    let iou = 0;
    for (let sy = -r; sy <= r; sy++) for (let sx = -r; sx <= r; sx++) {
      let both = 0;
      for (let y = Math.max(0, -sy); y < H && y + sy < H; y++) {
        const row = y * W, rowS = (y + sy) * W;
        for (let x = Math.max(0, -sx); x < W && x + sx < W; x++) if (mask[row + x] && ink[rowS + x + sx]) both++;
      }
      const u = n + inkN - both;
      if (u && both / u > iou) iou = both / u;
    }
    const dens = n / Math.max(1, (cx1 - cx0 + 1) * Math.max(1, base - cy0));
    cands.push({ family, bold, fs, stretch, left: minX + mm.actualBoundingBoxLeft * stretch, iou, density: dens });
    if ((window as any).__scanDebug) console.log('scan match', family, bold ? 'bold' : 'regular', iou.toFixed(3), 'density', dens.toFixed(3), 'scan', density.toFixed(3));
  }
  // family: best overlap of either weight; weight: closest stroke density
  const byFamily = SCAN_FAMILIES.map((f) => cands.filter((c) => c.family === f));
  const fam = byFamily.sort((a, b) => Math.max(...b.map((c) => c.iou)) - Math.max(...a.map((c) => c.iou)))[0];
  const pick = [...fam].sort((a, b) => Math.abs(a.density - density) - Math.abs(b.density - density))[0];
  const best: ScanStyle | null = pick ? {
    family: pick.family, bold: pick.bold, sizeRatio: pick.fs / box.size, stretch: pick.stretch, blur: 0, score: pick.iou,
    dx: (pick.left - (box.x - x0)) / box.size, dy: (base - layerBase) / box.size,
    inkX0: (minX - (box.x - x0)) / box.size, inkX1: (maxX + 1 - (box.x - x0)) / box.size,
  } : null;
  if (!best) return null;
  best.blur = blurRel;
  return best;
}
