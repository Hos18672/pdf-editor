// Turns scanned pages into a PDF: real paper sizes, ID cards at actual size (front and back on one
// sheet, like a photocopy), optional invisible text so the scan can be searched and edited.
import { FORMATS } from './geom';
import { renderPage, type Quality, type ScanPage } from './engine';

export type PaperOpt = 'auto' | 'a4' | 'letter' | 'fit';
export interface PdfOpts {
  quality: Quality;
  paper: PaperOpt;
  /** ID cards and passports: on an A4 sheet at actual size, or each on a page of its own size */
  cardLayout: 'sheet' | 'card';
  ocr: boolean;
  /** pages already rendered at this quality (done in the background while you review) */
  ready?: (p: ScanPage) => Blob | undefined;
  progress?: (f: number, msg: string) => void;
}

const PT = 72 / 25.4;
const PAPER: Record<'a4' | 'letter', [number, number]> = { a4: [210, 297], letter: [215.9, 279.4] };

/** physical size in mm of a page's image, after its quarter turns */
export function physicalMm(p: ScanPage): [number, number] {
  const odd = p.rot % 2 !== 0;
  const r = odd ? 1 / p.ratio : p.ratio;
  const f = p.format ? FORMATS[p.format] : null;
  if (f?.mm) {
    const [a, b] = f.mm; // a: width of the format as defined
    const long = Math.max(a, b), short = Math.min(a, b);
    return r >= 1 ? [long, short] : [short, long];
  }
  if (p.kind === 'receipt') return r < 1 ? [80, 80 / r] : [80 * r, 80];
  // an unknown sheet: as big as A4's long side allows
  return r < 1 ? [297 * r, 297] : [297, 297 / r];
}

/** JPEG quality per output quality (undefined: the filter's default) */
export const jpegFor = (q: Quality) => (q === 'small' ? 0.72 : q === 'high' ? 0.92 : undefined);

const isCard = (p: ScanPage) => p.format === 'id1' || p.format === 'id3';

/** Groups pages into PDF sheets: an ID card's front and back share one sheet. */
export function sheetsOf(pages: ScanPage[], opts: Pick<PdfOpts, 'cardLayout'>): ScanPage[][] {
  const out: ScanPage[][] = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i], n = pages[i + 1];
    if (opts.cardLayout === 'sheet' && p.kind === 'id' && isCard(p) && n && n.kind === 'id' && isCard(n) && p.side !== 'back' && n.side !== 'front') {
      out.push([p, n]); i++;
    } else out.push([p]);
  }
  return out;
}

export async function buildScanPdf(pages: ScanPage[], opts: PdfOpts): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setProducer('Paginka (scanned on this device)');
  doc.setCreator('Paginka');
  doc.setTitle('Scan');
  const sheets = sheetsOf(pages, opts);
  const ocr = opts.ocr ? await import('../ocr') : null;
  const layer = opts.ocr ? await import('../../engine/textLayer') : null;
  const ocrWorker = ocr ? await ocr.loadOcr((f) => opts.progress?.(f * 0.05, 'Starting text recognition…')) : null;
  const helv = opts.ocr ? await doc.embedFont(StandardFonts.Helvetica) : null;
  let done = 0;
  const total = pages.length;
  for (const sheet of sheets) {
    const cards = sheet.every(isCard);
    const onSheet = cards && opts.cardLayout === 'sheet' && opts.paper !== 'fit';
    // page size
    let pw: number, ph: number;
    const first = physicalMm(sheet[0]);
    if (onSheet) {
      [pw, ph] = opts.paper === 'letter' ? PAPER.letter : PAPER.a4;
    } else if (opts.paper === 'a4' || opts.paper === 'letter') {
      const [a, b] = PAPER[opts.paper];
      [pw, ph] = first[0] > first[1] ? [b, a] : [a, b];
    } else [pw, ph] = first;
    const page = doc.addPage([pw * PT, ph * PT]);
    // where each image goes (mm, from the top-left)
    const slots: { x: number; y: number; w: number; h: number }[] = [];
    if (onSheet) {
      // actual size, centred, stacked with a gap like a photocopy
      const sizes = sheet.map(physicalMm);
      const gap = 18, totalH = sizes.reduce((s, z) => s + z[1], 0) + gap * (sizes.length - 1);
      let y = Math.max(20, (ph - totalH) / 2 - 30);
      for (const [w, h] of sizes) { slots.push({ x: (pw - w) / 2, y, w, h }); y += h + gap; }
    } else {
      const [w, h] = first;
      const k = Math.min(pw / w, ph / h);
      slots.push({ x: (pw - w * k) / 2, y: (ph - h * k) / 2, w: w * k, h: h * k });
    }
    for (let s = 0; s < sheet.length; s++) {
      const p = sheet[s];
      opts.progress?.(0.05 + 0.9 * (done / total), `Page ${done + 1} of ${total}: straightening and cleaning…`);
      let blob = opts.ready?.(p);
      if (!blob) {
        const r = await renderPage(p, { quality: opts.quality, jpeg: jpegFor(opts.quality) });
        URL.revokeObjectURL(r.url);
        blob = r.blob;
      }
      const r = { blob };
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const sl = slots[s];
      const x = sl.x * PT, y = (ph - sl.y - sl.h) * PT, w = sl.w * PT, h = sl.h * PT;
      page.drawImage(img, { x, y, width: w, height: h });
      if (ocrWorker && ocr && layer && helv) {
        opts.progress?.(0.05 + 0.9 * ((done + 0.5) / total), `Page ${done + 1} of ${total}: recognising text…`);
        const bmp = await createImageBitmap(r.blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        const sx = w / c.width, sy = h / c.height;
        try {
          const lines = await ocr.recognizeCanvas(ocrWorker as any, c, (px, py) => [x + px * sx, y + h - py * sy], sx);
          await layer.addTextLayer(doc, page, lines, helv);
        } catch (e) { console.warn('ocr failed on a scanned page', e); }
        c.width = c.height = 0;
      }
      done++;
    }
  }
  opts.progress?.(0.97, 'Writing the PDF…');
  return doc.save({ useObjectStreams: true });
}
