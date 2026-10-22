// The page-level tools: compress, password, page numbers, watermark, split, pictures and text out.
// All of it runs on the device.
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFArray, PDFStream, PDFPage, StandardFonts, rgb, degrees, decodePDFRawStream } from 'pdf-lib';
import { decodeImage, imageRefs, writeJpeg } from '../engine/images';
import { tokenize } from '../engine/contentStream';
import { interpret } from '../engine/interpreter';
import { loadDoc } from './pdfops';

// ---------- compress ----------

export type Strength = 'light' | 'balanced' | 'strong' | 'max';
const LEVELS: Record<Strength, { dpi: number; q: number; side: number }> = {
  light: { dpi: 200, q: 0.8, side: 3000 },
  balanced: { dpi: 150, q: 0.66, side: 2200 },
  strong: { dpi: 110, q: 0.52, side: 1600 },
  max: { dpi: 80, q: 0.4, side: 1100 },
};

/** how large (points) each picture is drawn on the pages; pictures in forms are not measured */
function drawnSizes(doc: PDFDocument): Map<string, number> {
  const out = new Map<string, number>();
  for (const page of doc.getPages()) {
    try {
      const xo = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      if (!xo) continue;
      const raw = page.node.get(PDFName.of('Contents'));
      const parts: Uint8Array[] = [];
      const add = (v: unknown) => {
        const st = v instanceof PDFRef ? doc.context.lookup(v) : v;
        if (st instanceof PDFRawStream) parts.push(decodeStream(st));
      };
      if (raw instanceof PDFArray) raw.asArray().forEach(add); else add(raw);
      const len = parts.reduce((n, p) => n + p.length + 1, 0);
      const all = new Uint8Array(len);
      let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; all[o++] = 10; }
      const { draws } = interpret(tokenize(all), () => undefined);
      for (const d of draws) {
        const ref = xo.get(PDFName.of(d.name));
        if (!(ref instanceof PDFRef)) continue;
        const [a, b, c, dd] = d.ctm;
        const side = Math.max(Math.hypot(a, b), Math.hypot(c, dd));
        const key = ref.toString();
        out.set(key, Math.max(out.get(key) ?? 0, side));
      }
    } catch { /* unusual page */ }
  }
  return out;
}

function decodeStream(st: PDFRawStream): Uint8Array {
  try { return decodePDFRawStream(st).decode(); } catch { return st.contents; }
}

/** objects nothing points to any more (old versions, removed pages) */
function dropUnused(doc: PDFDocument) {
  const seen = new Set<string>();
  const walk = (v: any) => {
    if (!v) return;
    if (v instanceof PDFRef) {
      const k = v.toString();
      if (seen.has(k)) return;
      seen.add(k);
      walk(doc.context.lookup(v));
    } else if (v instanceof PDFDict) { for (const [, x] of v.entries()) walk(x); }
    else if (v instanceof PDFArray) { for (const x of v.asArray()) walk(x); }
    else if (v instanceof PDFStream) { walk((v as any).dict); }
  };
  walk(doc.context.trailerInfo.Root);
  walk(doc.context.trailerInfo.Info);
  walk(doc.context.trailerInfo.Encrypt);
  for (const [ref] of doc.context.enumerateIndirectObjects()) if (!seen.has(ref.toString())) doc.context.delete(ref);
}

async function compressOnce(bytes: Uint8Array, level: Strength, progress: (f: number) => void): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const L = LEVELS[level];
  const sizes = drawnSizes(doc);
  // soft masks stay as they are (they must remain grey, lossless pictures)
  const masks = new Set<string>();
  const images = imageRefs(doc);
  for (const { st } of images) { const m = st.dict.get(PDFName.of('SMask')); if (m instanceof PDFRef) masks.add(m.toString()); }
  let i = 0;
  for (const { ref, st } of images) {
    progress(++i / images.length);
    if (masks.has(ref.toString()) || st.contents.length < 12000) continue;
    const px = await decodeImage(doc, st).catch(() => null);
    if (!px) continue;
    const pt = sizes.get(ref.toString());
    const side = Math.min(L.side, pt ? Math.max(64, Math.round((pt / 72) * L.dpi)) : L.side);
    const before = st.contents.length;
    const copy = st; // writeJpeg replaces the object; keep the old one if the new one is not smaller
    const after = await writeJpeg(doc, ref, st, px, L.q, side);
    if (after >= before * 0.95) doc.context.assign(ref, copy);
    // let the page breathe
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  dropUnused(doc);
  return doc.save({ useObjectStreams: true });
}

/** Make a PDF smaller. With `target` (bytes): the lightest level that gets under it, else the strongest. */
export async function compressPdf(bytes: Uint8Array, level: Strength, target: number | null, progress: (f: number) => void): Promise<{ bytes: Uint8Array; level: Strength }> {
  if (!target) return { bytes: await compressOnce(bytes, level, progress), level };
  const order: Strength[] = ['light', 'balanced', 'strong', 'max'];
  let best: { bytes: Uint8Array; level: Strength } | null = null;
  for (let k = 0; k < order.length; k++) {
    const out = await compressOnce(bytes, order[k], (f) => progress((k + f) / order.length));
    if (!best || out.length < best.bytes.length) best = { bytes: out, level: order[k] };
    if (out.length <= target) return { bytes: out, level: order[k] };
  }
  return best!;
}

// ---------- passwords ----------

export async function protectPdf(bytes: Uint8Array, password: string, allow: { print: boolean; copy: boolean; edit: boolean }): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib');
  const doc = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false } as any);
  const owner = password + ':' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  doc.encrypt({
    userPassword: password, ownerPassword: owner,
    permissions: {
      printing: allow.print ? 'highResolution' : false, copying: allow.copy, modifying: allow.edit,
      annotating: allow.edit, fillingForms: true, contentAccessibility: true, documentAssembly: allow.edit,
    },
  } as any);
  return doc.save({ useObjectStreams: false });
}

export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib');
  const doc = await lib.PDFDocument.load(bytes, { password, ignoreEncryption: false, updateMetadata: false } as any);
  return doc.save({ useObjectStreams: true });
}

// ---------- drawing on pages the way they are shown (rotation, crop box) ----------

/** A point on the page as seen (from the top left, points) and the matching drawing angle. */
function viewFrame(page: PDFPage) {
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  const cb = page.getCropBox();
  const W = r % 180 ? cb.height : cb.width, H = r % 180 ? cb.width : cb.height;
  const at = (vx: number, vy: number): [number, number] => {
    if (r === 90) return [cb.x + vy, cb.y + vx];
    if (r === 180) return [cb.x + cb.width - vx, cb.y + vy];
    if (r === 270) return [cb.x + cb.width - vy, cb.y + cb.height - vx];
    return [cb.x + vx, cb.y + cb.height - vy];
  };
  return { W, H, at, rot: r };
}

export type NumPos = 'bl' | 'bc' | 'br' | 'tl' | 'tc' | 'tr';
export type NumFormat = 'n' | 'page-n' | 'n-of' | 'seite' | 'dash';
export const formatNumber = (f: NumFormat, n: number, total: number) =>
  f === 'n' ? `${n}` : f === 'page-n' ? `Page ${n}` : f === 'n-of' ? `${n} / ${total}` : f === 'seite' ? `Seite ${n} von ${total}` : `– ${n} –`;

export async function addPageNumbers(bytes: Uint8Array, o: { pos: NumPos; format: NumFormat; start: number; from: number; size: number; margin: number; skipFirst?: boolean }): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const counted = pages.length - (o.from - 1);
  pages.forEach((page, i) => {
    if (i < o.from - 1) return;
    const n = o.start + (i - (o.from - 1));
    const text = formatNumber(o.format, n, o.start + counted - 1);
    const f = viewFrame(page);
    const w = font.widthOfTextAtSize(text, o.size);
    const x = o.pos[1] === 'l' ? o.margin : o.pos[1] === 'r' ? f.W - o.margin - w : (f.W - w) / 2;
    const y = o.pos[0] === 't' ? o.margin + o.size * 0.75 : f.H - o.margin;
    const [ux, uy] = f.at(x, y);
    page.drawText(text, { x: ux, y: uy, size: o.size, font, color: rgb(0.15, 0.15, 0.2), rotate: degrees(f.rot) });
  });
  return doc.save({ useObjectStreams: true });
}

export async function addWatermark(bytes: Uint8Array, o: { text: string; size: number; opacity: number; color: [number, number, number]; angle: number; tile: boolean; pages: 'all' | 'first' }): Promise<Uint8Array> {
  const doc = await loadDoc(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = [...o.text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  const w = font.widthOfTextAtSize(text, o.size), cap = o.size * 0.72;
  const th = (o.angle * Math.PI) / 180;
  const dx = Math.cos(th), dy = -Math.sin(th); // reading direction as seen (y down)
  const ux = Math.sin(th), uy = Math.cos(th); // "down" across the text, as seen
  doc.getPages().forEach((page, i) => {
    if (o.pages === 'first' && i > 0) return;
    const f = viewFrame(page);
    const centres: [number, number][] = [];
    if (!o.tile) centres.push([f.W / 2, f.H / 2]);
    else {
      const slanted = Math.abs(dy) > 0.2;
      const stepX = slanted ? w * 0.95 + cap * 2 : w + cap * 3, stepY = slanted ? cap * 6 + w * 0.25 : cap * 5;
      for (let cy = stepY / 2 - stepY; cy < f.H + stepY; cy += stepY) for (let cx = -stepX / 2 + ((Math.round(cy / stepY) % 2) * stepX) / 2; cx < f.W + stepX; cx += stepX) centres.push([cx, cy]);
    }
    for (const [cx, cy] of centres) {
      const sx = cx - (dx * w) / 2 + (ux * cap) / 2, sy = cy - (dy * w) / 2 + (uy * cap) / 2;
      const [px, py] = f.at(sx, sy);
      page.drawText(text, { x: px, y: py, size: o.size, font, color: rgb(...o.color), opacity: o.opacity, rotate: degrees(f.rot + o.angle) });
    }
  });
  return doc.save({ useObjectStreams: true });
}

// ---------- split ----------

/** page groups (0-based) for "every n pages" */
export const everyN = (count: number, n: number) => Array.from({ length: Math.ceil(count / n) }, (_, k) => Array.from({ length: Math.min(n, count - k * n) }, (_, j) => k * n + j));

export async function splitPdf(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const src = await loadDoc(bytes);
  const out: Uint8Array[] = [];
  for (const g of groups) {
    const d = await PDFDocument.create();
    (await d.copyPages(src, g)).forEach((p) => d.addPage(p));
    out.push(await d.save({ useObjectStreams: true }));
  }
  return out;
}
