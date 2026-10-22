// Full fonts that ship with the app (public/fonts/match, Latin): they write the letters a document's
// own (subset) font lacks. Metric-compatible with the common office fonts, so mixed in they don't show.
import type { DocFont, FontFamily } from './types';

export type MatchFamily = 'Arimo' | 'Tinos' | 'Cousine' | 'Carlito' | 'Caladea';
export type MatchCut = 'Regular' | 'Bold' | 'Italic' | 'BoldItalic';
export interface MatchFont { family: MatchFamily; cut: MatchCut; /** the same design as the document's font */ same: boolean }

/** baseline below the top of a line (× font size, line height 1.2), as browsers lay the fonts out */
export const MATCH_BASE: Record<MatchFamily, number> = { Arimo: 0.9467, Tinos: 0.9374, Cousine: 0.8661, Carlito: 0.9418, Caladea: 0.925 };
/** same for the standard fonts */
export const BASELINE: Record<FontFamily, number> = { Helvetica: 0.947, Times: 0.938, Courier: 0.867 };

/** height of a lowercase x and of a capital H (× font size) */
export const MATCH_X: Record<MatchFamily, [number, number]> = { Arimo: [0.528, 0.688], Tinos: [0.459, 0.655], Cousine: [0.528, 0.659], Carlito: [0.478, 0.642], Caladea: [0.467, 0.667] };

export const matchFile = (m: MatchFont) => `${m.family}-${m.cut}.ttf`;

/** the shipped font closest to a document font (by its name, else by its kind) */
export function matchFor(name: string, fb: { family: FontFamily; bold: boolean; italic: boolean }): MatchFont {
  const n = name.toLowerCase().replace(/[\s_-]+/g, '');
  const bold = fb.bold || /bold|black|heavy|semibold|demi/.test(n);
  const italic = fb.italic || /italic|oblique/.test(n);
  const cut: MatchCut = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const known: [RegExp, MatchFamily][] = [
    [/calibri|carlito/, 'Carlito'], [/cambria|caladea/, 'Caladea'],
    [/arial|helvetica|liberationsans|arimo|nimbussans|arialmt/, 'Arimo'],
    [/timesnewroman|times|liberationserif|tinos|nimbusrom/, 'Tinos'],
    [/couriernew|courier|liberationmono|cousine|nimbusmono/, 'Cousine'],
  ];
  for (const [re, family] of known) if (re.test(n)) return { family, cut, same: true };
  const family: MatchFamily = fb.family === 'Courier' ? 'Cousine' : fb.family === 'Times' ? 'Tinos' : 'Arimo';
  return { family, cut, same: false };
}

type TextObj = { text: string; family: FontFamily; font?: DocFont };

/**
 * A document font of another design that lacks some typed letters: the whole text is written with
 * the shipped font instead (a few odd letters in between would stand out more).
 */
export const wholeMatch = (o: TextObj) =>
  !!o.font && !o.font.match.same && [...o.text].some((ch) => !/\s/.test(ch) && !o.font!.chars.includes(ch));

/** font size the text is written at: a shipped font of another design is sized to the document font's letter height */
export const textSize = (o: TextObj & { size: number }) => (wholeMatch(o) ? o.size * (o.font!.matchScale ?? 1) : o.size);

/** where the baseline of a text object's first line sits below its top (× font size) */
export const textBase = (o: TextObj) => (wholeMatch(o) ? MATCH_BASE[o.font!.match.family] : o.font ? o.font.base : BASELINE[o.family]);
