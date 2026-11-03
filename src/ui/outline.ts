// Bookmarks (the PDF's table of contents) made from the document's own headings: lines set larger
// than the body text, or numbered like "2.1 …", become entries; the level follows the numbering or the
// size. All of it from the text layer, on the device.
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber, PDFRef } from 'pdf-lib';

export interface Heading { title: string; page: number; level: number; x: number; y: number; on: boolean }

type Line = { text: string; size: number; x: number; y: number; bold: boolean; page: number };

/** the lines of a page (pdf.js text items; PDF user space) */
function linesOf(items: any[], styles: Record<string, any>, bold: (font: string) => boolean, page: number): Line[] {
  const out: Line[] = [];
  let cur: Line | null = null;
  let lastEnd = 0;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    // upright text only (turned lines are margins and stamps)
    if (Math.abs(b) > Math.abs(a) * 0.1 || size < 3) { if (cur) { out.push(cur); cur = null; } continue; }
    const str = it.str;
    if (cur && Math.abs(f - cur.y) < size * 0.35 && Math.abs(size - cur.size) < size * 0.25 && e - lastEnd < size * 3) {
      cur.text += (e - lastEnd > size * 0.15 && !cur.text.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      cur.bold = cur.bold && (bold(it.fontName) || !str.trim());
    } else if (str.trim()) {
      if (cur) out.push(cur);
      cur = { text: str, size, x: e, y: f, bold: bold(it.fontName) || /bold|black|heavy/i.test(styles?.[it.fontName]?.fontFamily ?? ''), page };
    }
    lastEnd = e + (it.width ?? 0);
    if (it.hasEOL && cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
}

const NUMBERED = /^((?:\d{1,2}\.){0,3}\d{1,2})\.?\s+\p{L}/u;

/** finds the headings of a document (pdf.js document, pages in order) */
export async function findHeadings(pdf: any, pages: number[], progress: (f: number) => void): Promise<Heading[]> {
  const all: Line[] = [];
  for (let k = 0; k < pages.length; k++) {
    const page = await pdf.getPage(pages[k] + 1);
    const tc = await page.getTextContent();
    // weights of the fonts: their names say it ("Arial-BoldMT"), once the page's fonts are loaded
    const names = new Map<string, boolean>();
    try { await page.getOperatorList(); } catch { /* fonts unknown */ }
    const bold = (fn: string) => {
      if (!names.has(fn)) {
        let b = false;
        try { const o = page.commonObjs.has(fn) ? page.commonObjs.get(fn) : null; b = !!o && (o.bold || /bold|black|heavy|semibold|demi/i.test(o.name ?? '')); } catch { /* none */ }
        names.set(fn, b);
      }
      return names.get(fn)!;
    };
    all.push(...linesOf(tc.items, tc.styles, bold, k));
    page.cleanup?.();
    progress((k + 1) / pages.length);
  }
  if (!all.length) return [];
  // the body text: the size most letters are set in
  const bySize = new Map<number, number>();
  for (const l of all) { const s = Math.round(l.size * 2) / 2; bySize.set(s, (bySize.get(s) ?? 0) + l.text.length); }
  const body = [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // running heads and footers: the same text on many pages
  const seen = new Map<string, Set<number>>();
  for (const l of all) { const k = l.text.replace(/\d+/g, '#').toLowerCase(); if (!seen.has(k)) seen.set(k, new Set()); seen.get(k)!.add(l.page); }
  const repeated = (l: Line) => { const n = seen.get(l.text.replace(/\d+/g, '#').toLowerCase())!.size; return n >= 3 && n > pages.length * 0.4; };
  const looksLikeHeading = (l: Line) => {
    const t = l.text;
    if (t.length < 2 || t.length > 110 || !/\p{L}{2}/u.test(t) || repeated(l)) return false;
    if (/^[\d\s.,/:-]+$/.test(t) || /^(seite|page)\s*\d+/i.test(t)) return false;
    // a sentence that runs on is body text, however it is set
    if (t.split(' ').length > 14) return false;
    return true;
  };
  const bigger = all.filter((l) => l.size >= body * 1.15 && looksLikeHeading(l));
  // bold lines at body size: only numbered ones, or when the document has no bigger headings
  const boldOnes = all.filter((l) => l.bold && Math.abs(l.size - body) < body * 0.15 && looksLikeHeading(l) && !/[.:,;]$/.test(l.text)
    && (NUMBERED.test(l.text) || bigger.length < 2));
  let found = [...bigger, ...boldOnes].sort((a, b) => a.page - b.page || b.y - a.y);
  // a heading set over two lines: one entry
  const merged: Line[] = [];
  for (const l of found) {
    const p = merged[merged.length - 1];
    if (p && p.page === l.page && Math.abs(p.size - l.size) < 0.6 && p.y - l.y > 0 && p.y - l.y < l.size * 1.6 && !NUMBERED.test(l.text)) p.text += ' ' + l.text;
    else merged.push({ ...l });
  }
  found = merged;
  // too many "headings": keep the larger sizes only
  if (found.length > pages.length * 12) found = found.filter((l) => l.size >= body * 1.3 || NUMBERED.test(l.text));
  // levels: by numbering ("2.1" is level 2), else by size (largest first)
  const sizes = [...new Set(found.map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const rank = (s: number) => Math.min(2, sizes.findIndex((x) => Math.abs(x - Math.round(s * 2) / 2) < 0.6));
  return found.slice(0, 400).map((l) => {
    const m = NUMBERED.exec(l.text);
    const level = m ? Math.min(3, m[1].split('.').filter(Boolean).length) : Math.max(1, rank(l.size) + 1);
    return { title: l.text.slice(0, 120), page: l.page, level, x: Math.max(0, l.x - 4), y: l.y + l.size * 1.15, on: true };
  });
}

/** writes the bookmarks into the PDF (replacing any it had); the reader shows them when it opens */
export async function writeOutline(bytes: Uint8Array, items: Heading[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const list = items.filter((h) => h.on && h.title.trim() && h.page < pages.length);
  const root = ctx.nextRef();
  const refs = list.map(() => ctx.nextRef());
  // the tree: each entry under the nearest earlier one with a smaller level
  const parent: number[] = [];
  const stack: number[] = [];
  list.forEach((h, i) => {
    while (stack.length && list[stack[stack.length - 1]].level >= h.level) stack.pop();
    parent[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
  });
  const kids = (p: number) => list.map((_, i) => i).filter((i) => parent[i] === p);
  const top = kids(-1);
  list.forEach((h, i) => {
    const sib = kids(parent[i]), at = sib.indexOf(i), mine = kids(i);
    const dest = PDFArray.withContext(ctx);
    dest.push(pages[h.page].ref); dest.push(PDFName.of('XYZ')); dest.push(PDFNumber.of(Math.round(h.x))); dest.push(PDFNumber.of(Math.round(h.y))); dest.push(PDFNull);
    const d = ctx.obj({}) as PDFDict;
    d.set(PDFName.of('Title'), PDFHexString.fromText(h.title.trim()));
    d.set(PDFName.of('Parent'), parent[i] < 0 ? root : refs[parent[i]]);
    d.set(PDFName.of('Dest'), dest);
    if (at > 0) d.set(PDFName.of('Prev'), refs[sib[at - 1]]);
    if (at < sib.length - 1) d.set(PDFName.of('Next'), refs[sib[at + 1]]);
    if (mine.length) {
      d.set(PDFName.of('First'), refs[mine[0]]);
      d.set(PDFName.of('Last'), refs[mine[mine.length - 1]]);
      // closed: the reader shows the chapters, a tap opens them
      d.set(PDFName.of('Count'), PDFNumber.of(-mine.length));
    }
    ctx.assign(refs[i], d);
  });
  const r = ctx.obj({}) as PDFDict;
  r.set(PDFName.of('Type'), PDFName.of('Outlines'));
  if (top.length) {
    r.set(PDFName.of('First'), refs[top[0]] as PDFRef);
    r.set(PDFName.of('Last'), refs[top[top.length - 1]] as PDFRef);
  }
  r.set(PDFName.of('Count'), PDFNumber.of(top.length));
  ctx.assign(root, r);
  doc.catalog.set(PDFName.of('Outlines'), root);
  if (list.length) doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  return doc.save({ useObjectStreams: true });
}

/** whether a PDF already has bookmarks */
export async function hasOutline(pdf: any): Promise<boolean> {
  try { return ((await pdf.getOutline()) ?? []).length > 0; } catch { return false; }
}
