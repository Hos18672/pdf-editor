// Loads pdf.js (v3 UMD build). Prefers the copy bundled in /public (works
// offline, also inside the Android app), falls back to the CDN.
const VERSION = '3.11.174';
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}`;

const localBase = () => {
  const base = (process.env.EXPO_BASE_URL as string | undefined) ?? '/';
  return (base.endsWith('/') ? base : base + '/') + 'pdfjs';
};

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
      let base = localBase();
      try {
        await addScript(`${base}/pdf.min.js`);
      } catch {
        base = `${CDN}/build`;
        await addScript(`${base}/pdf.min.js`);
        base = CDN;
      }
      const lib = w.pdfjsLib || w['pdfjs-dist/build/pdf'];
      const workerBase = base === CDN ? `${CDN}/build` : base;
      lib.GlobalWorkerOptions.workerSrc = `${workerBase}/pdf.worker.min.js`;
      return { lib, base };
    })().catch((e) => {
      loading = null;
      throw new Error('Could not load the PDF engine. Check your internet connection and try again.');
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
