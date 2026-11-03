// A payment code for an invoice ("Zahlen mit Code", GiroCode / EPC QR): banking apps read recipient,
// IBAN, amount and reference from it, so the invoice is paid without typing. Made on the device.
import qrcode from 'qrcode-generator';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface PayInfo { name: string; iban: string; bic: string; amount: string; ref: string; text: string }

export const cleanIban = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** IBAN check digits (mod 97) */
export function ibanOk(s: string): boolean {
  const v = cleanIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  const r = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let m = 0;
  for (let i = 0; i < r.length; i += 7) m = Number(String(m) + r.slice(i, i + 7)) % 97;
  return m === 1;
}

/** "1.250,00" / "1,250.00" / "1250" → 1250 (null: not an amount) */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[^\d.,]/g, '');
  if (!t) return null;
  let v: number;
  if (/,\d{1,2}$/.test(t)) v = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  else if (/\.\d{1,2}$/.test(t)) v = parseFloat(t.replace(/,/g, ''));
  else v = parseFloat(t.replace(/[.,]/g, ''));
  return isFinite(v) && v > 0 && v < 1e9 ? Math.round(v * 100) / 100 : null;
}

/** the EPC text (version 002, UTF-8): what the QR code holds */
export function epcPayload(p: PayInfo): string {
  const amount = parseAmount(p.amount);
  const ref = p.ref.trim();
  // a structured creditor reference (RF…) goes in its own line, anything else is the payment text
  const structured = /^RF\d{2}[A-Z0-9]{1,21}$/i.test(ref.replace(/\s+/g, ''));
  // (the standard allows one or the other, not both)
  const text = structured ? '' : [ref, p.text.trim()].filter(Boolean).join(' ').slice(0, 140);
  return ['BCD', '002', '1', 'SCT', p.bic.trim().toUpperCase(), p.name.trim().slice(0, 70), cleanIban(p.iban),
    amount ? `EUR${amount.toFixed(2)}` : '', '', structured ? ref.replace(/\s+/g, '').toUpperCase() : '', text].join('\n').replace(/\n+$/, '');
}

/** the QR code's modules (true: dark), error correction M as the EPC standard asks */
export function qrModules(text: string): boolean[][] {
  const q = qrcode(0, 'M');
  const prev = qrcode.stringToBytes;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  try { q.addData(text, 'Byte'); q.make(); } finally { qrcode.stringToBytes = prev; }
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** the code as an SVG path (one unit per module), for previews and the PDF */
export function qrPath(m: boolean[][]): string {
  let d = '';
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) { x++; continue; }
      let e = x;
      while (e < row.length && row[e]) e++;
      d += `M${x} ${y}h${e - x}v1h${x - e}z`;
      x = e;
    }
  });
  return d;
}

/** what an invoice says about itself: amount to pay, invoice number, the bank account printed on it */
export function readInvoice(text: string): { amount: string | null; ref: string | null; iban: string | null } {
  const lines = text.split('\n');
  const money = /(?:€|EUR)?\s*(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+[.,]\d{2})\s*(?:€|EUR)?/;
  let amount: string | null = null, best = 0;
  for (const l of lines) {
    const label = /(zu\s+zahlen|zahlbetrag|rechnungsbetrag|gesamtbetrag|endbetrag|gesamtsumme|bruttobetrag|summe\s+brutto|gesamt|summe|betrag|amount\s+due|total\s+due|balance\s+due|total)/i.exec(l);
    if (!label) continue;
    const m = money.exec(l.slice(label.index + label[0].length)) ?? money.exec(l);
    if (!m) continue;
    const v = parseAmount(m[1]);
    // the strongest label wins ("zu zahlen" over "Summe"), then the larger sum
    const w = /zu\s+zahlen|zahlbetrag|amount\s+due|total\s+due|balance\s+due|endbetrag|rechnungsbetrag|gesamtbetrag/i.test(label[0]) ? 3 : /gesamt|brutto|total/i.test(label[0]) ? 2 : 1;
    if (v && (w * 1e9 + v > best)) { best = w * 1e9 + v; amount = v.toFixed(2).replace('.', ','); }
  }
  const r = /(?:rechnungs?\s*(?:nummer|nr\.?|no\.?)|re\.?\s*-?\s*nr\.?|invoice\s*(?:number|no\.?|#))\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/.]{2,24})/i.exec(text);
  // an IBAN: written in groups of four, maybe followed by more text ("… 3201 BIC …"): the longest
  // start of it whose check digits are right
  let iban: string | null = null;
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]{1,4}){2,9}/g)) {
    const parts = m[0].split(/\s+/);
    for (let k = parts.length; k > 0 && !iban; k--) { const c = parts.slice(0, k).join(''); if (c.length >= 15 && ibanOk(c)) iban = c; }
    if (!iban && ibanOk(m[0])) iban = cleanIban(m[0]);
    if (iban) break;
  }
  return { amount, ref: r ? r[1].replace(/[.]$/, '') : null, iban };
}

export type Corner = 'br' | 'bl' | 'tr' | 'tl';

/** puts the code with a caption on a page of the PDF (bytes in page order) */
export async function addPayCode(bytes: Uint8Array, p: PayInfo, opt: { page: number; corner: Corner; size: number; caption: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(Math.min(doc.getPageCount() - 1, Math.max(0, opt.page)));
  const m = qrModules(epcPayload(p));
  const n = m.length, quiet = 2;
  const s = opt.size, unit = s / (n + 2 * quiet);
  const crop = page.getCropBox();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cap = opt.caption.trim();
  const capSize = Math.max(6, Math.min(9, s / 12));
  const margin = 24, capH = cap ? capSize * 1.6 : 0;
  const left = opt.corner.endsWith('l') ? crop.x + margin : crop.x + crop.width - margin - s;
  const bottom = opt.corner.startsWith('b') ? crop.y + margin + capH : crop.y + crop.height - margin - s;
  // white behind it (codes on tinted paper read badly), then the modules
  page.drawRectangle({ x: left, y: bottom - capH, width: s, height: s + capH, color: rgb(1, 1, 1) });
  page.drawSvgPath(qrPath(m), { x: left + quiet * unit, y: bottom + s - quiet * unit, scale: unit, color: rgb(0, 0, 0), borderWidth: 0 });
  if (cap) {
    const w = font.widthOfTextAtSize(cap, capSize);
    page.drawText(cap, { x: left + (s - w) / 2, y: bottom - capH + capSize * 0.45, size: capSize, font, color: rgb(0.2, 0.2, 0.2) });
  }
  return doc.save({ useObjectStreams: true });
}
