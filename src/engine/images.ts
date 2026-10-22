// Pictures inside a PDF: decode to pixels, change, write back as JPEG. Used to make files smaller
// (Compress) and to black out what a redaction covers in scans and photos. Runs in the browser.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from 'pdf-lib';

export interface Pixels { w: number; h: number; rgba: Uint8ClampedArray; gray: boolean }

const nameOf = (v: unknown) => (v instanceof PDFName ? v.asString() : '');

function filtersOf(dict: PDFDict): string[] {
  const f = dict.get(PDFName.of('Filter'));
  if (f instanceof PDFName) return [f.asString()];
  if (f instanceof PDFArray) return f.asArray().map(nameOf);
  return [];
}

/** colour space → components (1 gray, 3 rgb, 4 cmyk) and an optional palette */
function spaceOf(doc: PDFDocument, cs: unknown): { n: number; palette?: Uint8Array; base?: number } | null {
  const v = cs instanceof PDFRef ? doc.context.lookup(cs) : cs;
  if (v instanceof PDFName) {
    const s = v.asString();
    if (s === '/DeviceGray' || s === '/CalGray') return { n: 1 };
    if (s === '/DeviceRGB' || s === '/CalRGB') return { n: 3 };
    if (s === '/DeviceCMYK') return { n: 4 };
    return null;
  }
  if (v instanceof PDFArray) {
    const kind = nameOf(v.get(0));
    if (kind === '/ICCBased') {
      const st = doc.context.lookup(v.get(1));
      const n = st && (st as any).dict ? ((st as any).dict as PDFDict).get(PDFName.of('N')) : null;
      const num = n instanceof PDFNumber ? n.asNumber() : 3;
      return { n: num };
    }
    if (kind === '/CalRGB') return { n: 3 };
    if (kind === '/CalGray') return { n: 1 };
    if (kind === '/Indexed') {
      const base = spaceOf(doc, v.get(1));
      if (!base) return null;
      let lookup: any = v.get(3);
      if (lookup instanceof PDFRef) lookup = doc.context.lookup(lookup);
      let pal: Uint8Array | null = null;
      if (lookup instanceof PDFRawStream) pal = decodePDFRawStream(lookup).decode();
      else if (lookup && typeof (lookup as any).asBytes === 'function') pal = (lookup as any).asBytes();
      else if (lookup && typeof (lookup as any).decodeText === 'function') pal = new Uint8Array([...(lookup as any).decodeText()].map((c: string) => c.charCodeAt(0) & 255));
      if (!pal) return null;
      return { n: 1, palette: pal, base: base.n };
    }
  }
  return null;
}

const cmyk = (c: number, m: number, y: number, k: number) => [255 - Math.min(255, c + k), 255 - Math.min(255, m + k), 255 - Math.min(255, y + k)];

/** Decode an image XObject; null for kinds we leave alone (masks, 1-bit, JPX…). */
export async function decodeImage(doc: PDFDocument, st: PDFRawStream): Promise<Pixels | null> {
  const d = st.dict;
  if (nameOf(d.get(PDFName.of('Subtype'))) !== '/Image') return null;
  if (d.get(PDFName.of('ImageMask'))?.toString() === 'true') return null;
  const w = (d.get(PDFName.of('Width')) as PDFNumber)?.asNumber?.(), h = (d.get(PDFName.of('Height')) as PDFNumber)?.asNumber?.();
  if (!w || !h) return null;
  const filters = filtersOf(d);
  if (filters.some((f) => f === '/JPXDecode' || f === '/JBIG2Decode' || f === '/CCITTFaxDecode')) return null;
  if (filters.includes('/DCTDecode')) {
    if (filters[filters.length - 1] !== '/DCTDecode') return null;
    let jpeg = st.contents;
    if (filters.length > 1) {
      // e.g. ASCII85 around the JPEG: undo the outer filters
      const d2 = d.clone(doc.context);
      d2.set(PDFName.of('Filter'), doc.context.obj(filters.slice(0, -1).map((f) => PDFName.of(f.slice(1)))));
      d2.delete(PDFName.of('DecodeParms'));
      try { jpeg = decodePDFRawStream(PDFRawStream.of(d2, st.contents)).decode(); } catch { return null; }
    }
    const bmp = await createImageBitmap(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    bmp.close();
    const sp = spaceOf(doc, d.get(PDFName.of('ColorSpace')));
    return { w: c.width, h: c.height, rgba: x.getImageData(0, 0, c.width, c.height).data, gray: sp?.n === 1 };
  }
  const bpc = (d.get(PDFName.of('BitsPerComponent')) as PDFNumber)?.asNumber?.() ?? 8;
  const sp = spaceOf(doc, d.get(PDFName.of('ColorSpace')));
  if (!sp || (bpc !== 8 && !(sp.palette && (bpc === 1 || bpc === 2 || bpc === 4)))) return null;
  if (d.get(PDFName.of('DecodeParms')) && !filters.includes('/FlateDecode') && !filters.includes('/LZWDecode')) return null;
  let raw: Uint8Array;
  try { raw = decodePDFRawStream(st).decode(); } catch { return null; }
  const rgba = new Uint8ClampedArray(w * h * 4);
  if (sp.palette) {
    const rowBytes = Math.ceil((w * bpc) / 8);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const bit = x * bpc, byte = raw[y * rowBytes + (bit >> 3)];
      const idx = bpc === 8 ? byte : (byte >> (8 - bpc - (bit & 7))) & ((1 << bpc) - 1);
      const o = (y * w + x) * 4, b = sp.base!;
      if (b === 1) { const g = sp.palette[idx]; rgba[o] = rgba[o + 1] = rgba[o + 2] = g; }
      else if (b === 3) { rgba[o] = sp.palette[idx * 3]; rgba[o + 1] = sp.palette[idx * 3 + 1]; rgba[o + 2] = sp.palette[idx * 3 + 2]; }
      else { const [r, g, bl] = cmyk(sp.palette[idx * 4], sp.palette[idx * 4 + 1], sp.palette[idx * 4 + 2], sp.palette[idx * 4 + 3]); rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; }
      rgba[o + 3] = 255;
    }
    return { w, h, rgba, gray: sp.base === 1 };
  }
  if (raw.length < w * h * sp.n) return null;
  for (let p = 0, i = 0; p < w * h; p++, i += sp.n) {
    const o = p * 4;
    if (sp.n === 1) { rgba[o] = rgba[o + 1] = rgba[o + 2] = raw[i]; }
    else if (sp.n === 3) { rgba[o] = raw[i]; rgba[o + 1] = raw[i + 1]; rgba[o + 2] = raw[i + 2]; }
    else { const [r, g, b] = cmyk(raw[i], raw[i + 1], raw[i + 2], raw[i + 3]); rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; }
    rgba[o + 3] = 255;
  }
  return { w, h, rgba, gray: sp.n === 1 };
}

/** Replace the image object `ref` by a JPEG of `px` (scaled to at most `maxSide` pixels), keeping its soft mask. */
export async function writeJpeg(doc: PDFDocument, ref: PDFRef, old: PDFRawStream, px: Pixels, quality: number, maxSide = Infinity): Promise<number> {
  const k = Math.min(1, maxSide / Math.max(px.w, px.h));
  const W = Math.max(1, Math.round(px.w * k)), H = Math.max(1, Math.round(px.h * k));
  const src = new OffscreenCanvas(px.w, px.h);
  src.getContext('2d')!.putImageData(new ImageData(px.rgba as any, px.w, px.h), 0, 0);
  const c = new OffscreenCanvas(W, H);
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, W, H);
  // (browsers write colour JPEGs; grey pictures stay small because their colour channels are flat)
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const dict = doc.context.obj({
    Type: 'XObject', Subtype: 'Image', Width: W, Height: H, BitsPerComponent: 8,
    ColorSpace: 'DeviceRGB', Filter: 'DCTDecode',
  }) as PDFDict;
  for (const keep of ['SMask', 'Mask', 'Interpolate', 'Intent']) {
    const v = old.dict.get(PDFName.of(keep));
    if (v) dict.set(PDFName.of(keep), v);
  }
  doc.context.assign(ref, PDFRawStream.of(dict, bytes));
  return bytes.length;
}

/** every image object in the file */
export function imageRefs(doc: PDFDocument): { ref: PDFRef; st: PDFRawStream }[] {
  const out: { ref: PDFRef; st: PDFRawStream }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && nameOf(obj.dict.get(PDFName.of('Subtype'))) === '/Image') out.push({ ref, st: obj });
  }
  return out;
}
