// The Remove tool in the editor: what a brush stroke covers is taken out of the page's content (letters,
// shapes, pictures wholly under it); where nothing in the file can be (a scan, a photo), the page's own
// texture is copied over it as a picture of just that area.
import { PDFDocument } from 'pdf-lib';
import { tokenize, type Op } from '../engine/contentStream';
import { interpret } from '../engine/interpreter';
import { cutPlan, pageFonts, type CutStroke } from '../engine/cut';
import { readContents } from '../engine/exporter';
import type { M } from '../engine/types';
import { eraseImage } from './scan/engine';

type Content = { ops: Op[]; it: ReturnType<typeof interpret> };

/** the parsed content of a document's pages, read once per document (bytes) */
export function contentReader(bytes: Uint8Array) {
  let doc: Promise<PDFDocument | null> | null = null;
  const pages = new Map<number, Promise<Content | null>>();
  return (src: number): Promise<Content | null> => {
    let p = pages.get(src);
    if (!p) {
      doc ??= PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).catch(() => null);
      p = doc.then((d) => {
        if (!d) return null;
        const leaf = d.getPage(src).node;
        const ops = tokenize(readContents(d, leaf));
        return { ops, it: interpret(ops, pageFonts(d, leaf)) };
      }).catch(() => null);
      pages.set(src, p);
    }
    return p;
  };
}

/** does the stroke take anything out of the page's content? */
export function cutsSomething(c: Content | null, stroke: CutStroke, vm: M): boolean {
  if (!c) return false;
  const plan = cutPlan(c.ops, c.it, [stroke], vm);
  return plan.glyphs.size > 0 || plan.blank.size > 0 || plan.pictures.length > 0;
}

/**
 * The page's texture copied over what the stroke covers (for scans and photos): only the area round the
 * stroke is drawn and filled. A see-through picture of the filled part, in page view units.
 */
export async function textureFill(page: any, stroke: CutStroke, size: { w: number; h: number }): Promise<{ src: string; x: number; y: number; w: number; h: number } | null> {
  const P = stroke.pts;
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (let i = 0; i + 1 < P.length; i += 2) { X0 = Math.min(X0, P[i]); X1 = Math.max(X1, P[i]); Y0 = Math.min(Y0, P[i + 1]); Y1 = Math.max(Y1, P[i + 1]); }
  // enough room round it to find matching texture
  const pad = stroke.r + Math.max(40, Math.max(X1 - X0, Y1 - Y0) * 0.7);
  const ax = Math.max(0, X0 - pad), ay = Math.max(0, Y0 - pad), bx = Math.min(size.w, X1 + pad), by = Math.min(size.h, Y1 + pad);
  if (bx <= ax || by <= ay) return null;
  const s = Math.min(3, 1600 / Math.max(bx - ax, by - ay));
  const vp = page.getViewport({ scale: s });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((bx - ax) * s)); c.height = Math.max(1, Math.round((by - ay) * s));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp, transform: [1, 0, 0, 1, -ax * s, -ay * s] }).promise;
  const d = x.getImageData(0, 0, c.width, c.height);
  const w = c.width, h = c.height, L = Math.max(w, h);
  const local = [{ r: (stroke.r * s) / L, pts: P.map((v, i) => (i % 2 ? (v - ay) * s / h : (v - ax) * s / w)) }];
  const { img, mask } = await eraseImage({ w, h, data: d.data }, local, true);
  if (!mask) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < h; yy++) for (let xx = 0, p = yy * w; xx < w; xx++, p++) if (mask[p] > 0.02) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = new ImageData(cw, ch);
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
    const p = (yy + y0) * w + xx + x0, i = p * 4, j = (yy * cw + xx) * 4;
    out.data[j] = img.data[i]; out.data[j + 1] = img.data[i + 1]; out.data[j + 2] = img.data[i + 2];
    out.data[j + 3] = Math.round(Math.min(1, mask[p] * 1.6) * 255);
  }
  const oc = document.createElement('canvas');
  oc.width = cw; oc.height = ch;
  oc.getContext('2d')!.putImageData(out, 0, 0);
  c.width = 0;
  return { src: oc.toDataURL('image/png'), x: ax + x0 / s, y: ay + y0 / s, w: cw / s, h: ch / s };
}
