import { PDFDocument, PDFFont, PDFPage, StandardFonts, PDFArray, PDFName, PDFOperator, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, setCharacterSqueeze, showText } from 'pdf-lib';
import * as fontkitNs from '@pdf-lib/fontkit';
import { arabicFile, hasArabic, isRtl, visualRuns } from './rtl';

/** One line of recognised (or laid-out) text, in PDF user space of its page. */
export interface LayerLine {
  text: string;
  /** baseline start and end (left → right along the line) */
  x0: number; y0: number; x1: number; y1: number;
  /** font size in points (cap height ≈ 0.72 of it) */
  size: number;
}

/**
 * Adds an invisible text layer (render mode 3, like OCR'd scans) so a page made of pictures can be
 * searched, selected and edited. Each line is stretched to its measured width.
 */
export async function addTextLayer(doc: PDFDocument, page: PDFPage, lines: LayerLine[], font?: PDFFont,
  /** bytes of a shipped font file (for Persian / Arabic lines: Vazirmatn, embedded once per document) */
  fontBytes?: (file: string) => Promise<Uint8Array>): Promise<void> {
  if (!lines.length) return;
  const helv = font ?? (await doc.embedFont(StandardFonts.Helvetica));
  const ar = fontBytes && lines.some((l) => hasArabic(l.text)) ? await arabicLayerFont(doc, fontBytes) : null;
  // keep whatever the page's own content leaves on the graphics state away from the layer
  page.node.normalize();
  // the page may have been rewritten with a single content stream since: appending needs an array
  const contents = page.node.get(PDFName.of('Contents'));
  if (contents && !(page.node.lookup(PDFName.of('Contents')) instanceof PDFArray)) page.node.set(PDFName.of('Contents'), doc.context.obj([contents]));
  const key = page.node.newFontDictionary('OcrF', helv.ref);
  const arKey = ar ? page.node.newFontDictionary('OcrA', ar.ref) : null;
  const charset = new Set(helv.getCharacterSet());
  const ops: any[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const l of lines) {
    if (ar && arKey && hasArabic(l.text)) {
      // Persian / Arabic: the pieces in screen order, letters joined by the font (as real PDFs draw them),
      // so readers find the words; the font's ToUnicode gives the plain letters back
      const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
      const pieces = arabicPieces(ar, l.text.trim(), isRtl(l.text));
      const natural = pieces.reduce((w, t) => w + ar.widthOfTextAtSize(t, l.size), 0);
      if (!len || !natural || !pieces.length) continue;
      const ux = (l.x1 - l.x0) / len, uy = (l.y1 - l.y0) / len;
      ops.push(
        setFontAndSize(arKey, l.size),
        setCharacterSqueeze(Math.max(20, Math.min(400, (len / natural) * 100))),
        setTextMatrix(ux, uy, -uy, ux, l.x0, l.y0),
        PDFOperator.of('TJ' as any, [doc.context.obj(pieces.map((t) => ar.encodeText(t)))]),
      );
      continue;
    }
    const text = [...l.text.normalize('NFC')].map((c) => (charset.has(c.codePointAt(0)!) ? c : '?')).join('').trim();
    if (!text || l.size <= 0) continue;
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    const natural = helv.widthOfTextAtSize(text, l.size);
    if (!len || !natural) continue;
    const ux = (l.x1 - l.x0) / len, uy = (l.y1 - l.y0) / len;
    ops.push(
      setFontAndSize(key, l.size),
      setCharacterSqueeze(Math.max(20, Math.min(400, (len / natural) * 100))),
      setTextMatrix(ux, uy, -uy, ux, l.x0, l.y0),
      showText(helv.encodeText(text)),
    );
  }
  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
}

/** True when a page has no text but shows a picture (scan, photo, image-only export). */
export function pageNeedsText(textItems: { str: string }[]): boolean {
  return !textItems.some((t) => t.str.trim().length > 0);
}

const arFonts = new WeakMap<PDFDocument, Promise<PDFFont | null>>();
function arabicLayerFont(doc: PDFDocument, bytes: (file: string) => Promise<Uint8Array>): Promise<PDFFont | null> {
  let p = arFonts.get(doc);
  if (!p) {
    p = (async () => {
      try {
        doc.registerFontkit(((fontkitNs as any).default ?? fontkitNs) as any);
        return await doc.embedFont(await bytes(arabicFile(false)), { subset: true });
      } catch (e) { console.warn('text layer font', e); return null; }
    })();
    arFonts.set(doc, p);
  }
  return p;
}

/** a line of Arabic-script text as pieces in screen order, ready for the font's shaper (see exporter arabicLine) */
function arabicPieces(af: PDFFont, line: string, rtl: boolean): string[] {
  const runs = visualRuns(line.normalize('NFC'), rtl);
  const fk = (af as any).embedder?.font;
  return runs.map((r) => {
    if (r.rtl || !fk?.layout) return r.text;
    try { return fk.layout(r.text).direction === 'rtl' ? [...r.text].reverse().join('') : r.text; } catch { return r.text; }
  }).filter((t) => t.length);
}
