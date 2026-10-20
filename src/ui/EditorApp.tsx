import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from './styles';
import { Icon } from './icons';
import { openPdf, loadPdfjs } from './pdfjs';
import { useHistory } from './store';
import type { PageInfo } from './PageView';
import { appBase } from './assets';
import { Editor, HostProps, ToastMsg, BusyMsg, type EditorStart } from './Editor';
import { Start, OpenState } from './Start';
import { Tools, ToolId } from './Tools';
import { useBp, useTheme, useVisualViewportHeight } from './hooks';
import type { M } from '../engine/types';

export type { HostProps };

export const fromB64 = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// Fonts ship with the app (public/fonts) so the editor also works offline.
const fontBase = () => appBase() + 'fonts/';
const fontFaces = () => {
  const u = fontBase();
  const face = (family: string, file: string, weight: number) =>
    `@font-face{font-family:"${family}";src:url("${u}${file}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;
  return [
    ...[400, 500, 600, 700, 800].map((w) => face('Schibsted Grotesk', `schibsted-grotesk-latin-${w}-normal.woff2`, w)),
    face('Caveat', 'caveat-latin-600-normal.woff2', 400),
    face('Dancing Script', 'dancing-script-latin-600-normal.woff2', 400),
    face('Great Vibes', 'great-vibes-latin-400-normal.woff2', 400),
    face('Homemade Apple', 'homemade-apple-latin-400-normal.woff2', 400),
  ].join('\n');
};

/** Encrypted PDFs (also "owner password only" ones) are decrypted on the device so they can be edited. */
async function decryptIfNeeded(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const head = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 4096)));
  const any = head.includes('/Encrypt') || new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096))).includes('/Encrypt');
  if (!any) {
    // the trailer may be in a cross-reference stream; check with pdf-lib
    const { PDFDocument } = await import('pdf-lib');
    try {
      const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      if (!d.isEncrypted) return bytes;
    } catch { return bytes; }
  }
  const lib = await import('@cantoo/pdf-lib');
  const doc = await lib.PDFDocument.load(bytes, { password, ignoreEncryption: false, updateMetadata: false } as any);
  return doc.save({ useObjectStreams: true });
}

let swRegistered = false;
function registerServiceWorker() {
  if (swRegistered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  swRegistered = true;
  const b = (process.env.EXPO_BASE_URL as string | undefined) ?? '/';
  const base = b.endsWith('/') ? b : b + '/';
  navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => null);
}

export default function EditorApp(host: HostProps) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [infos, setInfos] = useState<PageInfo[]>([]);
  const [openState, setOpenState] = useState<OpenState>({ kind: 'idle' });
  const [busy, setBusy] = useState<BusyMsg | null>(null);
  const [toastMsg, setToastMsg] = useState<ToastMsg | null>(null);
  const [route, setRoute] = useState<{ name: 'home' } | { name: 'editor'; start?: EditorStart } | { name: 'tools'; tool: ToolId; back: 'home' | 'editor' }>({ name: 'home' });
  // a tools card asked for a file first: where to land once it is open
  const startAfterOpen = useRef<EditorStart | undefined>(undefined);
  const pending = useRef<{ name: string; bytes: Uint8Array } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hist = useHistory();
  const bp = useBp();
  const [theme, toggleTheme] = useTheme();
  useVisualViewportHeight();

  useEffect(() => { loadPdfjs().catch(() => null); if (!host.isNative) registerServiceWorker(); }, [host.isNative]);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const open = useCallback(async (name: string, raw: Uint8Array, password?: string) => {
    pending.current = { name, bytes: raw };
    setOpenState({ kind: 'loading', name, progress: 0.05, detail: 'Loading the PDF engine…' });
    try {
      // check the password (and that it is a PDF) with pdf.js first
      let doc = await openPdf(raw, password);
      setOpenState({ kind: 'loading', name, progress: 0.2, detail: 'Checking the file…' });
      let bytes = raw;
      try {
        const dec = await decryptIfNeeded(raw, password ?? '');
        if (dec !== raw) { bytes = dec; doc.destroy?.(); doc = await openPdf(bytes); }
      } catch (e) { console.warn('decrypt failed', e); }
      const list: PageInfo[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        list.push({ w: vp.width, h: vp.height, vm: vp.transform as M });
        if (i % 5 === 0 || i === doc.numPages) setOpenState({ kind: 'loading', name, progress: 0.2 + 0.8 * (i / doc.numPages), detail: `Reading fonts and text on ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}…` });
      }
      setInfos(list);
      setPdf(doc);
      setFile({ name, bytes });
      hist.reset(list.map((_, i) => ({ src: i, rotation: 0 })));
      setOpenState({ kind: 'idle' });
      setRoute({ name: 'editor', start: startAfterOpen.current });
      startAfterOpen.current = undefined;
      pending.current = null;
    } catch (e: any) {
      if (e?.name === 'PasswordException') {
        setOpenState({ kind: 'password', name, wrong: e.code === 2 });
        return;
      }
      setOpenState({ kind: 'error', message: e?.message?.includes('PDF engine') ? e.message : 'It may be damaged, or not a PDF. Damaged files and other formats show this screen too.' });
    }
  }, [hist]);

  const readFile = (f?: File | null) => {
    if (!f) return;
    f.arrayBuffer().then((b) => open(f.name, new Uint8Array(b)));
  };
  const pick = async () => {
    if (host.isNative && host.pickPdf) {
      const r = await host.pickPdf();
      if (r) open(r.name, fromB64(r.base64));
    } else inputRef.current?.click();
  };
  const close = () => { setFile(null); setPdf(null); setInfos([]); setRoute({ name: 'home' }); };
  const openTools = (back: 'home' | 'editor') => { startAfterOpen.current = undefined; setRoute({ name: 'tools', tool: 'hub', back }); };

  return (
    <>
      <style>{fontFaces() + css}</style>
      {route.name === 'editor' && file && pdf ? (
        <Editor key={file.name + file.bytes.length} start={route.start} host={host} file={file} pdf={pdf} infos={infos} hist={hist}
          onClose={close} onTools={() => openTools('editor')} theme={theme} onTheme={toggleTheme} bp={bp}
          toast={setToastMsg} setBusy={setBusy} />
      ) : route.name === 'tools' ? (
        <Tools initial={route.tool} bp={bp} host={host} toast={setToastMsg} setBusy={setBusy}
          current={file && pdf ? { name: file.name, bytes: file.bytes, pdf, pages: hist.snap.pages, changed: hist.past > 0 } : null}
          onBack={() => { startAfterOpen.current = undefined; setRoute(route.back === 'editor' && file ? { name: 'editor' } : { name: 'home' }); }}
          onOpenInEditor={(name, bytes) => open(name, bytes)}
          onEdit={(start) => { if (file) setRoute({ name: 'editor', start }); else { startAfterOpen.current = start; pick(); } }}
          onApplyPages={(pages) => { hist.commit((s) => ({ ...s, pages })); setRoute({ name: 'editor' }); }} />
      ) : (
        <Start state={openState} onFile={(f) => readFile(f)} onPick={pick} mobile={bp === 'mobile'}
          onPassword={(pw) => pending.current && open(pending.current.name, pending.current.bytes, pw)}
          onTools={() => openTools('home')} theme={theme} onTheme={toggleTheme} />
      )}
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
      {busy && (
        <div className="busy" role="status" aria-live="polite">
          <div className="card">
            <div className="ic"><Icon name="file-arrow-down:fill" size={24} /></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><h3>{busy.title}</h3>{busy.detail && <p>{busy.detail}</p>}</div>
            <div className={`progress${busy.progress === undefined ? ' indet' : ''}`}><div style={busy.progress !== undefined ? { width: `${Math.round(busy.progress * 100)}%` } : undefined} /></div>
          </div>
        </div>
      )}
      {toastMsg && (
        <div className={`toast${toastMsg.kind === 'err' ? ' err' : ''}${toastMsg.action ? '' : ' solo'}`} role="status">
          <span className="ti"><Icon name={toastMsg.kind === 'err' ? 'x:bold' : 'check'} size={15} /></span>
          <span className="tm">{toastMsg.msg}</span>
          {toastMsg.action && <button className="ta" onClick={() => { toastMsg.action!.run(); setToastMsg(null); }}>{toastMsg.action.label}</button>}
        </div>
      )}
    </>
  );
}
