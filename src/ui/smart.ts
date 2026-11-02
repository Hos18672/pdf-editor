// Small smarts for scanned letters, all on the device:
// - the payment QR code printed on invoices ("Zahlen mit Code", EPC / GiroCode): who, IBAN, amount, reference
// - a file name made from the letter itself: date, kind of letter and who sent it
export interface Payment { name: string; iban: string; bic: string; amount: number | null; currency: string; ref: string; text: string }

/** reads an EPC (GiroCode / "Zahlen mit Code") QR text; null when it isn't one */
export function parseEpc(raw: string): Payment | null {
  const l = raw.replace(/\r/g, '').split('\n');
  if (l[0]?.trim() !== 'BCD' || l[3]?.trim() !== 'SCT') return null;
  const iban = (l[6] ?? '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return null;
  const am = /^([A-Z]{3})(\d+(?:\.\d{1,2})?)$/.exec((l[7] ?? '').trim());
  return {
    bic: (l[4] ?? '').trim(), name: (l[5] ?? '').trim(), iban,
    currency: am?.[1] ?? 'EUR', amount: am ? parseFloat(am[2]) : null,
    ref: (l[9] ?? '').trim(), text: (l[10] ?? '').trim(),
  };
}
export const fmtIban = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

/** QR codes in a picture: the browser's own detector when there is one, else jsQR */
export async function findPayment(src: CanvasImageSource & { width: number; height: number }): Promise<Payment | null> {
  const BD = (globalThis as any).BarcodeDetector;
  if (BD) {
    try {
      const d = new BD({ formats: ['qr_code'] });
      for (const c of await d.detect(src)) { const p = parseEpc(c.rawValue ?? ''); if (p) return p; }
      return null;
    } catch { /* fall back */ }
  }
  const W = src.width, H = src.height;
  const { default: jsQR } = await import('jsqr');
  // the whole page small, then the corners larger (codes sit near an edge, usually low on the page)
  const tries: [number, number, number, number, number][] = [[0, 0, W, H, 1400], [0, H * 0.45, W, H * 0.55, 1600], [0, 0, W, H * 0.5, 1600]];
  for (const [x, y, w, h, max] of tries) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    c.width = c.height = 0;
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    const p = r ? parseEpc(r.data) : null;
    if (p) return p;
    await new Promise((res) => setTimeout(res, 0));
  }
  return null;
}

// ---- file names ----
const KINDS: [RegExp, string, string][] = [
  [/\bmahnung|zahlungserinnerung|reminder\b/i, 'Mahnung', 'Reminder'],
  [/\brechnung|faktura|invoice\b/i, 'Rechnung', 'Invoice'],
  [/\bgutschrift|credit note\b/i, 'Gutschrift', 'Credit note'],
  [/\bangebot|kostenvoranschlag|quote|quotation\b/i, 'Angebot', 'Quote'],
  [/\bk(ü|ue)ndigung|termination\b/i, 'Kündigung', 'Termination'],
  [/\bvertrag|vereinbarung|contract|agreement\b/i, 'Vertrag', 'Contract'],
  [/\bbescheid\b/i, 'Bescheid', 'Notice'],
  [/\b(lohn|gehalts)(zettel|abrechnung)|payslip\b/i, 'Lohnzettel', 'Payslip'],
  [/\bkontoauszug|bank statement\b/i, 'Kontoauszug', 'Statement'],
  [/\bbest(ä|ae)tigung|confirmation\b/i, 'Bestätigung', 'Confirmation'],
  [/\bbefund|arztbrief|überweisung zum\b/i, 'Befund', 'Medical report'],
  [/\b(kassa)?bon|beleg|quittung|receipt\b/i, 'Beleg', 'Receipt'],
  [/\bpolizze|versicherungsschein|policy\b/i, 'Polizze', 'Policy'],
  [/\bzeugnis|certificate\b/i, 'Zeugnis', 'Certificate'],
  [/\bantrag|application\b/i, 'Antrag', 'Application'],
];
const MONTHS: Record<string, number> = { jan: 1, jän: 1, feb: 2, mär: 3, mar: 3, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12 };

/** the letter's date: the most recent date that isn't in the future (ISO, or null) */
function letterDate(text: string, today = new Date()): string | null {
  const found: Date[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g)) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    found.push(new Date(y, +m[2] - 1, +m[1]));
  }
  for (const m of text.matchAll(/\b(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,})\.?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) found.push(new Date(+m[3], mo - 1, +m[1]));
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) found.push(new Date(+m[1], +m[2] - 1, +m[3]));
  const ok = found.filter((d) => !isNaN(+d) && d.getFullYear() > 1990 && d <= today && d.getMonth() >= 0);
  if (!ok.length) return null;
  const d = ok.reduce((a, b) => (b > a ? b : a));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** who sent it: a company-like line near the top ("… GmbH", "… AG", "Magistrat …"), else the first strong line */
function sender(lines: string[]): string | null {
  const firm = /\b(GmbH|AG|KG|OG|e\.?U\.?|Ges\.?m\.?b\.?H|Bank|Sparkasse|Versicherung|Magistrat|Finanzamt|Gemeinde|Stadt|Bundesamt|Ministerium|Österreichische|Wiener|Energie|Telekom|Inc\.?|Ltd\.?|LLC)\b/;
  const top = lines.slice(0, 14).map((l) => l.trim()).filter((l) => l.length >= 3 && l.length <= 48 && /[A-Za-zÄÖÜäöü]{3}/.test(l));
  const bad = /\b(seite|page|datum|date|tel|fax|e-?mail|www\.|http|iban|bic|uid|str(aße|\.)|gasse|platz|\d{4}\s+[A-ZÄÖÜ][a-zäöü]+$)/i;
  const hit = top.find((l) => firm.test(l) && !bad.test(l)) ?? top.find((l) => !bad.test(l) && !/\d{3,}/.test(l) && /^[A-ZÄÖÜ]/.test(l));
  if (!hit) return null;
  return hit.replace(/[^\p{L}\p{N}&.\- ]+/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ') || null;
}

/** "2026-11-02 Rechnung Wien Energie" from the letter's text (null: nothing useful found) */
export function suggestName(text: string, de: boolean, today = new Date()): string | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const kind = KINDS.find(([re]) => re.test(text));
  const date = letterDate(text, today);
  const from = sender(lines);
  const parts = [date, kind ? (de ? kind[1] : kind[2]) : null, from].filter(Boolean) as string[];
  if (parts.length < 2) return null;
  return parts.join(' ').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
}
