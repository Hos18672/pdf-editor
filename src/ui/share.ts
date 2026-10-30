// Handing a finished file over: download / share sheet / print. Small, so the start screen can use it too.
import { t } from './i18n';
import type { HostProps, ToastMsg } from './Editor';

export const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Save bytes as a file: share sheet in the Android app, a download on the web. */
export async function saveFile(host: HostProps, bytes: Uint8Array, name: string, type: string, toast: (t: ToastMsg) => void) {
  if (host.isNative && host.savePdf) {
    await host.savePdf(toB64(bytes), name);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  // phones (and browsers that can share files): offer to send it on; otherwise to open it
  const file = canShareFiles() ? new File([bytes as Uint8Array<ArrayBuffer>], name, { type }) : null;
  toast({ msg: t('Saved {name}', { name }), action: file ? { label: t('Share'), run: () => { (navigator as any).share({ files: [file], title: name }).catch(() => null); } }
    : type === 'application/pdf' ? { label: t('Open'), run: () => window.open(url, '_blank') } : undefined });
}

/** the browser can hand files to other apps (Web Share with files) */
export const canShareFiles = () => {
  try { return typeof navigator !== 'undefined' && !!(navigator as any).canShare?.({ files: [new File([new Uint8Array(1)], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; }
};

/** Send a file to another app: the share sheet on Android and in browsers that can, otherwise a download. */
export async function shareFile(host: HostProps, bytes: Uint8Array, name: string, type: string, toast: (t: ToastMsg) => void) {
  if (host.isNative && host.savePdf) { await host.savePdf(toB64(bytes), name); return; }
  const f = new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [f] })) {
    try { await nav.share({ files: [f], title: name }); return; }
    catch (e: any) {
      if (e?.name === 'AbortError') return;
      // the moment of the tap passed while the file was made: one more tap shares it
      if (e?.name === 'NotAllowedError') { toast({ msg: t('{name} is ready', { name }), action: { label: t('Share'), run: () => { nav.share({ files: [f], title: name }).catch(() => null); } } }); return; }
    }
  }
  await saveFile(host, bytes, name, type, toast);
  toast({ msg: t('This browser can’t share files, so {name} was downloaded.', { name }) });
}

/** Print a PDF (web): the browser's print dialog for the file itself. */
export function printPdf(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  fr.src = url;
  fr.onload = () => {
    setTimeout(() => {
      try { fr.contentWindow?.focus(); fr.contentWindow?.print(); }
      catch { window.open(url, '_blank'); }
    }, 300);
  };
  document.body.appendChild(fr);
  setTimeout(() => { fr.remove(); URL.revokeObjectURL(url); }, 10 * 60 * 1000);
}

