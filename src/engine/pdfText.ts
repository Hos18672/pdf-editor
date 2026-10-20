// Turns pdf.js text content into editable "runs" and works out, for each
// run's font, which characters can be written with the original embedded font.
import * as fontkitNs from '@pdf-lib/fontkit';

// ESM build exports a default object, CJS build exports named members
const fontkit: { create: (data: Uint8Array) => any } = ((fontkitNs as any).default ?? fontkitNs) as any;
import type { FontFamily } from './types';

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
  fontName: string;
  /** PDF user space */
  region: { o: [number, number]; u: [number, number]; width: number; height: number };
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
  if (font.isType3Font) return { loadedName, name, charMap, display, fallback: { family, bold, italic }, cssFallback, gids };

  let fk: any = null;
  if (font.data && !font.missingFile) {
    try { fk = fontkit.create(font.data as any); } catch { fk = null; }
  }
  for (const [code, uni] of toUnicodeEntries(font.toUnicode)) {
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
      if (sameLine && cur.fontName === it.fontName && gap > -r.height * 0.3 && gap < r.height * 0.7) {
        if (gap > r.height * 0.12 && !cur.str.endsWith(' ') && !it.str.startsWith(' ')) cur.str += ' ';
        cur.str += it.str;
        r.width = t + it.width;
        continue;
      }
      runs.push(cur);
    }
    cur = { key: `${page}:${runs.length}`, page, str: it.str, fontName: it.fontName, region: { o, u, width: it.width, height } };
  }
  if (cur) runs.push(cur);
  runs.forEach((r, i) => { r.key = `${page}:${i}`; r.str = r.str.replace(/\s+$/, ''); });
  return runs;
}
