// Turns pdf.js text content into editable "runs" and works out, for each
// run's font, which characters can be written with the original embedded font.
import * as fontkitNs from '@pdf-lib/fontkit';

// ESM build exports a default object, CJS build exports named members
const fontkit: { create: (data: Uint8Array) => any } = ((fontkitNs as any).default ?? fontkitNs) as any;
import type { FontFamily } from './types';

import { drawnOrder, hasArabic, visualToLogical } from './rtl';

export interface FontInfo {
  loadedName: string;
  name: string;
  charMap: Record<string, number>; // unicode char -> char code (glyph exists)
  display: Record<string, string>; // unicode char -> code point string in pdf.js' converted font
  fallback: { family: FontFamily; bold: boolean; italic: boolean };
  cssFallback: string;
  /** unicode char -> glyph id in pdf.js' converted font data */
  gids: Record<string, number>;
  /** CSS family of the same font re-registered with a Unicode cmap (set by the UI once loaded) */
  editFamily?: string;
}

export interface TextRun {
  key: string;
  page: number;
  str: string;
  /** main font of the run (most characters) */
  fontName: string;
  /** characters per font, for runs that span several fonts */
  fontChars?: Record<string, number>;
  /** PDF user space */
  region: { o: [number, number]; u: [number, number]; width: number; height: number };
  /** while building: the pieces as drawn (position along the line), for right-to-left text */
  pieces?: { at: number; str: string; w: number }[];
}

type PdfjsFont = {
  name?: string; loadedName?: string; data?: Uint8Array; toUnicode?: any; toFontChar?: number[];
  bold?: boolean; italic?: boolean; black?: boolean; isSerifFont?: boolean; isMonospace?: boolean;
  isType3Font?: boolean; missingFile?: boolean; fallbackName?: string;
};

function toUnicodeEntries(tu: any): [number, string][] {
  if (!tu) return [];
  if (tu._map) {
    const out: [number, string][] = [];
    const m = tu._map;
    if (Array.isArray(m)) m.forEach((v: string, k: number) => v !== undefined && out.push([k, v]));
    else for (const k of Object.keys(m)) out.push([+k, m[k]]);
    return out;
  }
  if (typeof tu.firstChar === 'number') {
    const out: [number, string][] = [];
    for (let c = tu.firstChar; c <= Math.min(tu.lastChar, 0xffff); c++) out.push([c, String.fromCharCode(c)]);
    return out;
  }
  if (Array.isArray(tu)) return tu.map((v, k) => [k, v] as [number, string]).filter(([, v]) => v !== undefined);
  return [];
}

export function analyseFont(font: PdfjsFont, loadedName: string): FontInfo {
  const name = (font.name || '').replace(/^[A-Z]{6}\+/, '');
  const lname = name.toLowerCase();
  const bold = !!font.bold || !!font.black || /bold|black|heavy|semibold|demi/.test(lname);
  const italic = !!font.italic || /italic|oblique/.test(lname);
  const mono = !!font.isMonospace || /courier|mono|consol/.test(lname);
  const serif = !mono && (!!font.isSerifFont || /times|serif|georgia|garamond|cambria|book|roman|minion|palatino/.test(lname)) && !/sans/.test(lname);
  const family: FontFamily = mono ? 'Courier' : serif ? 'Times' : 'Helvetica';
  const cssFallback = mono ? '"Courier New", Courier, monospace' : serif ? '"Times New Roman", Times, serif' : 'Arial, Helvetica, sans-serif';

  const charMap: Record<string, number> = {};
  const display: Record<string, string> = {};
  const gids: Record<string, number> = {};
  if (font.isType3Font) {
    // Type3 glyphs are drawings, not a font file: every mapped code was drawn in this document
    for (const [code, raw] of toUnicodeEntries(font.toUnicode)) {
      const uni = raw?.normalize('NFC');
      if (uni && [...uni].length === 1 && charMap[uni] === undefined) charMap[uni] = code;
    }
    return { loadedName, name, charMap, display, fallback: { family, bold, italic }, cssFallback, gids };
  }

  let fk: any = null;
  if (font.data && !font.missingFile) {
    try { fk = fontkit.create(font.data as any); } catch { fk = null; }
  }
  for (const [code, raw] of toUnicodeEntries(font.toUnicode)) {
    const uni = raw?.normalize('NFC');
    if (!uni || [...uni].length !== 1) continue;
    const fc = font.toFontChar?.[code] ?? code;
    let gid = 0;
    if (fk) {
      try { const g = fk.glyphForCodePoint(fc); gid = g ? g.id : 0; } catch { gid = 0; }
      if (!gid) continue;
    } else if (font.data && !font.missingFile) continue;
    if (charMap[uni] === undefined) {
      charMap[uni] = code;
      display[uni] = String.fromCodePoint(fc);
      if (gid) gids[uni] = gid;
    }
  }
  return { loadedName, name, charMap, display, fallback: { family, bold, italic }, cssFallback, gids };
}

/** Join runs that sit next to each other on the same baseline but came out of the PDF in separate pieces. */
function mergeNeighbours(runs: TextRun[]) {
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < runs.length; i++) {
      for (let j = 0; j < runs.length; j++) {
        if (i === j) continue;
        const a = runs[i].region, b = runs[j].region;
        if (Math.abs(a.u[0] - b.u[0]) > 0.01 || Math.abs(a.u[1] - b.u[1]) > 0.01) continue;
        if (Math.abs(a.height - b.height) > Math.max(a.height, b.height) * 0.3) continue;
        const h = Math.max(a.height, b.height);
        const dx = b.o[0] - a.o[0], dy = b.o[1] - a.o[1];
        const t = dx * a.u[0] + dy * a.u[1];
        const sOff = -dx * a.u[1] + dy * a.u[0];
        if (Math.abs(sOff) > h * 0.2) continue;
        // b must start right after (or inside) a
        if (t < -h * 0.2 || t > a.width + h * 0.6) continue;
        const gap = t - a.width;
        const A = runs[i], B = runs[j];
        if (t < a.width - h * 0.3) {
          // overlapping: only merge if b is fully inside a's span and short (a stray glyph)
          if (t + b.width > a.width + h * 0.3) continue;
        }
        const join = gap > h * 0.12 && !A.str.endsWith(' ') && !B.str.startsWith(' ') ? ' ' : '';
        const fc: Record<string, number> = { ...(A.fontChars ?? { [A.fontName]: [...A.str].length }) };
        for (const [k, v] of Object.entries(B.fontChars ?? { [B.fontName]: [...B.str].length })) fc[k] = (fc[k] ?? 0) + v;
        if (t >= a.width - h * 0.3) A.str = A.str + join + B.str;
        else {
          // insert by position
          const ratio = Math.max(0, Math.min(1, t / Math.max(a.width, 1e-6)));
          const chars = [...A.str];
          const at = Math.round(chars.length * ratio);
          A.str = chars.slice(0, at).join('') + B.str + chars.slice(at).join('');
        }
        a.width = Math.max(a.width, t + b.width);
        a.height = Math.max(a.height, b.height);
        A.pieces = [...(A.pieces ?? []), ...(B.pieces ?? [])];
        A.fontChars = fc;
        A.fontName = Object.entries(fc).sort((x, y) => y[1] - x[1])[0][0];
        runs.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
}

/** Build editable runs from pdf.js getTextContent() items. */
export function buildRuns(items: any[], page: number): TextRun[] {
  const runs: TextRun[] = [];
  let cur: TextRun | null = null;
  for (const it of items) {
    if (!('str' in it) || !it.transform) continue;
    const tr = it.transform as number[];
    const height = Math.hypot(tr[2], tr[3]) || it.height || 1;
    const len = Math.hypot(tr[0], tr[1]) || 1;
    const u: [number, number] = [tr[0] / len, tr[1] / len];
    const o: [number, number] = [tr[4], tr[5]];
    // some PDFs (Type3 / chunked fonts) report 0 or nonsense widths: estimate instead
    const nChars = [...(it.str || '')].length;
    const w = it.width > 0 && it.width < height * 3 * Math.max(1, nChars) ? it.width : height * 0.55 * nChars;
    if (!it.str || !it.str.trim()) {
      if (cur && it.str === ' ' ) cur.str += ' ';
      continue;
    }
    if (cur) {
      const r = cur.region;
      const t = (o[0] - r.o[0]) * r.u[0] + (o[1] - r.o[1]) * r.u[1];
      const s = -(o[0] - r.o[0]) * r.u[1] + (o[1] - r.o[1]) * r.u[0];
      const gap = t - r.width;
      const sameLine = Math.abs(s) < r.height * 0.2 && Math.abs(height - r.height) < r.height * 0.15 &&
        Math.abs(u[0] - r.u[0]) < 0.01 && Math.abs(u[1] - r.u[1]) < 0.01;
      // a line is one editable run even when the PDF splits it across fonts
      const maxGap = cur.fontName === it.fontName ? 0.7 : 0.6;
      if (sameLine && gap > -r.height * 0.3 && gap < r.height * maxGap) {
        if (gap > r.height * 0.12 && !cur.str.endsWith(' ') && !it.str.startsWith(' ')) cur.str += ' ';
        cur.str += it.str;
        cur.pieces!.push({ at: o[0] * u[0] + o[1] * u[1], str: drawnOrder(it.str, it.dir), w });
        r.width = Math.max(r.width, t + w);
        const fc = (cur.fontChars ??= { [cur.fontName]: [...cur.str].length - [...it.str].length });
        fc[it.fontName] = (fc[it.fontName] ?? 0) + [...it.str].length;
        continue;
      }
      runs.push(cur);
    }
    cur = { key: `${page}:${runs.length}`, page, str: it.str, fontName: it.fontName, region: { o, u, width: w, height }, pieces: [{ at: o[0] * u[0] + o[1] * u[1], str: drawnOrder(it.str, it.dir), w }] };
  }
  if (cur) runs.push(cur);
  mergeNeighbours(runs);
  runs.forEach((r, i) => {
    r.key = `${page}:${i}`;
    // Arabic and Persian: the pieces in the order they are drawn, then read right to left
    if (r.pieces && hasArabic(r.str)) {
      const ps = r.pieces.slice().sort((a, b) => a.at - b.at);
      let vis = '', end = -Infinity;
      for (const p of ps) {
        if (vis && p.at - end > r.region.height * 0.12 && !vis.endsWith(' ') && !p.str.startsWith(' ')) vis += ' ';
        vis += p.str; end = Math.max(end, p.at + p.w);
      }
      r.str = visualToLogical(vis.trim());
    }
    delete r.pieces;
    r.str = r.str.replace(/\s+$/, '').normalize('NFC');
    if (r.fontChars) r.fontName = Object.entries(r.fontChars).sort((a, b) => b[1] - a[1])[0][0];
  });
  return runs;
}
