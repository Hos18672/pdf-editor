// Finding text in the open document (also lines read from scans), and the patterns of the privacy
// check: IBANs, social security numbers, ID and passport numbers, birth dates, phone numbers, e-mails.
import type { TextRun } from '../engine/pdfText';
import type { M } from '../engine/types';

export interface Rect { x: number; y: number; w: number; h: number } // viewport units (scale 1)
export interface Hit { page: number; rects: Rect[]; text: string; kind?: string }

type Seg = { start: number; end: number; quad: [number, number][]; len: number }; // quad: baseline start, baseline end, top end, top start
interface PageText { text: string; segs: Seg[] }

const cache = new WeakMap<object, Map<number, Promise<PageText>>>();

const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** the page's text as one string, with where every piece of it sits */
function pageText(pdf: any, src: number, vm: M, ocrRuns: TextRun[]): Promise<PageText> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  const key = src * 1000 + ocrRuns.length; // read again once a scan's lines are known
  let p = m.get(key);
  if (!p) {
    p = (async () => {
      const segs: Seg[] = [];
      let text = '';
      const push = (str: string, quad: [number, number][], newLine: boolean) => {
        if (!str) return;
        if (text && newLine) text += '\n';
        else if (text && !text.endsWith(' ') && !str.startsWith(' ')) text += ' ';
        segs.push({ start: text.length, end: text.length + str.length, quad, len: str.length });
        text += str;
      };
      if (ocrRuns.length) {
        for (const r of ocrRuns) {
          const [ox, oy] = r.region.o, [ux, uy] = r.region.u, w = r.region.width, h = r.region.height;
          const q: [number, number][] = [[ox, oy - uy * 0], [ox + ux * w, oy + uy * w], [ox + ux * w - uy * h, oy + uy * w + ux * h], [ox - uy * h, oy + ux * h]];
          push(r.str, q.map(([x, y]) => apply(vm, x, y)), true);
        }
      } else {
        const page = await pdf.getPage(src + 1);
        const tc = await page.getTextContent();
        let lastY: number | null = null;
        for (const it of tc.items as any[]) {
          if (typeof it.str !== 'string' || !it.str) { if (it.hasEOL) lastY = null; continue; }
          const [a, b, c, d, e, f] = it.transform;
          const h = Math.hypot(c, d) || Math.hypot(a, b) || 10;
          const len = Math.hypot(a, b) || 1;
          const ux = a / len, uy = b / len, w = it.width ?? 0;
          const desc = h * 0.22, asc = h * 0.82;
          const q: [number, number][] = [
            [e + uy * desc, f - ux * desc], [e + ux * w + uy * desc, f + uy * w - ux * desc],
            [e + ux * w - uy * asc, f + uy * w + ux * asc], [e - uy * asc, f + ux * asc],
          ];
          const newLine = lastY === null || Math.abs(f - lastY) > h * 0.5;
          push(it.str, q.map(([x, y]) => apply(vm, x, y)), newLine);
          lastY = it.hasEOL ? null : f;
        }
      }
      return { text, segs };
    })().catch(() => ({ text: '', segs: [] }));
    m.set(key, p);
  }
  return p;
}

// where a character sits inside a piece of text: measured with a common sans-serif font, which is
// much closer than counting characters (an "i" is narrower than an "M")
let mctx: CanvasRenderingContext2D | null = null;
const share = (str: string, i: number) => {
  if (i <= 0) return 0;
  if (i >= str.length) return 1;
  try {
    mctx ??= document.createElement('canvas').getContext('2d');
    if (!mctx) return i / str.length;
    mctx.font = '100px Arial, Helvetica, sans-serif';
    const all = mctx.measureText(str).width;
    return all > 0 ? mctx.measureText(str.slice(0, i)).width / all : i / str.length;
  } catch { return i / str.length; }
};

/** rectangles (viewport units) covering characters [s, e) of the page text */
function rectsOf(pt: PageText, s: number, e: number): Rect[] {
  const out: Rect[] = [];
  for (const g of pt.segs) {
    if (g.end <= s || g.start >= e) continue;
    const str = pt.text.slice(g.start, g.end);
    const a = share(str, Math.max(0, s - g.start)), b = share(str, Math.min(g.len, e - g.start));
    const [p0, p1, p2, p3] = g.quad;
    const lerp = (u: [number, number], v: [number, number], t: number): [number, number] => [u[0] + (v[0] - u[0]) * t, u[1] + (v[1] - u[1]) * t];
    const pts = [lerp(p0, p1, a), lerp(p0, p1, b), lerp(p3, p2, b), lerp(p3, p2, a)];
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    // a little room at the ends: the measuring font is close to, not the same as, the page's
    const h = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]), pad = h * 0.12;
    out.push({ x: Math.min(...xs) - pad, y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) });
  }
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface DocRef { pdf: any; pages: number[]; vm: (src: number) => M; ocrRuns: (src: number) => TextRun[] }

/** plain text search (case and accents ignored) */
export async function findText(d: DocRef, query: string, limit = 500): Promise<Hit[]> {
  const q = fold(query.trim());
  if (!q) return [];
  const out: Hit[] = [];
  for (const src of d.pages) {
    const pt = await pageText(d.pdf, src, d.vm(src), d.ocrRuns(src));
    const t = fold(pt.text);
    // folding can change lengths only for rare characters; keep indexes aligned by folding per character
    const aligned = t.length === pt.text.length;
    let i = 0;
    while ((i = t.indexOf(q, i)) >= 0 && out.length < limit) {
      const s = i, e = i + q.length;
      out.push({ page: src, rects: aligned ? rectsOf(pt, s, e) : [], text: pt.text.slice(s, e) });
      i = e;
    }
  }
  return out;
}

// ---------------- privacy check ----------------

export type Kind = 'iban' | 'svnr' | 'id' | 'birth' | 'phone' | 'email' | 'card' | 'tax';
export const KIND_LABEL: Record<Kind, [string, string]> = {
  iban: ['Bank accounts', 'IBAN'],
  card: ['Card numbers', 'Credit and debit cards'],
  svnr: ['Social security numbers', 'Sozialversicherungsnummer'],
  id: ['ID and passport numbers', 'Next to Pass, Ausweis, ID, Passport'],
  birth: ['Dates of birth', 'Next to geboren, Geburtsdatum, born'],
  tax: ['Tax numbers', 'Steuernummer, UID'],
  phone: ['Phone numbers', ''],
  email: ['E-mail addresses', ''],
};

const ibanOk = (s: string) => {
  const v = s.replace(/\s+/g, '').toUpperCase();
  if (v.length < 15 || v.length > 34) return false;
  const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (const ch of r) m = (m * 10 + +ch) % 97;
  return m === 1;
};
const luhn = (s: string) => {
  const d = s.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  return sum % 10 === 0;
};
/** Austrian social security number: 3 digits, check digit, birth date DDMMYY */
const svnrOk = (s: string) => {
  const d = s.replace(/\D/g, '');
  if (d.length !== 10) return false;
  const w = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += +d[i] * w[i];
  const dd = +d.slice(4, 6), mm = +d.slice(6, 8);
  return sum % 11 === +d[3] && dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12;
};

const PATTERNS: { kind: Kind; re: RegExp; ok?: (m: string, line: string) => boolean; group?: number }[] = [
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, ok: (m) => ibanOk(m) },
  { kind: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g, ok: (m) => luhn(m) && !/^\d{4} ?\d{6}$/.test(m.trim()) },
  { kind: 'svnr', re: /\b\d{4} ?\d{6}\b/g, ok: (m) => svnrOk(m) },
  { kind: 'tax', re: /\b(?:ATU ?\d{8}|DE ?\d{9})\b/g },
  { kind: 'tax', re: /(?:steuer-?nr\.?|steuernummer|tax (?:id|number)|st\.?-?nr\.?)\s*[:.]?\s*([0-9][0-9 /-]{6,14}[0-9])/gi, group: 1 },
  { kind: 'id', re: /(?:reise)?pass(?:nummer|-?nr\.?)?|ausweis(?:nummer|-?nr\.?)?|personalausweis|passport(?: no\.?| number)?|id(?:-?card)?(?: no\.?| number|-nr\.?)|dokumentennummer|document no\.?/gi, ok: () => true },
  { kind: 'birth', re: /(?:geb(?:oren|\.)?(?: am)?|geburtsdatum|date of birth|born(?: on)?|dob|d\.o\.b\.)\s*[:.]?\s*(\d{1,2}[./-]\s?\d{1,2}[./-]\s?(?:19|20)?\d{2}|\d{1,2}\.? [a-zäöü]+ (?:19|20)\d{2})/gi, group: 1 },
  { kind: 'phone', re: /(?:\+|00)[1-9][\d ()/.-]{7,18}\d|\b0[1-9][\d ()/.-]{6,16}\d\b/g, ok: (m) => (m.match(/\d/g)?.length ?? 0) >= 8 && !/\d{1,2}\.\d{1,2}\.\d{2,4}/.test(m) },
  { kind: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
];
// passport machine-readable lines (MRZ): the whole line
const MRZ = /^[A-Z0-9<]{30,44}$/;

/** Sensitive data in the document, by kind. */
export async function privacyScan(d: DocRef): Promise<Hit[]> {
  const out: Hit[] = [];
  for (const src of d.pages) {
    const pt = await pageText(d.pdf, src, d.vm(src), d.ocrRuns(src));
    const taken: [number, number][] = [];
    const add = (s: number, e: number, kind: Kind) => {
      if (e <= s || taken.some(([a, b]) => s < b && e > a)) return;
      taken.push([s, e]);
      out.push({ page: src, rects: rectsOf(pt, s, e), text: pt.text.slice(s, e), kind });
    };
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(pt.text))) {
        if (p.kind === 'id') {
          // the number after the label (letters and digits, with at least 2 digits)
          const rest = pt.text.slice(m.index + m[0].length, m.index + m[0].length + 40);
          const n = /^\s*(?:nr\.?|no\.?|nummer|number|num\.?)?\s*[:.#]?\s*([A-Z0-9][A-Z0-9-]{4,14}[A-Z0-9])/i.exec(rest);
          if (n && (n[1].match(/\d/g)?.length ?? 0) >= 2) {
            const s = m.index + m[0].length + rest.indexOf(n[1]);
            add(s, s + n[1].length, 'id');
          }
          continue;
        }
        const s = p.group ? m.index + m[0].indexOf(m[p.group]) : m.index;
        const val = p.group ? m[p.group] : m[0];
        if (p.ok && !p.ok(val, pt.text)) continue;
        add(s, s + val.length, p.kind);
      }
    }
    // MRZ lines of passports / ID cards
    let pos = 0;
    for (const line of pt.text.split('\n')) {
      const t = line.replace(/\s/g, '');
      if (MRZ.test(t) && t.includes('<<')) add(pos, pos + line.length, 'id');
      pos += line.length + 1;
    }
  }
  return out;
}
