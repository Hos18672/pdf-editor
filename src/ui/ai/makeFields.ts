// Places found on a flat form (on the device or by the AI) written into the PDF as real form fields:
// text fields and checkboxes without border or background (the printed lines and boxes stay visible).
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export interface NewField {
  /** page index in the file */ page: number;
  label: string; kind: 'text' | 'multiline' | 'date' | 'check';
  /** PDF user space: x, y = bottom left */ x: number; y: number; w: number; h: number;
}

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'Feld';

export async function addFormFields(bytes: Uint8Array, list: NewField[]): Promise<{ bytes: Uint8Array; added: number }> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const used = new Set(form.getFields().map((f) => f.getName()));
  const pages = doc.getPages();
  let added = 0;
  for (const f of list) {
    const page = pages[f.page];
    if (!page || f.w < 3 || f.h < 3) continue;
    let name = slug(f.label);
    for (let k = 2; used.has(name); k++) name = `${slug(f.label)}_${k}`;
    used.add(name);
    const box = { x: f.x, y: f.y, width: f.w, height: f.h, borderWidth: 0, backgroundColor: undefined, borderColor: undefined };
    if (f.kind === 'check') {
      const cb = form.createCheckBox(name);
      cb.addToPage(page, box);
      cb.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(f.label));
    } else {
      const tf = form.createTextField(name);
      if (f.kind === 'multiline') tf.enableMultiline();
      tf.addToPage(page, box);
      tf.setFontSize(f.kind === 'multiline' ? 10 : Math.max(6, Math.min(12, f.h * 0.7)));
      tf.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(f.label));
    }
    added++;
  }
  if (!added) return { bytes, added };
  return { bytes: await doc.save({ useObjectStreams: false }), added };
}
