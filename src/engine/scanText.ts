// Draws replacement text for scans / picture pages as an image that looks like the scan:
// matched font family and weight, the scan's letter widths, ink colour and a little softness.
import type { ScanStyle } from './types';

export interface ScanTextImage {
  png: Uint8Array;
  /** image size and where its corner sits relative to the baseline start, in points */
  w: number; h: number; left: number; below: number;
}

const PX_PER_PT = 4; // ≈ 290 dpi

export async function renderScanText(lines: string[], s: ScanStyle, fontPt: number, ink: string): Promise<ScanTextImage | null> {
  if (typeof document === 'undefined') return null;
  const px = fontPt * PX_PER_PT;
  if (!(px > 0)) return null;
  const font = `${s.bold ? 700 : 400} ${px}px "PE ${s.family}"`;
  try { await document.fonts?.load(font, lines.join('')); } catch { /* use what's there */ }
  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = font;
  const widths = lines.map((l) => meas.measureText(l).width * s.stretch);
  const blurPx = s.blur * px;
  const padX = Math.ceil(px * 0.12 + blurPx * 3), padY = Math.ceil(px * 0.1 + blurPx * 3);
  const asc = px * 1.0, desc = px * 0.32, lead = px * 1.2;
  const W = Math.ceil(Math.max(1, ...widths) + 2 * padX);
  const H = Math.ceil(asc + desc + (lines.length - 1) * lead + 2 * padY);
  if (W * H > 40e6) return null;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    ctx.setTransform(s.stretch, 0, 0, 1, padX, padY + asc + i * lead);
    ctx.fillText(l, 0, 0);
  });
  let out = c;
  if (blurPx > 0.15) {
    const b = document.createElement('canvas');
    b.width = W; b.height = H;
    const bctx = b.getContext('2d')!;
    bctx.filter = `blur(${blurPx.toFixed(2)}px)`;
    bctx.drawImage(c, 0, 0);
    out = b;
  }
  const blob: Blob | null = await new Promise((res) => out.toBlob((x) => res(x), 'image/png'));
  if (!blob) return null;
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    w: W / PX_PER_PT, h: H / PX_PER_PT,
    left: padX / PX_PER_PT,
    below: (H - padY - asc) / PX_PER_PT, // from the first baseline down to the image's bottom edge
  };
}
