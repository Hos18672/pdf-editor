// Words of a line in reading order when Persian / Arabic and Latin text are mixed (text recognition, AI text).

export const BIDI_MARKS = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u061c]/g;
export const AR_LETTER = /[\u0620-\u064a\u066e-\u06d3\u06d5\u06ee\u06ef\u06fa-\u06fc\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufefc]/;
const LTR_MARK = /[A-Za-zÀ-ɏ0-9\u0660-\u0669\u06f0-\u06f9]/;

/**
 * Words of one cell (left to right as printed) in reading order. Persian / Arabic runs right to left, so a
 * right-to-left cell is read from its right end; Latin words and numbers inside keep their own order,
 * and Persian words inside a Latin line are turned round (simplified Unicode bidi, per word).
 */
export function readingOrder<W extends { text: string }>(ws: W[], pageRtl?: boolean): W[] {
  const cls = ws.map((w) => (AR_LETTER.test(w.text) ? 'R' : LTR_MARK.test(w.text) ? 'L' : 'N'));
  const ar = ws.reduce((n, w) => n + [...w.text].filter((c) => AR_LETTER.test(c)).length, 0);
  const la = ws.reduce((n, w) => n + [...w.text].filter((c) => /[A-Za-zÀ-ɏ]/.test(c)).length, 0);
  if (!ar) return ws;
  const strong = cls.filter((c) => c !== 'N');
  const first = strong[0], last = strong[strong.length - 1];
  // the cell's direction: a Latin word at its left end starts a left-to-right line, a Persian word at its
  // right end a right-to-left one; when both (a bilingual label), the page's main script decides
  // (a bilingual label "Visa Type ( نوع روادید )" in a left-to-right form stays left-to-right)
  const rtl = !la ? true : first === 'L' && last === 'R' ? ar > la * 2 || (!!pageRtl && ar > la) : first === 'L' ? false : last === 'R' ? true : ar > la;
  // neutrals (brackets, dashes) between two words of one direction take it, else the cell's
  const dir = cls.map((c, i) => {
    if (c !== 'N') return c;
    const before = cls.slice(0, i).reverse().find((x) => x !== 'N'), after = cls.slice(i + 1).find((x) => x !== 'N');
    return before && before === after ? before : rtl ? 'R' : 'L';
  });
  const order = ws.map((_, i) => i);
  const flip = rtl ? 'L' : 'R';
  if (rtl) order.reverse();
  // runs against the cell's direction keep (L in R) / get (R in L) their own reading order
  const d = order.map((i) => dir[i]);
  for (let i = 0; i < order.length;) {
    if (d[i] !== flip) { i++; continue; }
    let j = i;
    while (j < order.length && d[j] === flip) j++;
    order.splice(i, j - i, ...order.slice(i, j).reverse());
    i = j;
  }
  return order.map((i) => ws[i]);
}

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '«': '»', '»': '«' };
const balanced = (s: string) => {
  let d = 0;
  for (const c of s) { if ('([{«'.includes(c)) d++; else if (')]}»'.includes(c) && --d < 0) return false; }
  return d === 0;
};
/** Brackets next to Persian words come out of the reader as seen right to left (")نام(" for "(نام)"): turn them round when only that makes them pair up. */
export function fixBrackets(s: string): string {
  if (!/[()[\]{}«»]/.test(s) || balanced(s)) return s;
  const m = [...s].map((c) => MIRROR[c] ?? c).join('');
  if (balanced(m)) return m;
  // one pair of round brackets facing the wrong way at one end: "Date ) تاریخ )"
  const at = [...s].flatMap((c, i) => ('()'.includes(c) ? [i] : []));
  if (at.length === 2 && !/[[\]{}«»]/.test(s)) {
    const cs = [...s];
    cs[at[0]] = '('; cs[at[1]] = ')';
    return cs.join('');
  }
  return s;
}
