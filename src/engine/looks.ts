// Letters with a look of their own (bold, italic, underline, strike-through, colour) in a line of text.
import type { CharLook } from './types';

/** outline width of fake bold (× font size): a PDF's own font has one face only */
export const FAUX_BOLD = 0.035;
/** slant of fake italic (horizontal shift per unit of height) */
export const FAUX_SLANT = 0.2;
/** underline and strike-through: height above the baseline and thickness (× font size) */
export const UNDER_Y = -0.11, STRIKE_Y = 0.27, DECO_T = 0.06;

/** a per-character array split at the newlines of its text (one array per line) */
export function perLine<T>(text: string, arr?: T[] | null): T[][] | null {
  const chars = [...text];
  if (!arr || arr.length !== chars.length) return null;
  const out: T[][] = [[]];
  chars.forEach((c, i) => { if (c === '\n') out.push([]); else out[out.length - 1].push(arr[i]); });
  return out;
}

export interface Piece {
  t: string;
  /** size × the text's size */
  k: number;
  /** the letters' own look (null: as the text) */
  l: CharLook | null;
}
/** a line in pieces of one size and look each */
export function pieces(line: string, scales?: number[] | null, looks?: (CharLook | null)[] | null): Piece[] {
  const out: Piece[] = [];
  let i = 0, lastKey = '';
  for (const ch of line) {
    const k = scales?.[i] ?? 1, l = looks?.[i] ?? null;
    i++;
    const key = k + '|' + (l ? JSON.stringify(l) : '');
    const last = out[out.length - 1];
    if (last && key === lastKey) last.t += ch;
    else { out.push({ t: ch, k, l: l && Object.keys(l).length ? l : null }); lastKey = key; }
  }
  return out;
}
