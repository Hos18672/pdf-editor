// Loads pdf.js (v3 UMD build) from the copy bundled in /public (works offline, also inside the
// Android app). No third-party CDN: opening the app sends nothing to anyone but its own host.
import { appBase } from './assets';

const localBase = () => appBase() + 'pdfjs';

let loading: Promise<{ lib: any; base: string }> | null = null;

function addScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('load failed')); };
    document.head.appendChild(s);
  });
}

export function loadPdfjs(): Promise<{ lib: any; base: string }> {
  if (!loading) {
    loading = (async () => {
      const w = window as any;
      const base = localBase();
      await addScript(`${base}/pdf.min.js`);
      const lib = w.pdfjsLib || w['pdfjs-dist/build/pdf'];
      lib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.js`;
      return { lib, base };
    })().catch((e) => {
      loading = null;
      throw new Error('Could not load the PDF engine. Reload the page and try again.');
    });
  }
  return loading;
}

export async function openPdf(bytes: Uint8Array, password?: string) {
  const { lib, base } = await loadPdfjs();
  return lib.getDocument({
    data: bytes.slice(),
    password,
    fontExtraProperties: true,
    isEvalSupported: false,
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
  }).promise;
}
