import { withCmap } from '../engine/sfnt';
import type { FontInfo, TextRun } from '../engine/pdfText';
import type { DocFont, FontFamily } from '../engine/types';
import { matchFor, matchFile, wholeMatch, arabicText, MatchFont, MATCH_X } from '../engine/matchFonts';
import { arabicFile } from '../engine/rtl';
import { appBase } from './assets';

const registered = new Map<string, Promise<string | undefined>>();

/**
 * Register the document's embedded font again under a new name with a Unicode
 * cmap, so typed text renders in the original font. Resolves to the CSS family
 * name, or undefined when the font can't be used this way.
 */
export function registerEditFont(info: FontInfo, pdfjsFont: any): Promise<string | undefined> {
  const key = info.loadedName;
  if (registered.has(key)) return registered.get(key)!;
  const p = (async () => {
    const data: Uint8Array | undefined = pdfjsFont?.data;
    const entries = Object.entries(info.gids);
    if (!data || !entries.length || typeof FontFace === 'undefined') return undefined;
    try {
      const map = new Map<number, number>();
      for (const [ch, gid] of entries) map.set(ch.codePointAt(0)!, gid);
      const bytes = withCmap(data, map);
      const family = `pdfedit_${key.replace(/[^\w-]/g, '_')}`;
      const face = new FontFace(family, bytes.buffer as ArrayBuffer);
      await face.load();
      (document as any).fonts.add(face);
      return family;
    } catch {
      return undefined;
    }
  })();
  registered.set(key, p);
  return p;
}

const metricCache = new Map<string, { a: number; d: number }>();
let measureCtx: CanvasRenderingContext2D | null = null;

/** Font ascent / descent as a fraction of font size, as the browser lays it out. */
export function fontMetrics(fontCss: string): { a: number; d: number } {
  const hit = metricCache.get(fontCss);
  if (hit) return hit;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  let m = { a: 0.9, d: 0.22 };
  if (measureCtx) {
    measureCtx.font = `100px ${fontCss}`;
    const t: any = measureCtx.measureText('Hg');
    if (typeof t.fontBoundingBoxAscent === 'number' && t.fontBoundingBoxAscent > 0) {
      m = { a: t.fontBoundingBoxAscent / 100, d: t.fontBoundingBoxDescent / 100 };
    }
  }
  // only cache once the font is actually available (otherwise metrics are the fallback's)
  const fam = fontCss.split(',')[0].trim();
  try { if ((document as any).fonts?.check?.(`16px ${fam}`)) metricCache.set(fontCss, m); } catch { /* ignore */ }
  return m;
}

/** Offset of the baseline from the top of a line box with the given line height. */
export function baselineInLine(fontCss: string, size: number, lineHeight: number) {
  const { a, d } = fontMetrics(fontCss);
  return (lineHeight - (a + d) * size) / 2 + a * size;
}

/** "ABCDEF+Calibri-Bold" → "Calibri Bold" */
export const plainFontName = (name?: string) =>
  (name || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Regular|Roman)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_,]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * A font of the document for new text, picked from a line written in it (null: it can't be used:
 * not loaded on screen, a scan's invisible text, or too few letters).
 * Other subsets of the same font on that page fill in letters the main one lacks.
 */
export function docFontOf(run: TextRun, fonts: Record<string, FontInfo>, pageRuns: TextRun[], fontName = run.fontName): DocFont | null {
  const info = fonts[fontName];
  if (!info?.editFamily || fontName === 'ocr' || /GlyphLess/i.test(info.name)) return null;
  if (Object.keys(info.charMap).length < 3) return null;
  const name = plainFontName(info.name);
  const siblings = new Set<string>();
  for (const r of pageRuns) {
    for (const n of [r.fontName, ...Object.keys(r.fontChars ?? {})]) {
      const f = fonts[n];
      if (n !== fontName && f?.editFamily && name && plainFontName(f.name) === name) siblings.add(f.editFamily);
    }
  }
  const match = matchFor(info.name, info.fallback);
  matchFace(match);
  const css = [info.editFamily, ...siblings].map((f) => `"${f}"`).join(', ') + ', ' + matchCss(match) + ', ' + info.cssFallback;
  const { a, d } = fontMetrics(css);
  const chars = new Set(Object.keys(info.charMap));
  for (const f of Object.values(fonts)) if (f.editFamily && siblings.has(f.editFamily)) Object.keys(f.charMap).forEach((c) => chars.add(c));
  // letter height of the document font, so a shipped font of another design is drawn as large
  let matchScale = 1;
  if (!match.same) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    const probe = chars.has('x') ? 0 : chars.has('H') ? 1 : -1;
    if (measureCtx && probe >= 0) {
      measureCtx.font = `100px "${info.editFamily}"`;
      const h = (measureCtx.measureText(probe ? 'H' : 'x') as any).actualBoundingBoxAscent / 100;
      if (h > 0.2 && h < 1) matchScale = Math.max(0.8, Math.min(1.3, h / MATCH_X[match.family][probe ? 1 : 0]));
    }
  }
  return {
    key: fontName, label: name || 'Document font', name: info.name, page: run.page, region: run.region,
    charMap: info.charMap, css, base: (1.2 - (a + d)) / 2 + a, chars: [...chars].join(''), match, matchScale,
  };
}

const faces = new Map<string, Promise<void>>();
const matchFamilyName = (m: MatchFont) => `pe-match-${m.family}-${m.cut}`;
const matchCss = (m: MatchFont) => `"${matchFamilyName(m)}"`;
/** load a shipped font for the screen (once) */
export function matchFace(m: MatchFont): Promise<void> {
  const file = matchFile(m);
  if (!faces.has(file)) {
    faces.set(file, (async () => {
      if (typeof FontFace === 'undefined') return;
      try {
        const face = new FontFace(matchFamilyName(m), `url("${appBase()}fonts/match/${file}")`);
        await face.load();
        (document as any).fonts.add(face);
      } catch { /* not available: the stand-in shows */ }
    })());
  }
  return faces.get(file)!;
}

/** bytes of a shipped font, for the saved file (XHR: fetch() can't read the Android app's file:// pages) */
export function matchFontBytes(file: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', `${appBase()}fonts/match/${file}`);
    x.responseType = 'arraybuffer';
    x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? resolve(new Uint8Array(x.response)) : reject(new Error('font ' + file)));
    x.onerror = () => reject(new Error('font ' + file));
    x.send();
  });
}

/** the shipped Arabic font on screen (regular and bold under one name, so the weight picks the file) */
export const ARABIC_CSS = '"pe-arabic"';
let arabicLoaded: Promise<void> | null = null;
export function arabicFace(): Promise<void> {
  arabicLoaded ??= (async () => {
    if (typeof FontFace === 'undefined') return;
    await Promise.all([false, true].map(async (bold) => {
      try {
        const face = new FontFace('pe-arabic', `url("${appBase()}fonts/match/${arabicFile(bold)}")`, { weight: bold ? '700' : '400' });
        await face.load();
        (document as any).fonts.add(face);
      } catch { /* not available: a system font shows */ }
    }));
  })();
  return arabicLoaded;
}

/** CSS font-family of a text object */
export const objectFontCss = (o: { text: string; family: FontFamily; font?: DocFont }) => {
  if (arabicText(o)) { arabicFace(); return `${ARABIC_CSS}, ${FAMILY_CSS[o.family]}`; }
  return !o.font ? FAMILY_CSS[o.family] : wholeMatch(o) ? `${matchCss(o.font.match)}, ${FAMILY_CSS[o.family]}` : o.font.css;
};

export const FAMILY_CSS: Record<FontFamily, string> = {
  Helvetica: 'Arial, Helvetica, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};
