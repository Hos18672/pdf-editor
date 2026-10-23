// Arabic and Persian text: a shipped font that has the letters (Vazirmatn, with its Latin), letters joined
// by the font's own rules (fontkit, through pdf-lib), and right-to-left lines put in the order they are
// read on screen (the Unicode bidi algorithm), so numbers and Latin words inside stay left-to-right.
import bidiFactory from 'bidi-js';

/** Arabic script: Arabic, Persian, Urdu letters and their presentation forms */
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_LETTER = /[ؠ-يٮ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-﷿ﹰ-ﻼ]/;
/** right-to-left letters (Hebrew included: the first strong letter sets a line's direction) */
const RTL_STRONG = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_STRONG = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

export const hasArabic = (s: string) => ARABIC.test(s);

/** the shipped font for Arabic-script text */
export const arabicFile = (bold: boolean) => (bold ? 'Vazirmatn-Bold.ttf' : 'Vazirmatn-Regular.ttf');
/** baseline below the top of a line (× font size, line height 1.2), as browsers lay Vazirmatn out */
export const ARABIC_BASE = 0.8441;

/** text direction of a paragraph: its first strong letter (as dir="auto" on screen) */
export function isRtl(text: string): boolean {
  for (const ch of text) {
    if (RTL_STRONG.test(ch)) return true;
    if (LTR_STRONG.test(ch)) return false;
  }
  return false;
}

let bidi: ReturnType<typeof bidiFactory> | null = null;

/**
 * One line in screen order: pieces of the same direction, left to right. Each piece's `text` is what to
 * shape: right-to-left pieces with Arabic letters in reading order (the shaper turns them round),
 * everything else already in the order it is drawn.
 */
export function visualRuns(line: string, rtl: boolean): { text: string; rtl: boolean }[] {
  if (!line) return [];
  bidi ??= bidiFactory();
  const emb = bidi.getEmbeddingLevels(line, rtl ? 'rtl' : 'ltr');
  const levels = emb.levels;
  const chars = [...line];
  // code points ↔ UTF-16 offsets (the levels are per UTF-16 unit)
  const unitOf: number[] = [];
  { let u = 0; for (const c of chars) { unitOf.push(u); u += c.length; } }
  // visual order of the characters
  const order = chars.map((_, i) => i);
  const lv = chars.map((_, i) => levels[unitOf[i]]);
  const maxL = Math.max(...lv), minOdd = Math.min(...lv.filter((l) => l % 2 === 1).concat([maxL + 1]));
  for (let L = maxL; L >= Math.max(1, minOdd); L--) {
    for (let i = 0; i < order.length;) {
      if (lv[order[i]] < L) { i++; continue; }
      let j = i;
      while (j < order.length && lv[order[j]] >= L) j++;
      order.splice(i, j - i, ...order.slice(i, j).reverse());
      i = j;
    }
  }
  // consecutive characters of one level form a piece
  const runs: { idx: number[]; rtl: boolean }[] = [];
  for (const i of order) {
    const r = lv[i] % 2 === 1;
    const last = runs[runs.length - 1];
    if (last && last.rtl === r && lv[last.idx[last.idx.length - 1]] === lv[i]) last.idx.push(i);
    else runs.push({ idx: [i], rtl: r });
  }
  return runs.map(({ idx, rtl: r }) => {
    // right-to-left with Arabic letters: reading order (the shaper reverses it); otherwise drawn as listed
    const shaped = r && idx.some((i) => ARABIC_LETTER.test(chars[i]));
    // brackets in right-to-left pieces face the other way (the shaper doesn't turn them)
    const seq = shaped ? [...idx].sort((a, b) => a - b) : idx;
    return { text: seq.map((i) => (r ? MIRROR[chars[i]] ?? chars[i] : chars[i])).join(''), rtl: shaped };
  });
}

const PRESENTATION = /[ﭐ-﷿ﹰ-﻿]/;
const LTR_RUN = /[A-Za-z0-9À-ɏ٠-٩۰-۹]+(?:[ .,:/\-+%٫٬]+[A-Za-z0-9À-ɏ٠-٩۰-۹]+)*/g;
const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };

/**
 * A line of a PDF read left to right as drawn ("visual order", letters often in their joined shapes)
 * into the order it is read and typed: base letters, right to left, numbers and Latin words kept as
 * they are. Lines without Arabic letters are returned unchanged.
 */
export function visualToLogical(visual: string): string {
  if (!ARABIC.test(visual)) return visual;
  // joined shapes → plain letters; a ligature (lam-alef) spelled in drawn order, so it reads right after turning
  const plain = [...visual].map((c) => (PRESENTATION.test(c) ? [...c.normalize('NFKC')].reverse().join('') : c)).join('');
  const turned = [...plain].reverse().map((c) => MIRROR[c] ?? c).join('');
  return turned.replace(LTR_RUN, (m) => [...m].reverse().join(''));
}

/** a piece of text from pdf.js, as drawn left to right (pdf.js gives right-to-left pieces in reading order) */
export const drawnOrder = (str: string, dir?: string) =>
  dir === 'rtl' && /[ء-يٱ-ۓ]/.test(str) ? [...str].reverse().join('') : str;
