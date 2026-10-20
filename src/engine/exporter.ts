import {
  PDFDocument, PDFDict, PDFName, PDFRef, PDFArray, PDFRawStream, PDFStream, StandardFonts,
  decodePDFRawStream, degrees, PDFFont,
} from 'pdf-lib';
import { tokenize, rebuild, fmtNum, toHex } from './contentStream';
import { interpret, removeGlyphs, invert, Glyph, M } from './interpreter';
import { readFontMetrics, FontMetrics, parseToUnicode } from './fonts';
import type { ExportInput, EditorObject, FontFamily, TextEdit } from './types';

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
export const BASELINE: Record<FontFamily, number> = { Helvetica: 0.947, Times: 0.938, Courier: 0.867 };

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

  const touched = new Set<number>([...input.objects.map((o) => o.page), ...input.edits.map((e) => e.page)]);

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
    const { glyphs, shows } = interpret(ops, fonts);

    const edits = input.edits.filter((e) => e.page === pi);
    const remove = new Set<Glyph>();
    let add = '';

    for (const e of edits) {
      const hits = glyphsInRegion(glyphs, e).filter((g) => !remove.has(g));
      hits.forEach((g) => remove.add(g));
      if (!e.text.trim()) {
        if (!hits.length) add += whiteoutRegion(e);
        continue;
      }
      const lines = e.text.split('\n');
      if (hits.length) {
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
        for (const res of order) {
          const g0 = hits.find((g) => g.style.fontRes === res)!;
          const map = res === main && Object.keys(e.charMap).length ? e.charMap : toUni(res);
          sources.push({ key: '/' + res, bpc: fonts(res)?.bytesPerCode ?? 1, map, fs: g0.style.fontSize * e.sizeScale });
        }
        let s = 'q ' + st.ctm.map(f).join(' ') + ' cm BT ';
        s += `${f(st.Tc)} Tc ${f(st.Tw)} Tw ${f(st.Tz)} Tz ${f(st.Ts)} Ts ${st.Tr === 3 ? 0 : st.Tr} Tr `;
        s += e.color ? rgb(e.color, 'rg') + ' ' : st.fill.join(' ') + ' ';
        s += first.tm.map(f).join(' ') + ' Tm ';
        const lead = sources[0].fs * 1.2;
        lines.forEach((line, li) => {
          if (li > 0) s += `0 ${f(-lead)} Td `;
          s += encodeMixed(line.normalize('NFC'), sources, fbKey, sources[0].fs, fb, safe);
        });
        s += 'ET Q\n';
        add += s;
      } else {
        // Text lives somewhere we cannot rewrite (e.g. inside a form) — cover it.
        add += whiteoutRegion(e);
        const fb = await stdFont(e.fallback.family, e.fallback.bold, e.fallback.italic);
        const key = leaf.newFontDictionary('FbE', fb.ref).asString();
        const h = e.region.height * e.sizeScale;
        const [ux, uy] = e.region.u;
        let s = `q BT ${rgb(e.color ?? '#000000', 'rg')} ${key} 1 Tf `;
        lines.forEach((line, li) => {
          const ox = e.region.o[0] + uy * h * 1.2 * li;
          const oy = e.region.o[1] - ux * h * 1.2 * li;
          s += `${f(ux * h)} ${f(uy * h)} ${f(-uy * h)} ${f(ux * h)} ${f(ox)} ${f(oy)} Tm ${fb.encodeText(safe(fb, line)).toString()} Tj `;
        });
        add += s + 'ET Q\n';
      }
    }

    const replacements = removeGlyphs(glyphs, shows, remove, fonts);
    const body = rebuild(original, ops, replacements);

    // Objects drawn in viewport space
    const objs = input.objects.filter((o) => o.page === pi);
    if (objs.length) {
      const vm = input.viewMatrices[pi];
      add += 'q ' + invert(vm).map(f).join(' ') + ' cm\n';
      for (const o of objs) add += await drawObject(doc, leaf, o, stdFont, safe);
      add += 'Q\n';
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

function whiteoutRegion(e: TextEdit): string {
  const [ox, oy] = e.region.o;
  const [ux, uy] = e.region.u;
  const h = e.region.height;
  const w = e.region.width;
  const pad = h * 0.08;
  const desc = h * 0.28;
  const asc = h * 0.98;
  const pts: [number, number][] = [
    [-pad, -desc], [w + pad, -desc], [w + pad, asc], [-pad, asc],
  ].map(([t, s]) => [ox + t * ux - s * uy, oy + t * uy + s * ux]);
  return `q ${rgb(e.bgColor, 'rg')} ${pts.map(([x, y], i) => `${f(x)} ${f(y)} ${i ? 'l' : 'm'}`).join(' ')} h f Q\n`;
}

interface Source { key: string; bpc: number; map: Record<string, number>; fs: number }

function encodeMixed(
  line: string, sources: Source[], fbKey: string, fbSize: number, fb: PDFFont, safe: (f: PDFFont, s: string) => string,
): string {
  // split into runs per font: the line's own fonts first, a standard font for anything else
  let out = '';
  let cur = -2; // source index, -1 = fallback
  let buf: number[] = [];
  let fbBuf = '';
  const flush = () => {
    if (cur >= 0 && buf.length) {
      const src = sources[cur];
      out += `${src.key} ${f(src.fs)} Tf [`;
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
      out += `${fbKey} ${f(fbSize)} Tf ${fb.encodeText(safe(fb, fbBuf)).toString()} Tj `;
    }
    buf = [];
    fbBuf = '';
  };
  for (const ch of line) {
    let idx = sources.findIndex((s) => s.map[ch] !== undefined);
    if (idx < 0 && ch === ' ') idx = cur >= 0 ? cur : 0; // keep spaces in the current font (as a gap)
    if (idx !== cur) { flush(); cur = idx; }
    if (idx >= 0) buf.push(sources[idx].map[ch] ?? -1);
    else fbBuf += ch;
  }
  flush();
  return out;
}

const KAPPA = 0.5522847498;

async function drawObject(
  doc: PDFDocument, leaf: any, o: EditorObject,
  stdFont: (fam: FontFamily, b: boolean, i: boolean) => Promise<PDFFont>,
  safe: (f: PDFFont, s: string) => string,
): Promise<string> {
  let s = 'q ';
  const opacity = o.type === 'highlight' ? (o.opacity ?? 0.4) : o.opacity;
  if (opacity !== undefined && opacity < 1) {
    const gs = doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity, ...(o.type === 'highlight' ? { BM: 'Multiply' } : {}) });
    const key = leaf.newExtGState('GSo', doc.context.register(gs)).asString();
    s += `${key} gs `;
  }
  switch (o.type) {
    case 'whiteout':
    case 'highlight':
      s += `${rgb(o.fill, 'rg')} ${f(o.x)} ${f(o.y)} ${f(o.w)} ${f(o.h)} re f `;
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
      const font = await stdFont(o.family, o.bold, o.italic);
      const key = leaf.newFontDictionary('FbT', font.ref).asString();
      s += `BT ${rgb(o.color, 'rg')} ${key} ${f(o.size)} Tf `;
      o.text.split('\n').forEach((line, i) => {
        const by = o.y + o.size * 1.2 * i + o.size * BASELINE[o.family];
        s += `1 0 0 -1 ${f(o.x)} ${f(by)} Tm ${font.encodeText(safe(font, line)).toString()} Tj `;
      });
      s += 'ET ';
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
