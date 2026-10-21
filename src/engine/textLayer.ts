import { PDFDocument, PDFFont, PDFPage, StandardFonts, pushGraphicsState, popGraphicsState, beginText, endText,
  setFontAndSize, setTextRenderingMode, TextRenderingMode, setTextMatrix, setCharacterSqueeze, showText } from 'pdf-lib';

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
export async function addTextLayer(doc: PDFDocument, page: PDFPage, lines: LayerLine[], font?: PDFFont): Promise<void> {
  if (!lines.length) return;
  const helv = font ?? (await doc.embedFont(StandardFonts.Helvetica));
  // keep whatever the page's own content leaves on the graphics state away from the layer
  page.node.normalize();
  const key = page.node.newFontDictionary('OcrF', helv.ref);
  const charset = new Set(helv.getCharacterSet());
  const ops: any[] = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
  for (const l of lines) {
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

