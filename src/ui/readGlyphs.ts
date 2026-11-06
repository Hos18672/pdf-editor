// Lines drawn with a font that doesn't say which letters its glyphs are (no ToUnicode map): pdf.js hands
// out glyph numbers instead of letters, so the text is read from the drawn glyphs instead. All such lines
// of a page are cut out of a sharp rendering and read one by one (only the stretches set in such a font).
import type { FontInfo, TextRun } from '../engine/pdfText';
import type { M } from '../engine/types';
import type { OcrWorker } from './ocr';
import { hasArabic, visualToLogical } from '../engine/rtl';
import { readingOrder } from './bidiWords';
import { runBox } from './geometry';
import { loadOcr, persianWorker, recognizeCanvas } from './ocr';

/** the run uses a font without letter information */
export function unreadableRun(r: TextRun, fonts: Record<string, FontInfo>): boolean {
  const fc = r.fontChars ?? { [r.fontName]: [...r.str].length };
  return Object.keys(fc).some((f) => fonts[f]?.unreadable);
}

const cache = new WeakMap<object, Map<number, Promise<Map<string, string>>>>();

/** the text of the given runs, read from the page as drawn (run key → text) */
export function readGlyphRuns(pdf: any, src: number, vm: M, runs: TextRun[], fonts: Record<string, FontInfo>): Promise<Map<string, string>> {
  let m = cache.get(pdf);
  if (!m) cache.set(pdf, (m = new Map()));
  let p = m.get(src);
  if (!p) {
    p = read(pdf, src, vm, runs, fonts).catch(() => new Map<string, string>());
    m.set(src, p);
  }
  return p;
}

/** a piece of a line: text as given, or a stretch (offset, width along the line) to read from the page */
type Unit = { at: number; text?: string; w: number; key?: string; lo?: number; hi?: number };

/** the pieces of a line: stretches in fonts without letter information are read, the rest is kept */
function unitsOf(r: TextRun, fonts: Record<string, FontInfo>): Unit[] {
  const out: Unit[] = [];
  if (!r.parts?.length) out.push({ at: 0, w: r.region.width, key: r.key });
  let given: { at: number; w: number; strs: string[] } | null = null;
  const flush = () => {
    if (!given) return;
    const t = given.strs.join('');
    out.push({ at: given.at, w: given.w, text: hasArabic(t) ? visualToLogical(t) : t });
    given = null;
  };
  const unread = (p: { font: string }) => !fonts[p.font] || !!fonts[p.font].unreadable || !!fonts[p.font].type3;
  (r.parts ?? []).forEach((p, i) => {
    // (a font without any information or a picture font: read too; a full stop or space between two
    // stretches that are read goes with them, so the phrase is read in one piece)
    const last = out[out.length - 1];
    const between = !unread(p) && !/[\p{L}\p{N}]/u.test(p.str) && !given && !!last?.key && r.parts!.slice(i + 1).find((q) => q.str.trim()) && unread(r.parts!.slice(i + 1).find((q) => q.str.trim())!);
    if (unread(p) || between) {
      flush();
      const last = out[out.length - 1];
      // neighbouring stretches (words of one phrase) are read together
      if (last?.key && p.at - (last.at + last.w) < r.region.height * 0.8) last.w = p.at + p.w - last.at;
      else out.push({ at: p.at, w: p.w, key: `${r.key}#${out.length}` });
    } else {
      if (!p.str.trim()) { if (given) given.strs.push(' '); return; }
      if (given && p.at - (given.at + given.w) > r.region.height * 0.12) given.strs.push(' ');
      given ??= { at: p.at, w: 0, strs: [] };
      given.strs.push(p.str);
      given.w = Math.max(given.w, p.at + p.w - given.at);
    }
  });
  flush();
  // room round a stretch that is read: up to the letters given next to it
  const h = r.region.height;
  out.forEach((u, i) => {
    if (!u.key) return;
    const prev = out[i - 1], next = out[i + 1];
    u.lo = prev ? Math.max(prev.at + prev.w + h * 0.04, u.at - h) : u.at - h * 0.6;
    u.hi = next ? Math.min(next.at - h * 0.04, u.at + u.w + h) : u.at + u.w + h * 0.6;
    u.lo = Math.min(u.lo, u.at); u.hi = Math.max(u.hi, u.at + u.w);
  });
  return out;
}

async function read(pdf: any, src: number, vm: M, runs: TextRun[], fonts: Record<string, FontInfo>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const lineUnits = runs.map((r) => ({ r, b: runBox(r, vm), units: unitsOf(r, fonts) })).filter(({ b }) => Math.abs(b.angle) < 0.02 && b.w > 0 && b.h > 0);
  const boxes = lineUnits.flatMap(({ b, units }) => units.filter((u) => u.key).map((u) => ({ key: u.key!, b: { ...b, x: b.x + u.lo!, w: u.hi! - u.lo! } })));
  if (!boxes.length) return out;
  const page = await pdf.getPage(src + 1);
  const base = page.getViewport({ scale: 1 });
  // letters set at about 24 px read best (larger ones are easily missed when a word stands alone)
  const hs = boxes.map(({ b }) => b.h).sort((a, b) => a - b);
  let s = Math.min(6, Math.max(1, 24 / hs[Math.floor(hs.length / 2)]));
  s = Math.min(s, 6000 / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale: s });
  const full = document.createElement('canvas');
  full.width = Math.ceil(vp.width); full.height = Math.ceil(vp.height);
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, full.width, full.height);
  await page.render({ canvasContext: fctx, viewport: vp, annotationMode: 0 }).promise;

  // each stretch on its own, with a white margin round it: just the stretch along the line (letters of
  // other fonts next to it would be half read)
  const crops = boxes.map(({ key, b }) => {
    const pad = b.h * 0.35 * s;
    const x = Math.max(0, Math.floor(b.x * s)), y = Math.max(0, Math.floor((b.y - b.asc) * s - pad * 0.6));
    const w = Math.min(full.width - x, Math.ceil(b.w * s)), h = Math.min(full.height - y, Math.ceil(b.h * 1.2 * s + pad * 1.2));
    return { key, x, y, w, h, m: Math.ceil(Math.max(30, b.h * s * 1.2)) };
  }).filter((c) => c.w > 2 && c.h > 2);
  const readCrop = async (wk: OcrWorker, c: typeof crops[number], k = 1) => {
    const one = document.createElement('canvas');
    one.width = Math.round((c.w + c.m * 2) * k); one.height = Math.round((c.h + c.m * 2) * k);
    const octx = one.getContext('2d', { willReadFrequently: true })!;
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, one.width, one.height);
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(full, c.x, c.y, c.w, c.h, c.m * k, c.m * k, c.w * k, c.h * k);
    try {
      const ls = await recognizeCanvas(wk, one, (px, py) => [px, py], 1 / (s * k));
      return ls.map((l) => l.text.trim()).filter(Boolean).join(' ');
    } catch { return ''; }
  };

  const worker = await loadOcr();
  const got = new Map<string, { x: number; text: string }[]>();
  let ar = 0, la = 0;
  for (const c of crops) {
    const t = await readCrop(worker, c);
    for (const ch of t) { if (hasArabic(ch)) ar++; else if (/[A-Za-z]/.test(ch)) la++; }
    if (t) got.set(c.key, [{ x: 0, text: t }]);
  }
  // mostly Persian: stretches that came back empty or as a few Latin-looking letters (the German and
  // English models guess at a short Persian word) are read again with the Persian model alone. A word on
  // its own is sometimes not found at all at one size: a smaller and a larger one are tried too.
  let fw: OcrWorker | null = null;
  if (ar > la) { try { fw = await persianWorker(); } catch { fw = null; } }
  for (const c of crops) {
    const t = got.get(c.key)?.[0].text ?? '';
    if (fw ? hasArabic(t) || /[A-Za-zÀ-ɏ]{5}/.test(t) || /\d{3}/.test(t) : t) continue;
    for (const k of fw ? [1, 0.7, 1.4] : [0.7, 1.4]) {
      const t2 = await readCrop(fw ?? worker, c, k);
      if (fw ? hasArabic(t2) : t2) { got.set(c.key, [{ x: 0, text: t2 }]); break; }
    }
  }
  const textOf = (key: string) => {
    const parts = got.get(key);
    if (!parts) return '';
    const rtl = parts.filter((p) => hasArabic(p.text)).length * 2 > parts.length;
    parts.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    return parts.map((p) => p.text).join(' ');
  };
  for (const { r, units } of lineUnits) {
    const texts = units.map((u) => ({ text: (u.key ? textOf(u.key) : u.text ?? '').trim() })).filter((u) => u.text);
    if (!units.some((u) => u.key && got.has(u.key))) continue;
    // a full stop or comma given on its own goes right after the word before it
    out.set(r.key, readingOrder(texts).map((u) => u.text).join(' ').replace(/\s+/g, ' ').replace(/ ([.,:;!?،؛؟])(?= |$)/g, '$1').trim());
  }
  return out;
}
