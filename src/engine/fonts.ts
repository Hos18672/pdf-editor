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
