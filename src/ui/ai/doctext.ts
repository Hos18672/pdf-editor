// What the AI gets to read: the document's lines in reading order with page markers, and pictures of
// pages that have no text yet (scans not read).
import type { TextRun } from '../../engine/pdfText';
import type { M } from '../../engine/types';
import { runBox } from '../geometry';
import { readingOrder } from '../bidiWords';

export interface Line { page: number; text: string; x: number; y: number; w: number; h: number; keys: string[] }

/** lines of a page (viewport units, scale 1) in reading order: runs on the same baseline joined */
export function pageLines(page: number, runs: TextRun[], vm: M, textOf: (r: TextRun) => string): Line[] {
  const items = runs.map((r) => ({ r, b: runBox(r, vm), s: textOf(r) })).filter((i) => i.s.trim() && Math.abs(i.b.angle) < 0.3);
  items.sort((a, b) => a.b.y - b.b.y || a.b.x - b.b.x);
  const lines: { items: typeof items; y: number; h: number }[] = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.y - it.b.y) < Math.max(l.h, it.b.h) * 0.45);
    if (ln) ln.items.push(it); else lines.push({ items: [it], y: it.b.y, h: it.b.h });
  }
  return lines.map((l) => {
    l.items.sort((a, b) => a.b.x - b.b.x);
    // pieces far apart are separate cells (columns); each cell in reading order (Persian right to left)
    const cells: (typeof l.items)[] = [];
    let end = -Infinity;
    for (const it of l.items) {
      if (!cells.length || it.b.x - end > it.b.h * 1.5) cells.push([it]); else cells[cells.length - 1].push(it);
      end = Math.max(end, it.b.x + it.b.w);
    }
    const text = cells.map((c) => readingOrder(c.map((it) => ({ text: it.s.trim(), it }))).map((w) => w.text).join(' ')).join('   ');
    const x = Math.min(...l.items.map((i) => i.b.x)), top = Math.min(...l.items.map((i) => i.b.top));
    const right = Math.max(...l.items.map((i) => i.b.x + i.b.w)), bot = Math.max(...l.items.map((i) => i.b.y + i.b.h * 0.25));
    return { page, text, x, y: top, w: right - x, h: bot - top, keys: l.items.map((i) => i.r.key) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

/** "[Page 1]\n…" for the pages given (numbers are the pages' places in the document) */
export function docText(pages: { n: number; lines: Line[] }[], max = 110_000): string {
  let out = '';
  for (const p of pages) {
    const s = `[Page ${p.n}]\n${p.lines.map((l) => l.text).join('\n')}\n\n`;
    if (out.length + s.length > max) { out += s.slice(0, Math.max(0, max - out.length)); break; }
    out += s;
  }
  return out.trim();
}

/** a page as a JPEG (base64 without prefix) at about `long` pixels on its longer side */
export async function pageJpeg(pdf: any, src: number, long = 1400, quality = 0.72): Promise<{ jpeg: string; w: number; h: number; scale: number }> {
  const page = await pdf.getPage(src + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = Math.min(3, long / Math.max(vp1.width, vp1.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const url = c.toDataURL('image/jpeg', quality);
  c.width = c.height = 0;
  return { jpeg: url.slice(url.indexOf(',') + 1), w: Math.round(vp.width), h: Math.round(vp.height), scale };
}
