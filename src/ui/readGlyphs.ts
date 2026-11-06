// Lines drawn with a font that doesn't say which letters its glyphs are (no ToUnicode map): pdf.js hands
// out glyph numbers instead of letters, so the text is read from the drawn glyphs instead. All such lines
// of a page are cut out of a sharp rendering and read one by one (only the stretches set in such a font).
import { badText, FontInfo, TextRun } from '../engine/pdfText';
import type { M } from '../engine/types';
import type { OcrWorker } from './ocr';
import { hasArabic, visualToLogical } from '../engine/rtl';
import { fixBrackets, readingOrder } from './bidiWords';
import { runBox } from './geometry';
import { loadOcr, persianWorker, recognizeCanvas } from './ocr';

/** the run uses a font without letter information */
export function unreadableRun(r: TextRun, fonts: Record<string, FontInfo>): boolean {
  if (r.parts?.length) return r.parts.some((p) => badText(p.str, fonts[p.font]));
  return badText(r.str, fonts[r.fontName]);
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
type Unit = { at: number; text?: string; w: number; key?: string; lo?: number; hi?: number; raw?: string };

/** the pieces of a line: stretches in fonts without letter information are read, the rest is kept */
let mctx: CanvasRenderingContext2D | null = null;
/** width of text in a run's font (PDF units) */
function widthOf(t: string, f: FontInfo | undefined, size: number): number {
  mctx ??= document.createElement('canvas').getContext('2d');
  if (!mctx) return size * 0.5 * t.length;
  mctx.font = `100px ${f?.editFamily ? `"${f.editFamily}", ` : ''}${f?.cssFallback ?? 'Arial, sans-serif'}`;
  return (mctx.measureText(t).width / 100) * size;
}

/**
 * A piece with wrong letters that starts (as seen on the page) with plain Latin text, a label like
 * "Date of Birth ( تاریخ تولد )" in one piece: the Latin part is given correctly and kept, only the rest
 * is read.
 */
function splitLatin(p: NonNullable<TextRun['parts']>[number], f: FontInfo | undefined, size: number) {
  if (!badText(p.str, f)) return [p];
  const m = p.rtl ? /[\x20-\x7e]+$/.exec(p.str) : /^[\x20-\x7e]+/.exec(p.str);
  if (!m || (m[0].match(/[A-Za-z0-9]/g)?.length ?? 0) < 3 || m[0].length >= p.str.length) return [p];
  // the Latin text, without the bracket that opens the read part (it is read with it)
  const latin = m[0].replace(/^[\s()[\]]+|[\s()[\]]+$/g, '');
  if (!latin) return [p];
  const lw = Math.min(p.w * 0.9, widthOf(latin, f, size));
  return [{ ...p, w: lw, str: latin, rtl: false, given: true }, { ...p, at: p.at + lw, w: p.w - lw, str: p.rtl ? p.str.slice(0, m.index) : p.str.slice(m[0].length) }];
}

function unitsOf(r: TextRun, fonts: Record<string, FontInfo>): Unit[] {
  const out: Unit[] = [];
  const parts = (r.parts ?? []).flatMap((p) => splitLatin(p, fonts[p.font], r.region.height)) as (NonNullable<TextRun['parts']>[number] & { given?: boolean })[];
  if (!parts.length) out.push({ at: 0, w: r.region.width, key: r.key, raw: r.str });
  let given: { at: number; w: number; strs: string[] } | null = null;
  const flush = () => {
    if (!given) return;
    const t = given.strs.join('');
    out.push({ at: given.at, w: given.w, text: hasArabic(t) ? visualToLogical(t) : t });
    given = null;
  };
  const unread = (p: { font: string; str: string; given?: boolean }) => !p.given && (!fonts[p.font] || !!fonts[p.font].type3 || badText(p.str, fonts[p.font]));
  parts.forEach((p, i) => {
    // (a font without any information or a picture font: read too; a full stop or space between two
    // stretches that are read goes with them, so the phrase is read in one piece)
    const last = out[out.length - 1];
    const between = !unread(p) && !/[\p{L}\p{N}]/u.test(p.str) && !given && !!last?.key && parts.slice(i + 1).find((q) => q.str.trim()) && unread(parts.slice(i + 1).find((q) => q.str.trim())!);
    if (unread(p) || between) {
      flush();
      const last = out[out.length - 1];
      // neighbouring stretches (words of one phrase) are read together
      if (last?.key && p.at - (last.at + last.w) < r.region.height * 0.8) { last.w = p.at + p.w - last.at; last.raw += p.str; }
      else out.push({ at: p.at, w: p.w, key: `${r.key}#${out.length}`, raw: p.str });
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
  const boxes = lineUnits.flatMap(({ b, units }) => units.filter((u) => u.key).map((u) => ({ key: u.key!, raw: u.raw ?? '', b: { ...b, x: b.x + u.lo!, w: u.hi! - u.lo! } })));
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
  const crops = boxes.map(({ key, raw, b }) => {
    const pad = b.h * 0.35 * s;
    const x = Math.max(0, Math.floor(b.x * s)), y = Math.max(0, Math.floor((b.y - b.asc) * s - pad * 0.6));
    const w = Math.min(full.width - x, Math.ceil(b.w * s)), h = Math.min(full.height - y, Math.ceil(b.h * 1.2 * s + pad * 1.2));
    return { key, raw, x, y, w, h, m: Math.ceil(Math.max(30, b.h * s * 1.2)) };
  }).filter((c) => c.w > 2 && c.h > 2);
  const splitKeys = new Set<string>();
  const readCrop = async (wk: OcrWorker, c: typeof crops[number], k = 1) => {
    const one = document.createElement('canvas');
    one.width = Math.round((c.w + c.m * 2) * k); one.height = Math.round((c.h + c.m * 2) * k);
    const octx = one.getContext('2d', { willReadFrequently: true })!;
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, one.width, one.height);
    octx.imageSmoothingQuality = 'high';
    // light letters on a dark band: turned into dark on light (the reader expects that), the rest white
    const src = full.getContext('2d', { willReadFrequently: true })!.getImageData(c.x, c.y, c.w, c.h);
    // (the background is what most of the stretch is)
    const hist = new Uint32Array(256);
    for (let i = 0; i < src.data.length; i += 4) hist[Math.round(src.data[i] * 0.3 + src.data[i + 1] * 0.59 + src.data[i + 2] * 0.11)]++;
    let bgLum = 0;
    for (let v = 0, n = 0; v < 256; v++) { n += hist[v]; if (n * 2 >= c.w * c.h) { bgLum = v; break; } }
    if (bgLum < 128) {
      // (the band becomes white like the margin round it, the letters black)
      for (let i = 0; i < src.data.length; i += 4) {
        const l = src.data[i] * 0.3 + src.data[i + 1] * 0.59 + src.data[i + 2] * 0.11;
        src.data[i] = src.data[i + 1] = src.data[i + 2] = 255 - Math.max(0, Math.min(255, ((l - bgLum) / Math.max(1, 255 - bgLum)) * 255));
      }
      const tmp = document.createElement('canvas'); tmp.width = c.w; tmp.height = c.h;
      tmp.getContext('2d')!.putImageData(src, 0, 0);
      octx.drawImage(tmp, 0, 0, c.w, c.h, c.m * k, c.m * k, c.w * k, c.h * k);
    } else octx.drawImage(full, c.x, c.y, c.w, c.h, c.m * k, c.m * k, c.w * k, c.h * k);
    try {
      const ls = await recognizeCanvas(wk, one, (px, py) => [px, py], 1 / (s * k));
      // pieces of the stretch read as separate lines: in reading order (right to left for Persian)
      const rtl = ls.filter((l) => hasArabic(l.text)).length * 2 > ls.length;
      const t = ls.slice().sort((a, b) => (rtl ? b.x0 - a.x0 : a.x0 - b.x0)).map((l) => l.text.trim()).filter(Boolean).join(' ');
      if (ls.length > 1) splitKeys.add(c.key);
      return t;
    } catch { return ''; }
  };
  // how good a reading is: its letters, less any Latin ones the PDF doesn't have there (guesses at Persian)
  const score = (t: string, raw: string) => (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) - (/[A-Za-z0-9]/.test(raw) ? 0 : 3 * (t.match(/[A-Za-z0-9]/g)?.length ?? 0));

  const worker = await loadOcr();
  const got = new Map<string, { x: number; text: string }[]>();
  let ar = 0, la = 0;
  for (const c of crops) {
    let t = await readCrop(worker, c);
    // one stretch read as several pieces: a word between them was probably missed; other sizes may get it
    if (splitKeys.has(c.key)) {
      for (const k of [0.7, 1.4]) { const t2 = await readCrop(worker, c, k); if (score(t2, c.raw) > score(t, c.raw)) t = t2; }
    }
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
    // Latin letters and digits the PDF gives for the stretch are right; any others the reader found there
    // are a guess at Persian ("ورود" read as "233"), and a Persian word it took for Latin is dropped
    // ("بیمه" in a long line): a stretch without Latin of its own is read with the Persian model as well,
    // and the reading with more Persian letters wins
    const latinOk = /[A-Za-z0-9]/.test(c.raw);
    if (fw && !latinOk) {
      let best = t;
      for (const k of [1, 0.7, 1.4]) {
        const t2 = await readCrop(fw, c, k);
        if (score(t2, c.raw) > score(best, c.raw)) best = t2;
        if (hasArabic(best) && k === 1 && score(best, c.raw) >= score(t, c.raw) && !/[A-Za-z]/.test(best)) break;
      }
      if (best !== t) got.set(c.key, [{ x: 0, text: best }]);
      continue;
    }
    if (fw ? hasArabic(t) : t) continue;
    for (const k of fw ? [1, 0.7, 1.4] : [0.7, 1.4]) {
      const t2 = await readCrop(fw ?? worker, c, k);
      if (fw ? hasArabic(t2) : t2) { got.set(c.key, [{ x: 0, text: t2 }]); break; }
    }
  }
  const textOf = (key: string) => {
    const parts = got.get(key);
    if (!parts) return '';
    // Persian text: the reader sometimes gives the Arabic forms of yeh and kaf, or both yehs for one letter
    for (const p of parts) if (/[پچژگکی]/.test(p.text)) p.text = p.text.replace(/ي(?=ی)|(?<=ی)ي/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
    const rtl = parts.filter((p) => hasArabic(p.text)).length * 2 > parts.length;
    parts.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
    return parts.map((p) => p.text).join(' ');
  };
  for (const { r, units } of lineUnits) {
    const texts = units.map((u) => ({ text: (u.key ? textOf(u.key) : u.text ?? '').trim() })).filter((u) => u.text);
    if (!units.some((u) => u.key && got.has(u.key))) continue;
    // a full stop or comma given on its own goes right after the word before it
    out.set(r.key, fixBrackets(readingOrder(texts).map((u) => u.text).join(' ').replace(/\s+/g, ' ').replace(/ ([.,:;!?،؛؟])(?= |$)/g, '$1').trim()));
  }
  return out;
}
