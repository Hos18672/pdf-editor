// Files shared into the app (Android share sheet) as one PDF: PDFs are put together, pictures,
import { t } from './i18n';
// office files and text become pages. Everything happens on the device.
import { PDFDocument } from 'pdf-lib';
import { convertFile, kindOf } from './convert';
import { loadDoc, baseName } from './pdfops';
import type { HostProps } from './Editor';

type Shared = { name: string; mime: string | null; bytes: Uint8Array };

export async function sharedToPdf(files: Shared[], text: string | null, subject: string | null, progress: (f: number) => void): Promise<{ name: string; bytes: Uint8Array }> {
  const out = await PDFDocument.create();
  const items: { name: string; mime: string; data: Uint8Array | string }[] = files.map((f) => ({ name: f.name, mime: f.mime ?? '', data: f.bytes }));
  if (text && !files.length) items.push({ name: (subject?.trim() || 'Shared text').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60) + '.txt', mime: 'text/plain', data: text });
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const step = (f: number) => progress((i + f) / items.length);
    let src: PDFDocument;
    if (it.mime === 'application/pdf' || /\.pdf$/i.test(it.name)) src = await loadDoc(it.data as Uint8Array);
    else {
      const kind = kindOf(it.name, it.mime);
      if (!kind) throw new Error(t('{name} can’t be turned into a PDF here', { name: it.name }));
      const file = new File([it.data as BlobPart], it.name, { type: it.mime });
      const r = await convertFile(file, { size: kind === 'image' ? 'fit' : 'a4', orient: 'auto', margin: kind === 'image' ? 'none' : 'normal' }, step);
      src = await PDFDocument.load(r.bytes);
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
    step(1);
  }
  const first = items[0]?.name ?? 'Shared';
  const name = items.length > 1 && files.every((f) => /^image\//.test(f.mime ?? '')) ? `Images ${new Date().toISOString().slice(0, 10)}.pdf` : baseName(first) + '.pdf';
  return { name, bytes: await out.save({ useObjectStreams: true }) };
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** the share / save sheet (Android) or a download */
export async function savePdfFile(host: HostProps, bytes: Uint8Array, name: string) {
  if (host.savePdf) { await host.savePdf(toB64(bytes), name); return; }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
