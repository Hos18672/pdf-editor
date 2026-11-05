// Two test forms: one with fillable fields (AcroForm), one printed only (blanks to write on).
// Run: npx tsx test/ai/make-forms.ts <out-dir>
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';

const out = process.argv[2] ?? '/tmp/ai-forms';
mkdirSync(out, { recursive: true });

(async () => {
  // fillable
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595.28, 841.89]);
    page.drawText('Magistrat der Stadt Wien - MA 35', { x: 50, y: 790, size: 10, font });
    page.drawText('Aktenzeichen: MA35-2026/48213', { x: 50, y: 774, size: 10, font });
    page.drawText('Antrag auf Ausstellung einer Bestaetigung', { x: 50, y: 740, size: 15, font: bold });
    const form = doc.getForm();
    const rows: [string, string][] = [['Vorname', 'vorname'], ['Nachname', 'nachname'], ['Geburtsdatum', 'geb'], ['Aktenzeichen', 'az'], ['Ort, Datum', 'ortdatum']];
    rows.forEach(([label, name], i) => {
      const y = 690 - i * 40;
      page.drawText(label, { x: 50, y: y + 6, size: 11, font });
      const f = form.createTextField(name);
      f.addToPage(page, { x: 180, y, width: 300, height: 20 });
    });
    page.drawText('Ich stimme der Verarbeitung zu', { x: 80, y: 486, size: 11, font });
    const cb = form.createCheckBox('zustimmung');
    cb.addToPage(page, { x: 50, y: 482, width: 16, height: 16 });
    writeFileSync(`${out}/fillable.pdf`, await doc.save());
  }
  // printed only
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595.28, 841.89]);
    page.drawText('Anmeldung zum Deutschkurs', { x: 50, y: 770, size: 16, font: bold });
    page.drawText('Haus aller Menschen, Wien', { x: 50, y: 750, size: 10, font });
    const lines = ['Vorname: ______________________________', 'Nachname: _____________________________', 'Telefon: ______________________________', 'E-Mail:'];
    lines.forEach((s, i) => page.drawText(s, { x: 50, y: 700 - i * 36, size: 11, font }));
    page.drawText('Kursniveau (A1, A2, B1):', { x: 50, y: 556, size: 11, font });
    page.drawRectangle({ x: 220, y: 552, width: 120, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    page.drawText('Ort, Datum ............................', { x: 50, y: 470, size: 11, font });
    page.drawText('Unterschrift ..........................', { x: 320, y: 470, size: 11, font });
    writeFileSync(`${out}/printed.pdf`, await doc.save());
  }
  // a letter
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595.28, 841.89]);
    const text = ['Wien Energie GmbH', 'Thomas-Klestil-Platz 14, 1030 Wien', '', 'Frau Maria Muster', 'Hauptstrasse 1/4, 1010 Wien', '', 'Wien, 15.10.2026',
      'Rechnung Nr. 2026-004187', '', 'Sehr geehrte Frau Muster,', 'fuer den Zeitraum 01.09.2025 bis 31.08.2026 ergibt sich eine Nachzahlung von EUR 249,90.',
      'Bitte ueberweisen Sie den Betrag bis 12.11.2026 auf IBAN AT61 1904 3002 3457 3201.', 'Mit freundlichen Gruessen', 'Ihr Kundenservice'];
    text.forEach((s, i) => s && page.drawText(s, { x: 60, y: 780 - i * 18, size: 11, font }));
    writeFileSync(`${out}/letter.pdf`, await doc.save());
  }
  console.log('forms in', out);
})();
