import type { M } from '../engine/types';
import type { TextRun } from '../engine/pdfText';

export const applyM = (m: M, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

/** Box of a text run in viewport coords (scale 1), anchored at its baseline. */
export function runBox(run: TextRun, vm: M) {
  const [x, y] = applyM(vm, run.region.o[0], run.region.o[1]);
  const ux = vm[0] * run.region.u[0] + vm[2] * run.region.u[1];
  const uy = vm[1] * run.region.u[0] + vm[3] * run.region.u[1];
  const angle = Math.atan2(uy, ux);
  const h = run.region.height;
  const asc = h * 0.86;
  return { x, y, angle, w: run.region.width, h, asc, top: y - asc, height: h * 1.16 };
}

/** Convert a client point to page-local coords (scale 1), undoing zoom + CSS rotation. */
export function toLocal(clientX: number, clientY: number, el: HTMLElement, w: number, h: number, zoom: number, rot: number) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const a = (-rot * Math.PI) / 180;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return { x: (lx + (w * zoom) / 2) / zoom, y: (ly + (h * zoom) / 2) / zoom };
}

/** Sample background + text colour of a region of a rendered canvas. */
export function sampleColors(ctx: CanvasRenderingContext2D, pts: [number, number][]): { bg: string; fg: string } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys)));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 1 || h <= 1) return { bg: '#ffffff', fg: '#000000' };
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(x0, y0, w, h).data; } catch { return { bg: '#ffffff', fg: '#000000' }; }
  const counts = new Map<number, [number, number, number, number]>();
  const px = (i: number) => (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const k = px(i) & 0xf0f0f0;
    const c = counts.get(k) ?? [0, 0, 0, 0];
    c[0]++; c[1] += data[i]; c[2] += data[i + 1]; c[3] += data[i + 2];
    counts.set(k, c);
  };
  // border pixels → background
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
  let bestC: [number, number, number, number] = [1, 255, 255, 255];
  for (const c of counts.values()) if (c[0] > bestC[0] || bestC[0] === 1) bestC = c;
  const br = Math.round(bestC[1] / bestC[0]), bgc = Math.round(bestC[2] / bestC[0]), bb = Math.round(bestC[3] / bestC[0]);
  let far = -1;
  let fg = 0;
  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgc) + Math.abs(data[i + 2] - bb);
    if (d > far) { far = d; fg = px(i); }
  }
  const hex = (v: number) => '#' + v.toString(16).padStart(6, '0');
  return { bg: hex((br << 16) | (bgc << 8) | bb), fg: far > 60 ? hex(fg) : '#000000' };
}
