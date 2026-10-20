// Page-level PDF operations, all done on the device with pdf-lib.
import { PDFDocument, PDFName, PDFHexString, PDFNull, PDFNumber, PDFRef, degrees } from 'pdf-lib';
import type { PageState } from '../engine/types';

/** "1-3, 5" (also with – or —) → zero-based page indexes within 0..count-1, in order, no duplicates. */
export function parseRange(text: string, count: number): number[] {
  const out: number[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*[-–—]\s*(\d+)?$/);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= count) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const i = +part;
      if (i >= 1 && i <= count) out.push(i - 1);
    }
  }
  return [...new Set(out)];
}

/** Zero-based indexes → "1–3, 5" */
export function formatRange(idx: number[]): string {
  const s = [...new Set(idx)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(j > i ? `${s[i] + 1}–${s[j] + 1}` : `${s[i] + 1}`);
    i = j;
  }
  return parts.join(', ');
}

export const loadDoc = (bytes: Uint8Array) => PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

/** Read an image file as PNG or JPEG bytes (other formats go through a canvas). */
export async function imageBytes(file: Blob): Promise<{ bytes: Uint8Array; png: boolean; w: number; h: number }> {
  const type = file.type;
  let blob: Blob = file;
  if (/heic|heif/i.test(type) || /\.(heic|heif)$/i.test((file as File).name ?? '')) {
    const heic2any = (await import('heic2any')).default as any;
    const r = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    blob = Array.isArray(r) ? r[0] : r;
  }
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not a readable image')); i.src = url; });
    const w = im.naturalWidth, h = im.naturalHeight;
    if (blob.type === 'image/jpeg' || blob.type === 'image/png') return { bytes: new Uint8Array(await blob.arrayBuffer()), png: blob.type === 'image/png', w, h };
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(im, 0, 0);
    const out: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
    return { bytes: new Uint8Array(await out.arrayBuffer()), png: true, w, h };
  } finally { URL.revokeObjectURL(url); }
}

export type PageSize = 'fit' | 'a4' | 'letter';
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] } as const;

/** Add an image as a page: sized to the image (longest side 842 pt) or fitted on A4 / Letter. */
export async function addImagePage(doc: PDFDocument, img: { bytes: Uint8Array; png: boolean; w: number; h: number }, size: PageSize = 'fit', margin = 0, at?: number) {
  const emb = img.png ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
  let pw: number, ph: number;
  if (size === 'fit') {
    const k = 842 / Math.max(img.w, img.h);
    pw = img.w * k; ph = img.h * k;
  } else {
    const [a, b] = SIZES[size];
    [pw, ph] = img.w > img.h ? [b, a] : [a, b];
  }
  const page = at === undefined ? doc.addPage([pw, ph]) : doc.insertPage(at, [pw, ph]);
  const k = Math.min((pw - 2 * margin) / img.w, (ph - 2 * margin) / img.h);
  const w = img.w * k, h = img.h * k;
  page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return page;
}

/** New document with the given pages of a source (page order and extra rotation from the editor). */
export async function pickPages(bytes: Uint8Array, pages: PageState[]): Promise<PDFDocument> {
  const src = await loadDoc(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pages.map((p) => p.src));
  copied.forEach((pg, i) => {
    const r = pages[i].rotation;
    if (r) pg.setRotation(degrees((pg.getRotation().angle + r) % 360));
    out.addPage(pg);
  });
  return out;
}

/** Outline (bookmarks): one entry per title, pointing at a page. */
export function addOutline(doc: PDFDocument, items: { title: string; page: number }[]) {
  if (!items.length) return;
  const ctx = doc.context;
  const root = ctx.nextRef();
  const refs = items.map(() => ctx.nextRef());
  const pages = doc.getPages();
  items.forEach((it, i) => {
    const d = ctx.obj({}) as any;
    d.set(PDFName.of('Title'), PDFHexString.fromText(it.title));
    d.set(PDFName.of('Parent'), root);
    d.set(PDFName.of('Dest'), ctx.obj([pages[it.page].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]));
    if (i > 0) d.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < items.length - 1) d.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], d);
  });
  const o = ctx.obj({}) as any;
  o.set(PDFName.of('Type'), PDFName.of('Outlines'));
  o.set(PDFName.of('First'), refs[0] as PDFRef);
  o.set(PDFName.of('Last'), refs[refs.length - 1] as PDFRef);
  o.set(PDFName.of('Count'), PDFNumber.of(items.length));
  ctx.assign(root, o);
  doc.catalog.set(PDFName.of('Outlines'), root);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export const save = (doc: PDFDocument) => doc.save({ useObjectStreams: true });

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
export const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`);
