// Font metrics read straight from the PDF font dictionaries (via pdf-lib).
// Used to locate each glyph precisely inside the content stream.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRef, PDFContext } from 'pdf-lib';
import { Font as StdFont, Encodings } from '@pdf-lib/standard-fonts';

export interface FontMetrics {
  bytesPerCode: 1 | 2;
  /** width of a char code in text-space units (already /1000 for normal fonts) */
  width: (code: number) => number;
  isType3: boolean;
  baseFont: string;
}

const STD_ALIASES: Record<string, string> = {
  Arial: 'Helvetica', 'Arial,Bold': 'Helvetica-Bold', 'Arial,Italic': 'Helvetica-Oblique',
  'Arial,BoldItalic': 'Helvetica-BoldOblique', TimesNewRoman: 'Times-Roman',
  'TimesNewRoman,Bold': 'Times-Bold', 'TimesNewRoman,Italic': 'Times-Italic',
  'TimesNewRoman,BoldItalic': 'Times-BoldItalic', CourierNew: 'Courier',
  'CourierNew,Bold': 'Courier-Bold',
};
const STD_NAMES = new Set([
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique', 'Helvetica', 'Helvetica-Bold',
  'Helvetica-Oblique', 'Helvetica-BoldOblique', 'Times-Roman', 'Times-Bold', 'Times-Italic',
  'Times-BoldItalic', 'Symbol', 'ZapfDingbats',
]);

let winAnsiNames: Map<number, string> | null = null;
function winAnsiCodeToName(code: number): string | undefined {
  if (!winAnsiNames) {
    winAnsiNames = new Map();
    const enc = Encodings.WinAnsi;
    for (let cp = 0; cp < 0x2200; cp++) {
      if (enc.canEncodeUnicodeCodePoint(cp)) {
        const g = enc.encodeUnicodeCodePoint(cp);
        winAnsiNames.set(g.code, g.name);
      }
    }
  }
  return winAnsiNames.get(code);
}

const num = (ctx: PDFContext, o: unknown): number | undefined => {
  const v = o instanceof PDFRef ? ctx.lookup(o) : o;
  return v instanceof PDFNumber ? v.asNumber() : undefined;
};
const arr = (ctx: PDFContext, o: unknown): PDFArray | undefined => {
  const v = o instanceof PDFRef ? ctx.lookup(o) : o;
  return v instanceof PDFArray ? v : undefined;
};
const dict = (ctx: PDFContext, o: unknown): PDFDict | undefined => {
  const v = o instanceof PDFRef ? ctx.lookup(o) : o;
  return v instanceof PDFDict ? v : undefined;
};

export function readFontMetrics(ctx: PDFContext, fontDict: PDFDict): FontMetrics {
  const subtype = fontDict.get(PDFName.of('Subtype'))?.toString() ?? '';
  const baseFont = (fontDict.get(PDFName.of('BaseFont'))?.toString() ?? '').replace(/^\//, '');

  if (subtype === '/Type0') {
    const desc = arr(ctx, fontDict.get(PDFName.of('DescendantFonts')));
    const cid = desc ? dict(ctx, desc.get(0)) : undefined;
    const dw = (cid && num(ctx, cid.get(PDFName.of('DW')))) ?? 1000;
    const widths = new Map<number, number>();
    const w = cid ? arr(ctx, cid.get(PDFName.of('W'))) : undefined;
    if (w) {
      let k = 0;
      while (k < w.size()) {
        const first = num(ctx, w.get(k));
        const next = w.get(k + 1);
        const nextArr = arr(ctx, next);
        if (first === undefined) break;
        if (nextArr) {
          for (let j = 0; j < nextArr.size(); j++) widths.set(first + j, num(ctx, nextArr.get(j)) ?? dw);
          k += 2;
        } else {
          const last = num(ctx, next) ?? first;
          const wv = num(ctx, w.get(k + 2)) ?? dw;
          for (let c = first; c <= last; c++) widths.set(c, wv);
          k += 3;
        }
      }
    }
    // Identity-H/V and most CJK CMaps use 2-byte codes; CID == code for Identity.
    return { bytesPerCode: 2, width: (c) => (widths.get(c) ?? dw) / 1000, isType3: false, baseFont };
  }

  const isType3 = subtype === '/Type3';
  const first = num(ctx, fontDict.get(PDFName.of('FirstChar'))) ?? 0;
  const ws = arr(ctx, fontDict.get(PDFName.of('Widths')));
  let scale = 1 / 1000;
  if (isType3) {
    const fm = arr(ctx, fontDict.get(PDFName.of('FontMatrix')));
    scale = fm ? num(ctx, fm.get(0)) ?? 0.001 : 0.001;
  }
  const fd = dict(ctx, fontDict.get(PDFName.of('FontDescriptor')));
  const missing = (fd && num(ctx, fd.get(PDFName.of('MissingWidth')))) ?? 0;

  if (ws) {
    const list: number[] = [];
    for (let k = 0; k < ws.size(); k++) list.push(num(ctx, ws.get(k)) ?? missing);
    return {
      bytesPerCode: 1,
      width: (c) => (c >= first && c - first < list.length ? list[c - first] : missing) * scale,
      isType3,
      baseFont,
    };
  }

  // Standard 14 fonts without /Widths
  const clean = baseFont.replace(/^[A-Z]{6}\+/, '');
  const stdName = STD_NAMES.has(clean) ? clean : STD_ALIASES[clean];
  if (stdName) {
    const f = StdFont.load(stdName as any);
    return {
      bytesPerCode: 1,
      width: (c) => {
        const name = winAnsiCodeToName(c);
        const w = name ? f.getWidthOfGlyph(name) : undefined;
        return (w ?? 500) / 1000;
      },
      isType3,
      baseFont,
    };
  }
  return { bytesPerCode: 1, width: () => 0.5, isType3, baseFont };
}

/** Parse a ToUnicode CMap into unicode char (NFC) -> char code. Only single-character targets. */
export function parseToUnicode(data: Uint8Array): Record<string, number> {
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  const out: Record<string, number> = {};
  const uni = (hex: string) => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) units.push(parseInt(hex, 16));
    return String.fromCharCode(...units).normalize('NFC');
  };
  const put = (code: number, str: string) => {
    if ([...str].length !== 1 || out[str] !== undefined) return;
    out[str] = code;
  };
  for (const blk of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) put(parseInt(m[1], 16), uni(m[2]));
  }
  for (const blk of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 0xffff);
      if (m[3].startsWith('[')) {
        const items = [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]);
        items.forEach((h, i) => lo + i <= hi && put(lo + i, uni(h)));
      } else {
        const base = m[3].slice(1, -1);
        const head = base.slice(0, -4), last = parseInt(base.slice(-4) || '0', 16);
        for (let c = lo; c <= hi; c++) put(c, uni(head + (last + c - lo).toString(16).padStart(4, '0')));
      }
    }
  }
  return out;
}
