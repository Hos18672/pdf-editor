import {
  PDFDocument, PDFDict, PDFName, PDFRef, PDFArray, PDFRawStream, PDFStream, StandardFonts,
  decodePDFRawStream, degrees, PDFFont, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFBool, PDFString,
} from 'pdf-lib';
import { tokenize, rebuild, fmtNum, toHex } from './contentStream';
import { interpret, removeGlyphs, invert, Glyph, M } from './interpreter';
import { readFontMetrics, FontMetrics, parseToUnicode } from './fonts';
import { renderScanText } from './scanText';
import { addTextLayer } from './textLayer';
import { BASELINE, MATCH_BASE, matchFile, wholeMatch, textSize, arabicText, MatchFont } from './matchFonts';
import { ARABIC_BASE, arabicFile, hasArabic, isRtl, visualRuns } from './rtl';
import * as fontkitNs from '@pdf-lib/fontkit';
import type { ExportInput, EditorObject, FontFamily, TextEdit } from './types';
import { decodeImage, writeJpeg } from './images';

type Box = { x0: number; y0: number; x1: number; y1: number };
const applyM = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const boxOf = (pts: [number, number][]): Box => ({
  x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])),
});
/** the area a glyph's letter takes (user space) */
function glyphBox(g: Glyph): Box {
  const [ox, oy] = g.origin, [ex, ey] = g.end;
  let dx = ex - ox, dy = ey - oy;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const up = g.height * 0.78, down = g.height * 0.2;
  return boxOf([[ox - dy * up, oy + dx * up], [ex - dy * up, ey + dx * up], [ex + dy * down, ey - dx * down], [ox + dy * down, oy - dx * down]]);
}
/** how much of `a` lies inside `b` (0–1) */
function coverShare(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  const area = Math.max(1e-6, (a.x1 - a.x0) * (a.y1 - a.y0));
  return (w * h) / area;
}

const mulM = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/** Black out the pixels under the boxes in the pictures drawn on the page (also inside forms). */
async function redactPictures(doc: PDFDocument, resources: PDFDict | undefined, draws: { name: string; ctm: M }[], boxes: Box[], done = new Set<string>(), depth = 0) {
  const xo = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo) return;
  for (const d of draws) {
    const ref = xo.get(PDFName.of(d.name));
    if (!(ref instanceof PDFRef) || done.has(ref.toString())) continue;
    const st = doc.context.lookup(ref);
    if (!(st instanceof PDFRawStream)) continue;
    const sub = st.dict.get(PDFName.of('Subtype'))?.toString();
    if (sub === '/Form' && depth < 6) {
      // a form draws its own content: follow it with its matrix
      let body: Uint8Array;
      try { body = decodePDFRawStream(st).decode(); } catch { continue; }
      const mx = st.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
      const fm: M = mx ? (mx.asArray().map((v: any) => (typeof v.asNumber === 'function' ? v.asNumber() : 0)) as M) : [1, 0, 0, 1, 0, 0];
      const inner = interpret(tokenize(body), () => undefined).draws.map((x) => ({ name: x.name, ctm: mulM(mulM(x.ctm, fm), d.ctm) }));
      const res = st.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources;
      await redactPictures(doc, res, inner, boxes, done, depth + 1);
      continue;
    }
    if (sub !== '/Image') continue;
    const area = boxOf([[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => applyM(d.ctm, u, v)));
    const hits = boxes.filter((b) => coverShare(b, area) > 0);
    if (!hits.length) continue;
    const px = await decodeImage(doc, st);
    if (!px) continue; // a kind of picture we can't change: it stays covered by the black box
    const back = invert(d.ctm);
    for (const b of hits) {
      const uv = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => applyM(back, x, y));
      const xs = uv.map((p) => p[0] * px.w), ys = uv.map((p) => (1 - p[1]) * px.h);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(px.w, Math.ceil(Math.max(...xs)) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(px.h, Math.ceil(Math.max(...ys)) + 1);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * px.w + x) * 4; px.rgba[i] = px.rgba[i + 1] = px.rgba[i + 2] = 0; }
    }
    await writeJpeg(doc, ref, st, px, 0.9);
    done.add(ref.toString());
  }
}

const f = fmtNum;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255) as [number, number, number];
}
const rgb = (hex: string, op: 'rg' | 'RG') => hexToRgb(hex).map(f).join(' ') + ' ' + op;

const STD: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
/** baseline offset from the top of a line box (line-height 1.2), as fraction of font size — matches the editor's CSS */
export { BASELINE };

const latin1 = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

function readContents(doc: PDFDocument, leaf: PDFDict): Uint8Array {
  const contents = leaf.get(PDFName.of('Contents'));
  const refs: unknown[] = [];
  const resolved = contents instanceof PDFRef ? doc.context.lookup(contents) : contents;
  if (resolved instanceof PDFArray) for (let i = 0; i < resolved.size(); i++) refs.push(resolved.get(i));
  else if (resolved) refs.push(resolved);
  const parts: Uint8Array[] = [];
  for (const r of refs) {
    const s = r instanceof PDFRef ? doc.context.lookup(r) : r;
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else if (s instanceof PDFStream) {
      const any = s as any;
      parts.push(typeof any.getUnencodedContents === 'function' ? any.getUnencodedContents() : any.getContents());
    }
    parts.push(latin1('\n'));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head, b64] = src.split(',');
  const bin = typeof atob === 'function' ? atob(b64) : (globalThis as any).Buffer.from(b64, 'base64').toString('binary');
  return { bytes: latin1(bin), png: head.includes('png') };
}

/** Glyphs that sit inside an edit region (projected along the text direction). */
function glyphsInRegion(glyphs: Glyph[], e: TextEdit): Glyph[] {
  const [ox, oy] = e.region.o;
  const [ux, uy] = e.region.u;
  const h = e.region.height;
  return glyphs.filter((g) => {
    const mx = (g.origin[0] + g.end[0]) / 2;
    const my = (g.origin[1] + g.end[1]) / 2;
    const t = (mx - ox) * ux + (my - oy) * uy;
    const s = -(mx - ox) * uy + (my - oy) * ux;
    return t >= -h * 0.05 && t <= e.region.width + h * 0.05 && s >= -h * 0.45 && s <= h * 0.8 &&
      Math.abs(g.height - h) <= h * 0.5;
  });
}

export async function exportPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.bytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  const fontCache = new Map<string, PDFFont>();
  const stdFont = async (fam: FontFamily, bold: boolean, italic: boolean) => {
    const name = STD[fam][(bold ? 1 : 0) + (italic ? 2 : 0)];
    if (!fontCache.has(name)) fontCache.set(name, await doc.embedFont(name));
    return fontCache.get(name)!;
  };
  const safe = (font: PDFFont, s: string) =>
    [...s].map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');

  // shipped fonts for the letters a document font lacks (embedded as subsets)
  const matchFonts = new Map<string, Promise<PDFFont | null>>();
  let fontkitOn = false;
  const filePdf = (file: string): Promise<PDFFont | null> => {
    if (!matchFonts.has(file)) {
      matchFonts.set(file, (async () => {
        if (!input.matchFont) return null;
        try {
          if (!fontkitOn) { doc.registerFontkit(((fontkitNs as any).default ?? fontkitNs) as any); fontkitOn = true; }
          return await doc.embedFont(await input.matchFont(file), { subset: true });
        } catch (err) { console.warn('match font', err); return null; }
      })());
    }
    return matchFonts.get(file)!;
  };
  const matchPdf = (m: MatchFont) => filePdf(matchFile(m));
  const arabicPdf = (bold: boolean) => filePdf(arabicFile(bold));
  // fonts of the document used again for new text: the glyphs of the page the font was picked on
  const fontPages = new Map<number, { glyphs: Glyph[]; fontDict?: PDFDict; toUni: (res: string) => Record<string, number> } | null>();
  const fontPage = (pi: number) => {
    if (fontPages.has(pi)) return fontPages.get(pi)!;
    let out: { glyphs: Glyph[]; fontDict?: PDFDict; toUni: (res: string) => Record<string, number> } | null = null;
    try {
      const leaf = pages[pi]?.node;
      if (leaf) {
        const fd = leaf.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
        const met = new Map<string, FontMetrics | undefined>();
        const fonts = (res: string) => {
          if (!met.has(res)) { const d = fd?.lookupMaybe(PDFName.of(res), PDFDict); met.set(res, d ? readFontMetrics(doc.context, d) : undefined); }
          return met.get(res);
        };
        const uni = new Map<string, Record<string, number>>();
        const toUni = (res: string) => {
          if (!uni.has(res)) {
            let map: Record<string, number> = {};
            try {
              const tu = fd?.lookupMaybe(PDFName.of(res), PDFDict)?.lookup(PDFName.of('ToUnicode'));
              if (tu instanceof PDFRawStream) map = parseToUnicode(decodePDFRawStream(tu).decode());
            } catch { map = {}; }
            uni.set(res, map);
          }
          return uni.get(res)!;
        };
        out = { glyphs: interpret(tokenize(readContents(doc, leaf)), fonts).glyphs, fontDict: fd, toUni, fonts } as any;
      }
    } catch (err) { console.warn('font page', err); }
    fontPages.set(pi, out);
    return out;
  };
  /** the pieces of a document font, added to the page being written (null: use the stand-in font) */
  const docSources = (o: Extract<EditorObject, { type: 'text' }>, leaf: any): Source[] | null => {
    const F = o.font;
    if (!F) return null;
    const sp = fontPage(F.page) as any;
    if (!sp?.fontDict) return null;
    const hits: Glyph[] = glyphsInRegion(sp.glyphs, { region: F.region } as TextEdit);
    if (!hits.length) return null;
    const count = new Map<string, number>();
    hits.forEach((g) => count.set(g.style.fontRes, (count.get(g.style.fontRes) ?? 0) + 1));
    const plain = (res: string) => baseFontOf(sp.fontDict, res).replace(/^\/?([A-Z]{6}\+)?/, '');
    const squash = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
    // the font picked (a line can mix fonts: a bold word), else the line's main font
    const want = F.name ? squash(F.name.replace(/^[A-Z]{6}\+/, '')) : '';
    const main = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).find((r) => want && squash(plain(r)) === want)
      ?? [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const mainG = hits.find((g) => g.style.fontRes === main)!;
    // Type3 fonts can have their own scale: size by how tall the line is drawn
    let k = mainG.height ? F.region.height / mainG.height : 1;
    if (!(k > 0.05 && k < 20) || Math.abs(k - 1) < 0.15) k = 1;
    const name = plain(main);
    // other subsets of the same font on that page supply letters the main one lacks
    const order = [main, ...sp.fontDict.keys().map((n: PDFName) => n.asString().slice(1)).filter((r: string) => r !== main && name && plain(r) === name)];
    const out: Source[] = [];
    for (const res of order) {
      const raw = sp.fontDict.get(PDFName.of(res));
      if (!raw) continue;
      const ref = raw instanceof PDFRef ? raw : doc.context.register(raw);
      const key = leaf.newFontDictionary('DocT', ref).asString();
      const map = res === main && Object.keys(F.charMap).length ? F.charMap : sp.toUni(res);
      if (!Object.keys(map).length) continue;
      out.push({ key, bpc: sp.fonts(res)?.bytesPerCode ?? 1, map, fs: o.size / k });
    }
    return out.length ? out : null;
  };

  const touched = new Set<number>([...input.objects.map((o) => o.page), ...input.edits.map((e) => e.page),
    ...Object.keys(input.dropText ?? {}).map(Number)]);

  for (const pi of touched) {
    const page = pages[pi];
    if (!page) continue;
    const leaf = page.node;
    leaf.normalize();
    const resources = leaf.Resources();
    const fontDict = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
    const metrics = new Map<string, FontMetrics | undefined>();
    const fonts = (res: string) => {
      if (!metrics.has(res)) {
        const fd = fontDict?.lookupMaybe(PDFName.of(res), PDFDict);
        metrics.set(res, fd ? readFontMetrics(doc.context, fd) : undefined);
      }
      return metrics.get(res);
    };
    const uniMaps = new Map<string, Record<string, number>>();
    const toUni = (res: string) => {
      if (!uniMaps.has(res)) {
        let map: Record<string, number> = {};
        try {
          const fd = fontDict?.lookupMaybe(PDFName.of(res), PDFDict);
          const tu = fd?.lookup(PDFName.of('ToUnicode'));
          if (tu instanceof PDFRawStream) map = parseToUnicode(decodePDFRawStream(tu).decode());
        } catch { map = {}; }
        uniMaps.set(res, map);
      }
      return uniMaps.get(res)!;
    };

    const original = readContents(doc, leaf);
    const ops = tokenize(original);
    const { glyphs, shows, draws } = interpret(ops, fonts);

    const edits = input.edits.filter((e) => e.page === pi);
    const family = edits.length ? fontFamilies(glyphs, toUni) : null;
    const remove = new Set<Glyph>();
    let add = '';

    const vm = input.viewMatrices[pi];
    // redactions: the text and picture pixels under the boxes are deleted, then the boxes are drawn
    const reds = vm ? input.objects.filter((o) => o.page === pi && o.type === 'redact') : [];
    if (reds.length) {
      const inv = invert(vm);
      const boxes = reds.map((o) => boxOf([[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]].map(([x, y]) => applyM(inv, x, y))));
      for (const g of glyphs) if (boxes.some((b) => coverShare(glyphBox(g), b) > 0.3)) remove.add(g);
      await redactPictures(doc, resources, draws, boxes).catch((err) => console.warn('redact pictures', err));
    }
    // invisible lines read again from the picture: their new text is written with the layer below
    for (const region of input.dropText?.[pi] ?? []) {
      for (const g of glyphsInRegion(glyphs, { region } as TextEdit)) if (g.style.Tr === 3 || g.style.Tr === 7) remove.add(g);
    }
    const rules = edits.length && input.rules && vm ? await input.rules(pi).catch(() => []) : [];
    // the page under the cover with the old letters filled in from the background around them (a pattern
    // or a tint stays); a flat paper colour where that's not possible
    const cover = async (e: TextEdit, scan = false) => {
      const pts = coverPts(e, scan);
      if (input.coverImage && vm && Math.abs(Math.atan2(e.region.u[1], e.region.u[0])) < 0.02) {
        const v = pts.map(([x, y]) => applyM(vm, x, y));
        const X0 = Math.min(...v.map((p) => p[0])), X1 = Math.max(...v.map((p) => p[0]));
        const Y0 = Math.min(...v.map((p) => p[1])), Y1 = Math.max(...v.map((p) => p[1]));
        const lineH = Math.hypot(vm[2], vm[3]) * e.region.height;
        const img = await input.coverImage(pi, { x: X0, y: Y0, w: X1 - X0, h: Y1 - Y0 }, lineH, e.bgColor, e.fgColor ?? '#000000').catch(() => null);
        if (img) {
          const inv = invert(vm);
          const p00 = applyM(inv, img.x, img.y + img.h), p10 = applyM(inv, img.x + img.w, img.y + img.h), p01 = applyM(inv, img.x, img.y);
          const key = leaf.newXObject('CvR', (await doc.embedPng(img.png)).ref).asString();
          return `q ${[p10[0] - p00[0], p10[1] - p00[1], p01[0] - p00[0], p01[1] - p00[1], p00[0], p00[1]].map(f).join(' ')} cm ${key} Do Q\n` + rulesOver(pts, rules, vm);
        }
      }
      return whiteoutRegion(e, scan) + rulesOver(pts, rules, vm);
    };
    for (const e of edits) {
      const hits = e.ocr ? [] : glyphsInRegion(glyphs, e).filter((g) => !remove.has(g));
      hits.forEach((g) => remove.add(g));
      // Invisible text (OCR layer of a scan, or a line recognised in the editor): the letters people
      // see are part of an image, so cover them with the paper colour and draw the new text visibly.
      const hidden = !!e.ocr || (hits.length > 0 && hits.filter((g) => g.style.Tr === 3 || g.style.Tr === 7).length * 2 > hits.length);
      if (!e.text.trim()) {
        if (!hits.length || hidden) add += await cover(e, hidden);
        continue;
      }
      const lines = e.text.split('\n');
      const glyphless = hits.length > 0 && hits.every((g) => /GlyphLess/i.test(baseFontOf(fontDict, g.style.fontRes)));
      // Arabic and Persian: written with the shipped Arabic font (joined letters, right to left)
      const arabic = hasArabic(e.text);
      const af = arabic ? await arabicPdf(e.fallback.bold) : null;
      // Scans / picture pages: the new text made of the page's own letters
      if (hidden && input.scanImage && !af) {
        const img = await input.scanImage(e).catch((err) => { console.warn('scan text', err); return null; });
        if (img) {
          add += await cover({ ...e, scan: { ...(e.scan ?? { family: 'Arimo', bold: false, sizeRatio: 1, stretch: 1, blur: 0, score: 0 }), inkX0: img.inkX0, inkX1: img.inkX1, dy: img.dy, inkUp: img.inkUp, inkDown: img.inkDown } }, true);
          add += placeImage(img, e, leaf, (await doc.embedPng(img.png)).ref, ...moveAlong(e, 0, 0));
          continue;
        }
      }
      if (hidden) add += await cover(e, true);
      const inkOf = () => {
        // the sampled ink, unless it is barely different from the paper (nothing visible was there)
        if (!e.fgColor) return '#000000';
        const a = hexToRgb(e.fgColor), b = hexToRgb(e.bgColor);
        return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 0.6 ? e.fgColor : '#000000';
      };
      // Scans / picture pages: draw the new text as a picture that matches the scan's own lettering
      if (hidden && e.scan && !af) {
        const img = await renderScanText(lines, e.scan, e.region.height * e.scan.sizeRatio * e.sizeScale, e.color ?? inkOf()).catch(() => null);
        if (img) {
          // the printed letters' own start and baseline (the hidden layer can be a little off)
          const sh = e.region.height;
          add += placeImage(img, e, leaf, (await doc.embedPng(img.png)).ref, ...moveAlong(e, (e.scan.dx ?? 0) * sh, (e.scan.dy ?? 0) * sh));
          continue;
        }
      }
      if (hits.length && !glyphless) {
        // first glyph along the reading direction
        const [ux, uy] = e.region.u;
        const count = new Map<string, number>();
        hits.forEach((g) => count.set(g.style.fontRes, (count.get(g.style.fontRes) ?? 0) + 1));
        const main = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
        // start where the line starts, whichever font its first glyph uses
        const first = hits
          .reduce((a, b) => (b.origin[0] * ux + b.origin[1] * uy < a.origin[0] * ux + a.origin[1] * uy ? b : a));
        const st = first.style;
        const fb = await stdFont(e.fallback.family, e.fallback.bold, e.fallback.italic);
        const fbKey = leaf.newFontDictionary('FbE', fb.ref).asString();
        // Every font the line already uses can supply glyphs: the main one first, then the
        // others (a line is often split across several subset / Type3 fonts, e.g. Chrome prints).
        const sources: Source[] = [];
        const order = [main, ...[...count.keys()].filter((k) => k !== main)];
        // then the other pieces of the same typeface & weight used elsewhere on the page,
        // so letters this line doesn't contain still come from the real font
        const roots = new Set(order.map((r) => family!.root(r)));
        const mainH = hits.find((g) => g.style.fontRes === main)!;
        for (const res of family!.all()) if (!order.includes(res) && roots.has(family!.root(res))) order.push(res);
        for (const res of order) {
          const g0 = hits.find((g) => g.style.fontRes === res) ?? glyphs.find((g) => g.style.fontRes === res);
          if (!g0) continue;
          // same visual size as the line: scale by the ratio of glyph heights
          const fs = g0.style.fontSize * (mainH.height / (g0.height || mainH.height)) * e.sizeScale;
          const map = res === main && Object.keys(e.charMap).length ? e.charMap : toUni(res);
          sources.push({ key: '/' + res, bpc: fonts(res)?.bytesPerCode ?? 1, map, fs });
        }
        let s = 'q ' + (e.offset ? `1 0 0 1 ${f(e.offset[0])} ${f(e.offset[1])} cm ` : '') + st.ctm.map(f).join(' ') + ' cm BT ';
        s += `${f(st.Tc)} Tc ${f(st.Tw)} Tw ${f(st.Tz)} Tz ${f(st.Ts)} Ts ${st.Tr === 3 ? 0 : st.Tr} Tr `;
        const ink = e.color ?? (hidden ? inkOf() : null);
        s += ink ? rgb(ink, 'rg') + ' ' : (st.fill.join(' ') || '0 g') + ' ';
        s += first.tm.map(f).join(' ') + ' Tm ';
        const lineK = lineScales(e);
        const lead = sources[0].fs * 1.2;
        if (af) {
          // right-to-left lines end where the original line ended (the text matrix measures in its own units)
          const ak = leaf.newFontDictionary('ArE', af.ref).asString();
          const A = mulM(first.tm, st.ctm), k = Math.hypot(A[0], A[1]) * (st.Tz / 100) || 1;
          const rtl = isRtl(e.text), fs = sources[0].fs;
          let prev = 0;
          s += `0 Tc 0 Tw ${ak} ${f(fs)} Tf `;
          lines.forEach((line, li) => {
            const w = arabicLine(af, line, rtl, fs);
            const dx = rtl ? e.region.width / k - w.width : 0;
            s += `${f(dx - prev)} ${f(li > 0 ? -lead : 0)} Td ${w.tj}`;
            prev = dx;
          });
        } else lines.forEach((line, li) => {
          // the next line as far down as its largest letters need
          if (li > 0) s += `0 ${f(-lead * Math.max(1, ...(lineK?.[li] ?? [1])))} Td `;
          s += encodeMixed(line.normalize('NFC'), sources, fbKey, sources[0].fs, fb, safe, true, lineK?.[li]);
        });
        s += 'ET Q\n';
        add += s;
      } else {
        // Text lives somewhere we cannot rewrite (e.g. inside a form) — cover it.
        if (!hidden) add += await cover(e);
        const fb = await stdFont(e.fallback.family, e.fallback.bold, e.fallback.italic);
        const key = leaf.newFontDictionary('FbE', fb.ref).asString();
        const h = e.region.height * e.sizeScale;
        const [ux, uy] = e.region.u;
        let s = `q BT ${rgb(e.color ?? (hidden ? inkOf() : '#000000'), 'rg')} ${key} 1 Tf `;
        const ak = af ? leaf.newFontDictionary('ArE', af.ref).asString() : '';
        const rtl = af ? isRtl(e.text) : false;
        const lineK = af ? null : lineScales(e);
        const [mx, my] = e.offset ?? [0, 0];
        let down = 0;
        lines.forEach((line, li) => {
          if (li > 0) down += h * 1.2 * Math.max(1, ...(lineK?.[li] ?? [1]));
          let ox = e.region.o[0] + mx + uy * down;
          let oy = e.region.o[1] + my - ux * down;
          if (af) {
            const w = arabicLine(af, line, rtl, 1);
            const dx = rtl ? e.region.width - w.width * h : 0;
            ox += ux * dx; oy += uy * dx;
            s += `${ak} 1 Tf ${f(ux * h)} ${f(uy * h)} ${f(-uy * h)} ${f(ux * h)} ${f(ox)} ${f(oy)} Tm ${w.tj}`;
          } else {
            s += `${f(ux * h)} ${f(uy * h)} ${f(-uy * h)} ${f(ux * h)} ${f(ox)} ${f(oy)} Tm `;
            // letters of other sizes: the same font at their size, one piece per size
            for (const [part, k] of sizeParts(line, lineK?.[li])) s += `${key} ${f(k)} Tf ${fb.encodeText(safe(fb, part)).toString()} Tj `;
          }
        });
        add += s + 'ET Q\n';
      }
    }

    const replacements = removeGlyphs(glyphs, shows, remove, fonts);
    const body = rebuild(original, ops, replacements);

    // Objects drawn in viewport space
    const objs = input.objects.filter((o) => o.page === pi && o.type !== 'link');
    if (objs.length) {
      add += 'q ' + invert(vm).map(f).join(' ') + ' cm\n';
      for (const o of objs) add += await drawObject(doc, leaf, o, stdFont, safe, { docSources, matchPdf, arabicPdf });
      add += 'Q\n';
    }
    // links: clickable areas (annotations), nothing drawn
    for (const o of input.objects) {
      if (o.page !== pi || o.type !== 'link' || !vm) continue;
      const dest = o.target !== undefined ? pages[o.target] : null;
      const uri = linkUri(o.url);
      if (!dest && !uri) continue;
      const inv = invert(vm);
      const pts = [[o.x, o.y], [o.x + o.w, o.y], [o.x + o.w, o.y + o.h], [o.x, o.y + o.h]].map(([x, y]) => [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const annot = doc.context.obj({
        Type: 'Annot', Subtype: 'Link', Rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(2)), Border: [0, 0, 0],
        ...(dest ? { Dest: [dest.ref, PDFName.of('Fit')] } : { A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri!) } }),
      });
      const ref = doc.context.register(annot);
      const annots = leaf.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (annots) annots.push(ref); else leaf.set(PDFName.of('Annots'), doc.context.obj([ref]));
    }

    const head = latin1('q\n');
    const tail = latin1('\nQ\n' + add);
    const merged = new Uint8Array(head.length + body.length + tail.length);
    merged.set(head, 0);
    merged.set(body, head.length);
    merged.set(tail, head.length + body.length);
    const stream = doc.context.flateStream(merged);
    leaf.set(PDFName.of('Contents'), doc.context.register(stream));
  }

  // recognised text of picture pages: searchable and selectable in the saved file
  if (input.ocrLayer) {
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    for (const [pi, lines] of Object.entries(input.ocrLayer)) if (pages[+pi] && lines.length) await addTextLayer(doc, pages[+pi], lines, helv);
  }

  if (input.forms && Object.keys(input.forms).length) await fillForm(doc, input.forms, !!input.flatten);
  else if (input.flatten) { try { doc.getForm().flatten(); } catch { /* no form */ } }

  // Page rotation, order and deletion
  const finalPages = input.pages.map((p) => {
    const pg = pages[p.src];
    const base = pg.getRotation().angle;
    pg.setRotation(degrees((((base + p.rotation) % 360) + 360) % 360));
    return pg;
  });
  const sameOrder = finalPages.length === pages.length && finalPages.every((p, i) => p === pages[i]);
  if (!sameOrder) {
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const p of finalPages) doc.addPage(p);
  }
  return doc.save({ useObjectStreams: true });
}

async function fillForm(doc: PDFDocument, values: Record<string, string | boolean>, flatten: boolean) {
  const form = doc.getForm();
  let latinOnly = true;
  for (const [name, v] of Object.entries(values)) {
    let field: any;
    try { field = form.getField(name); } catch { continue; }
    try {
      if (field instanceof PDFTextField) {
        const s = String(v ?? '');
        if (/[^\u0000-\u00ff]/.test(s)) latinOnly = false;
        const max = field.getMaxLength();
        field.setText(max ? s.slice(0, max) : s);
      } else if (field instanceof PDFCheckBox) v ? field.check() : field.uncheck();
      else if (field instanceof PDFRadioGroup) {
        if (!v) field.clear();
        else {
          const opts = field.getOptions();
          let opt = String(v);
          if (!opts.includes(opt)) {
            // the viewer reports the widget's appearance state (e.g. "1"); map it to the option
            const on = (field.acroField as any).getOnValues?.() ?? [];
            const i = on.findIndex((n: any) => n?.decodeText?.() === opt || n?.asString?.() === '/' + opt || String(n) === '/' + opt);
            if (i >= 0 && opts[i] !== undefined) opt = opts[i];
          }
          field.select(opt);
        }
      }
      else if (field instanceof PDFDropdown || field instanceof PDFOptionList) { if (v) field.select(String(v)); else field.clear(); }
    } catch { /* value not accepted by the field */ }
  }
  try {
    if (latinOnly) {
      const helv = await doc.embedFont(StandardFonts.Helvetica);
      form.updateFieldAppearances(helv);
    } else {
      // standard fonts can't draw this text: let the viewer build the appearance
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
    }
    if (flatten && latinOnly) form.flatten({ updateFieldAppearances: false });
  } catch (e) {
    form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  }
}

/** Draws a picture of text along a line: `left` / `below` place its corner around the baseline start (+ dx along, dy down). */
function placeImage(img: { w: number; h: number; left: number; below: number }, e: TextEdit, leaf: any, ref: any, dx: number, dy: number): string {
  const key = leaf.newXObject('ImT', ref).asString();
  const [ux, uy] = e.region.u;
  const ox = e.region.o[0] + ux * dx + uy * dy, oy = e.region.o[1] + uy * dx - ux * dy;
  const bx = ox - ux * img.left + uy * img.below, by = oy - uy * img.left - ux * img.below;
  return `q ${f(ux * img.w)} ${f(uy * img.w)} ${f(-uy * img.h)} ${f(ux * img.h)} ${f(bx)} ${f(by)} cm ${key} Do Q\n`;
}

function baseFontOf(fontDict: PDFDict | undefined, res: string): string {
  try { return fontDict?.lookupMaybe(PDFName.of(res), PDFDict)?.get(PDFName.of('BaseFont'))?.toString() ?? ''; } catch { return ''; }
}

/** Paint over a line. `scan`: the letters are pixels of an image, which rarely sit exactly on the OCR box. */
function whiteoutRegion(e: TextEdit, scan = false): string {
  return `q ${rgb(e.bgColor, 'rg')} ${coverPts(e, scan).map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ')} h f Q\n`;
}

/** Rules (table borders…) that cross a cover, drawn again on top of it, clipped to it. */
function rulesOver(pts: [number, number][], rules: { x: number; y: number; w: number; h: number; color: string }[], vm: M | undefined): string {
  if (!rules.length || !vm) return '';
  const v = pts.map(([x, y]) => [vm[0] * x + vm[2] * y + vm[4], vm[1] * x + vm[3] * y + vm[5]]);
  const x0 = Math.min(...v.map((p) => p[0])), x1 = Math.max(...v.map((p) => p[0]));
  const y0 = Math.min(...v.map((p) => p[1])), y1 = Math.max(...v.map((p) => p[1]));
  const hit = rules.filter((r) => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0);
  if (!hit.length) return '';
  let s = `q ${pts.map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ')} h W n ${invert(vm).map(f).join(' ')} cm `;
  for (const r of hit) s += `${rgb(r.color, 'rg')} ${f(r.x)} ${f(r.y)} ${f(r.w)} ${f(r.h)} re f `;
  return s + 'Q\n';
}

/** the corners of the cover over a line (user space) */
function coverPts(e: TextEdit, scan = false): [number, number][] {
  const [ox, oy] = e.region.o;
  const [ux, uy] = e.region.u;
  const h = e.region.height;
  const w = e.region.width;
  const pad = h * (scan ? 0.15 : 0.08);
  let desc = h * 0.28;
  let asc = h * 0.98;
  if (scan) {
    // as far as the neighbouring lines allow
    desc = Math.min(h * 0.42, e.room?.down ?? h * 0.42);
    asc = Math.min(h * 1.05, e.room?.up ?? h * 1.05);
    // all of the printed letters (long descenders, accents), whatever the text layer says
    if (e.scan?.inkDown !== undefined) desc = Math.max(desc, Math.min(h * 0.75, e.scan.inkDown * h + h * 0.06));
    if (e.scan?.inkUp !== undefined) asc = Math.max(asc, Math.min(h * 1.4, e.scan.inkUp * h + h * 0.06));
  }
  // on a scan, cover the printed letters themselves (the hidden layer can be shorter or offset)
  const l = Math.min(0, scan && e.scan?.inkX0 !== undefined ? e.scan.inkX0 * h : 0) - pad;
  const r = Math.max(w, scan && e.scan?.inkX1 !== undefined ? e.scan.inkX1 * h : w) + pad;
  const pts: [number, number][] = [
    [l, -desc], [r, -desc], [r, asc], [l, asc],
  ].map(([t, s]) => [t, s - (scan && e.scan?.dy ? e.scan.dy * h : 0)]) // follow the printed baseline
    .map(([t, s]) => [ox + t * ux - s * uy, oy + t * uy + s * ux]);
  return pts;
}

/**
 * Group font resources that are pieces of one typeface: PDFs printed by Chrome (Gmail etc.)
 * split a font into many small Type3/subset fonts, and letters of one word jump between them.
 * Fonts used for neighbouring letters inside the same word belong together.
 */
function fontFamilies(glyphs: Glyph[], toUni: (res: string) => Record<string, number>) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  const inv = new Map<string, Map<number, string>>();
  const charOf = (g: Glyph) => {
    const res = g.style.fontRes;
    if (!inv.has(res)) {
      const m = new Map<number, string>();
      for (const [ch, code] of Object.entries(toUni(res))) m.set(code, ch);
      inv.set(res, m);
    }
    return inv.get(res)!.get(g.code);
  };
  for (const g of glyphs) find(g.style.fontRes);
  for (let i = 1; i < glyphs.length; i++) {
    const a = glyphs[i - 1], b = glyphs[i];
    if (a.style.fontRes === b.style.fontRes) continue;
    const h = Math.max(a.height, b.height);
    if (!h || Math.abs(a.height - b.height) > h * 0.04) continue;
    if (Math.hypot(b.origin[0] - a.end[0], b.origin[1] - a.end[1]) > h * 0.12) continue;
    const ca = charOf(a), cb = charOf(b);
    if (!ca || !cb || /\s/.test(ca) || /\s/.test(cb)) continue;
    const fa = a.style.fill.join(' '), fb = b.style.fill.join(' ');
    if (fa !== fb) continue;
    parent.set(find(a.style.fontRes), find(b.style.fontRes));
  }
  return { root: find, all: () => [...parent.keys()] };
}

interface Source { key: string; bpc: number; map: Record<string, number>; fs: number }

/** one line of Arabic-script text: its pieces in screen order, shaped by the font, and its width */
function arabicLine(af: PDFFont, line: string, rtl: boolean, size: number): { tj: string; width: number } {
  const runs = visualRuns(line.normalize('NFC'), rtl);
  if (!runs.length) return { tj: '', width: 0 };
  // the shaper turns round anything it takes for Arabic script, Persian digits included: a piece that
  // must stay left to right is handed over turned round already
  const fk = (af as any).embedder?.font;
  const texts = runs.map((r) => {
    if (r.rtl || !fk?.layout) return r.text;
    try { return fk.layout(r.text).direction === 'rtl' ? [...r.text].reverse().join('') : r.text; } catch { return r.text; }
  });
  return {
    tj: '[' + texts.map((t) => af.encodeText(t).toString()).join(' ') + '] TJ ',
    width: texts.reduce((w, t) => w + af.widthOfTextAtSize(t, size), 0),
  };
}

function encodeMixed(
  line: string, sources: Source[], fbKey: string, fbSize: number, fb: PDFFont, safe: (f: PDFFont, s: string) => string,
  /** a space the fonts lack: a gap in the current font (false: the stand-in font's space) */
  gapSpace = true,
  /** size of each character (code point) × the line's size */
  scales?: number[],
): string {
  // split into runs per font and size: the line's own fonts first, a standard font for anything else
  let out = '';
  let cur = -2; // source index, -1 = fallback
  let curK = 1;
  let buf: number[] = [];
  let fbBuf = '';
  const flush = () => {
    if (cur >= 0 && buf.length) {
      const src = sources[cur];
      out += `${src.key} ${f(src.fs * curK)} Tf [`;
      let bytes: number[] = [];
      const parts: string[] = [];
      for (const c of buf) {
        if (c < 0) { // a space the font doesn't have
          if (bytes.length) parts.push(toHex(Uint8Array.from(bytes)));
          bytes = [];
          parts.push('-260');
        } else if (src.bpc === 2) bytes.push(c >> 8, c & 0xff);
        else bytes.push(c & 0xff);
      }
      if (bytes.length) parts.push(toHex(Uint8Array.from(bytes)));
      out += parts.join(' ') + '] TJ ';
    } else if (cur === -1 && fbBuf) {
      out += `${fbKey} ${f(fbSize * curK)} Tf ${fb.encodeText(safe(fb, fbBuf)).toString()} Tj `;
    }
    buf = [];
    fbBuf = '';
  };
  let ci = 0;
  for (const ch of line) {
    const k = scales?.[ci++] ?? 1;
    let idx = sources.findIndex((s) => s.map[ch] !== undefined);
    if (idx < 0 && ch === ' ' && gapSpace) idx = cur >= 0 ? cur : 0; // keep spaces in the current font (as a gap)
    if (idx !== cur || k !== curK) { flush(); cur = idx; curK = k; }
    if (idx >= 0) buf.push(sources[idx].map[ch] ?? -1);
    else fbBuf += ch;
  }
  flush();
  return out;
}

/** per-character sizes of each line of an edit (null: all the same) */
function lineScales(e: TextEdit): number[][] | null {
  const chars = [...e.text];
  if (!e.scales || e.scales.length !== chars.length) return null;
  const out: number[][] = [[]];
  chars.forEach((c, i) => { if (c === '\n') out.push([]); else out[out.length - 1].push(e.scales![i]); });
  return out;
}
/** a line split into pieces of one size each */
function sizeParts(line: string, scales?: number[]): [string, number][] {
  const out: [string, number][] = [];
  let i = 0;
  for (const ch of line) {
    const k = scales?.[i++] ?? 1;
    const last = out[out.length - 1];
    if (last && last[1] === k) last[0] += ch; else out.push([ch, k]);
  }
  return out;
}
/** a moved line's move as distances along and across it (for pictures placed along the line) */
function moveAlong(e: TextEdit, dx: number, dy: number): [number, number] {
  if (!e.offset) return [dx, dy];
  const [ux, uy] = e.region.u, [mx, my] = e.offset;
  // placeImage moves by dx along the line and dy down across it (−normal)
  return [dx + mx * ux + my * uy, dy - (-mx * uy + my * ux)];
}

const KAPPA = 0.5522847498;

/** what a typed link address opens: web pages get https://, e-mail addresses mailto:, phone numbers tel: */
export function linkUri(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'mailto:' + t;
  if (/^\+?[\d\s()/-]{6,}$/.test(t)) return 'tel:' + t.replace(/[^\d+]/g, '');
  return 'https://' + t.replace(/^\/+/, '');
}

/** filled arrow head at (x1, y1) (same shape as on screen) */
function arrowHeadPts(x0: number, y0: number, x1: number, y1: number, sw: number): [number, number][] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const L = Math.min(len * 0.45, Math.max(8, sw * 4.5)), W = L * 0.55;
  const bx = x1 - ux * L, by = y1 - uy * L;
  return [[x1 + ux * sw * 0.5, y1 + uy * sw * 0.5], [bx - uy * W, by + ux * W], [bx + uy * W, by - ux * W]];
}

async function drawObject(
  doc: PDFDocument, leaf: any, o: EditorObject,
  stdFont: (fam: FontFamily, b: boolean, i: boolean) => Promise<PDFFont>,
  safe: (f: PDFFont, s: string) => string,
  fontsOf: {
    docSources: (o: Extract<EditorObject, { type: 'text' }>, leaf: any) => Source[] | null;
    matchPdf: (m: MatchFont) => Promise<PDFFont | null>;
    arabicPdf: (bold: boolean) => Promise<PDFFont | null>;
  },
): Promise<string> {
  let s = 'q ';
  const marker = o.type === 'highlight' && !o.style;
  const opacity = o.type === 'highlight' ? (o.opacity ?? (o.style ? 1 : 0.4)) : o.opacity;
  if (opacity !== undefined && opacity < 1) {
    const gs = doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity, ...(marker ? { BM: 'Multiply' } : {}) });
    const key = leaf.newExtGState('GSo', doc.context.register(gs)).asString();
    s += `${key} gs `;
  }
  if (o.rot && o.type !== 'line') {
    // turned around the box centre (viewport space, y down: positive = clockwise)
    const r = (o.rot * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r), cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    s += `${f(c)} ${f(n)} ${f(-n)} ${f(c)} ${f(cx - cx * c + cy * n)} ${f(cy - cx * n - cy * c)} cm `;
  }
  switch (o.type) {
    case 'whiteout':
      s += `${rgb(o.fill, 'rg')} ${f(o.x)} ${f(o.y)} ${f(o.w)} ${f(o.h)} re f `;
      break;
    case 'highlight': {
      if (!o.style) { s += `${rgb(o.fill, 'rg')} ${f(o.x)} ${f(o.y)} ${f(o.w)} ${f(o.h)} re f `; break; }
      // underline / strike-through: a bar across the box (same place as on screen)
      const t = Math.max(0.6, Math.min(3, o.h * 0.075)), cy = o.y + o.h * (o.style === 'underline' ? 0.83 : 0.5);
      s += `${rgb(o.fill, 'rg')} ${f(o.x)} ${f(cy - t / 2)} ${f(o.w)} ${f(t)} re f `;
      break;
    }
    case 'redact':
      s += `0 0 0 rg ${f(o.x)} ${f(o.y)} ${f(o.w)} ${f(o.h)} re f `;
      break;
    case 'rect': {
      if (o.fill) s += rgb(o.fill, 'rg') + ' ';
      s += `${rgb(o.stroke, 'RG')} ${f(o.strokeWidth)} w ${f(o.x)} ${f(o.y)} ${f(o.w)} ${f(o.h)} re ${o.fill ? (o.strokeWidth > 0 ? 'B' : 'f') : 'S'} `;
      break;
    }
    case 'ellipse': {
      const rx = o.w / 2, ry = o.h / 2, cx = o.x + rx, cy = o.y + ry;
      const kx = rx * KAPPA, ky = ry * KAPPA;
      if (o.fill) s += rgb(o.fill, 'rg') + ' ';
      s += `${rgb(o.stroke, 'RG')} ${f(o.strokeWidth)} w `;
      s += `${f(cx + rx)} ${f(cy)} m `;
      s += `${f(cx + rx)} ${f(cy + ky)} ${f(cx + kx)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c `;
      s += `${f(cx - kx)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ky)} ${f(cx - rx)} ${f(cy)} c `;
      s += `${f(cx - rx)} ${f(cy - ky)} ${f(cx - kx)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c `;
      s += `${f(cx + kx)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ky)} ${f(cx + rx)} ${f(cy)} c h `;
      s += o.fill ? (o.strokeWidth > 0 ? 'B ' : 'f ') : 'S ';
      break;
    }
    case 'line':
      s += `${rgb(o.stroke, 'RG')} ${f(o.strokeWidth)} w 1 J ${f(o.x)} ${f(o.y)} m ${f(o.x2)} ${f(o.y2)} l S `;
      if (o.arrow) {
        const [a, b, c] = arrowHeadPts(o.x, o.y, o.x2, o.y2, o.strokeWidth);
        s += `${rgb(o.stroke, 'rg')} ${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l ${f(c[0])} ${f(c[1])} l h f `;
      }
      break;
    case 'draw': {
      s += `${rgb(o.stroke, 'RG')} ${f(o.strokeWidth)} w 1 J 1 j `;
      for (let i = 0; i < o.points.length; i += 2) {
        s += `${f(o.x + o.points[i])} ${f(o.y + o.points[i + 1])} ${i ? 'l' : 'm'} `;
      }
      s += 'S ';
      break;
    }
    case 'text': {
      // Arabic and Persian: the shipped Arabic font, lines right-aligned in the box when they read right to left
      const af = arabicText(o) ? await fontsOf.arabicPdf(o.bold) : null;
      if (af) {
        const ak = leaf.newFontDictionary('ArT', af.ref).asString();
        const rtl = isRtl(o.text);
        s += `BT ${rgb(o.color, 'rg')} 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr ${ak} ${f(o.size)} Tf `;
        o.text.split('\n').forEach((line, i) => {
          const w = arabicLine(af, line, rtl, o.size);
          const x = rtl ? o.x + Math.max(0, o.w - 2) - w.width : o.x;
          s += `1 0 0 -1 ${f(x)} ${f(o.y + o.size * 1.2 * i + o.size * ARABIC_BASE)} Tm ${w.tj}`;
        });
        s += 'ET ';
        break;
      }
      const font = await stdFont(o.family, o.bold, o.italic);
      const key = leaf.newFontDictionary('FbT', font.ref).asString();
      // a font of the document: the same letters as the page's own text; letters it lacks come from the
      // shipped font of the same design (or, for another design, the whole text when letters are missing)
      const F = o.font;
      const mf = F ? await fontsOf.matchPdf(F.match) : null;
      const mKey = mf ? leaf.newFontDictionary('MatT', mf.ref).asString() : key;
      const sources = F && !wholeMatch(o) ? fontsOf.docSources(o, leaf) : null;
      const whole = !!F && !!mf && !sources;
      const fb = mf ?? font;
      const base = whole ? MATCH_BASE[F!.match.family] : sources ? F!.base : BASELINE[o.family];
      const size = whole ? textSize(o) : o.size;
      s += `BT ${rgb(o.color, 'rg')} 0 Tc 0 Tw 100 Tz 0 Ts 0 Tr ${whole ? mKey : key} ${f(size)} Tf `;
      o.text.split('\n').forEach((line, i) => {
        const by = o.y + size * 1.2 * i + size * base;
        s += `1 0 0 -1 ${f(o.x)} ${f(by)} Tm `;
        if (sources) s += encodeMixed(line.normalize('NFC'), sources, mKey, o.size, fb, safe, false);
        else if (whole) s += `${mf!.encodeText(line.normalize('NFC')).toString()} Tj `;
        else s += `${font.encodeText(safe(font, line)).toString()} Tj `;
      });
      s += 'ET ';
      break;
    }
    case 'mark': {
      const { x, y, w, h } = o;
      if (o.kind === 'dot') {
        const r = Math.min(w, h) * 0.32, cx = x + w / 2, cy = y + h / 2, k = r * KAPPA;
        s += `${rgb(o.color, 'rg')} ${f(cx + r)} ${f(cy)} m ${f(cx + r)} ${f(cy + k)} ${f(cx + k)} ${f(cy + r)} ${f(cx)} ${f(cy + r)} c `;
        s += `${f(cx - k)} ${f(cy + r)} ${f(cx - r)} ${f(cy + k)} ${f(cx - r)} ${f(cy)} c ${f(cx - r)} ${f(cy - k)} ${f(cx - k)} ${f(cy - r)} ${f(cx)} ${f(cy - r)} c `;
        s += `${f(cx + k)} ${f(cy - r)} ${f(cx + r)} ${f(cy - k)} ${f(cx + r)} ${f(cy)} c f `;
      } else {
        s += `${rgb(o.color, 'RG')} ${f(Math.min(w, h) * 0.13)} w 1 J 1 j `;
        const P = (px: number, py: number) => `${f(x + px * w)} ${f(y + py * h)}`;
        s += o.kind === 'check'
          ? `${P(0.14, 0.54)} m ${P(0.4, 0.8)} l ${P(0.88, 0.2)} l S `
          : `${P(0.2, 0.2)} m ${P(0.8, 0.8)} l S ${P(0.8, 0.2)} m ${P(0.2, 0.8)} l S `;
      }
      break;
    }
    case 'image':
    case 'signature': {
      const { bytes, png } = dataUrlBytes(o.src);
      const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const key = leaf.newXObject('ImE', img.ref).asString();
      s += `${f(o.w)} 0 0 ${f(-o.h)} ${f(o.x)} ${f(o.y + o.h)} cm ${key} Do `;
      break;
    }
  }
  return s + 'Q\n';
}

export type { M };
