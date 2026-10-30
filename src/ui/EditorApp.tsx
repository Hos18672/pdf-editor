import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { css } from './styles';
import { Icon } from './icons';
import { useNoStrayDrops } from './drop';
import { openPdf, loadPdfjs } from './pdfjs';
import { useHistory } from './store';
import type { PageInfo } from './PageView';
import { appBase } from './assets';
import type { HostProps, ToastMsg, BusyMsg, EditorStart, Incoming } from './Editor';
import { Start, OpenState, type QuickAction } from './Start';
import type { ToolId } from './Tools';
import { recentBytes, saveRecent, type RecentKind } from './recent';
import type { AddWhat } from './AddPages';

// Only the start screen loads up front; the editor, tools and scanner arrive as separate chunks
// (fetched in the background right after start-up, so opening a file doesn't wait for them).
const loadScreens = () => import('./screens');
const Editor = lazy(() => loadScreens().then((m) => ({ default: m.Editor })));
const Tools = lazy(() => loadScreens().then((m) => ({ default: m.Tools })));
const Scanner = lazy(() => loadScreens().then((m) => ({ default: m.Scanner })));
import { useBackButton } from './back';
import { useBp, useEdgeColors, useNativeInsets, useTheme, useVisualViewportHeight } from './hooks';
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
    // Broadsheet: the interface is set in the serif (500 and 800 fall back to the nearest cut)
    ...[400, 600, 700].map((w) => face('Source Serif 4', `source-serif-4-latin-${w}-normal.woff2`, w)),
    `@font-face{font-family:"Source Serif 4";src:url("${u}source-serif-4-latin-400-italic.woff2") format("woff2");font-weight:400;font-style:italic;font-display:swap}`,
    // lettering for edits on scans / picture pages (matched to the scan)
    ...['carlito', 'arimo', 'tinos', 'roboto'].flatMap((f) => [400, 700].map((w) => face(`PE ${f[0].toUpperCase()}${f.slice(1)}`, `${f}-latin-${w}-normal.woff2`, w))),
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

// CI smoke-test build only: lets the emulator test run text recognition end to end
if (process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === '1' && typeof window !== 'undefined') {
  (window as any).__peOcrTest = async () => {
    const { loadOcr } = await import('./ocr');
    const w = await loadOcr();
    const c = document.createElement('canvas');
    c.width = 900; c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 900, 160);
    ctx.fillStyle = '#000'; ctx.font = '64px sans-serif'; ctx.fillText('Hallo Welt 2026', 40, 100);
    const r = await w.recognize(c);
    return r.data.text.trim();
  };
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
  // a file dropped where nothing takes it must not replace the app (and the work) in the browser
  useNoStrayDrops();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [infos, setInfos] = useState<PageInfo[]>([]);
  const [openState, setOpenState] = useState<OpenState>({ kind: 'idle' });
  const [busy, setBusy] = useState<BusyMsg | null>(null);
  const [toastMsg, setToastMsg] = useState<ToastMsg | null>(null);
  const [route, setRoute] = useState<{ name: 'home' } | { name: 'editor'; start?: EditorStart } | { name: 'tools'; tool: ToolId; back: 'home' | 'editor' } | { name: 'scan'; back: 'home' | 'tools'; initial?: string[] }>({ name: 'home' });
  // a tools card asked for a file first: where to land once it is open
  const startAfterOpen = useRef<EditorStart | undefined>(undefined);
  const pending = useRef<{ name: string; bytes: Uint8Array } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hist = useHistory();
  const bp = useBp();
  const [theme, toggleTheme] = useTheme();
  useVisualViewportHeight();
  useEdgeColors(host.isNative ? host.onChrome : undefined, [host.isNative, !!host.onChrome]);
  useNativeInsets(host.isNative ? host.getInsets : undefined);
  useBackButton(!!host.isNative, host.exitApp);

  useEffect(() => {
    loadPdfjs().catch(() => null);
    if (!host.isNative) {
      registerServiceWorker();
      // the browser tab and search results say what the app does
      document.title = 'Paginka – PDF Editor & Scanner';
    }
    const t = setTimeout(() => { loadScreens().catch(() => null); }, 600);
    return () => clearTimeout(t);
  }, [host.isNative]);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // the open document's entry in the recent list
  const recentId = useRef<string | null>(null);
  // a new id per opened document (the editor starts afresh); adding pages keeps it
  const [docId, setDocId] = useState(0);
  const open = useCallback(async (name: string, raw: Uint8Array, password?: string, kind: RecentKind = 'opened', id?: string) => {
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
        if (i % 2 === 0 || i === doc.numPages || doc.numPages < 20) setOpenState({ kind: 'loading', name, progress: 0.2 + 0.8 * (i / doc.numPages), detail: `Reading fonts and text on ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}…`, done: i, total: doc.numPages });
      }
      setInfos(list);
      setPdf(doc);
      setFile({ name, bytes });
      setDocId((n) => n + 1);
      hist.reset(list.map((_, i) => ({ src: i, rotation: 0 })));
      setOpenState({ kind: 'idle' });
      recentId.current = id ?? null;
      saveRecent({ id, name, kind, bytes, pdf: doc }).then((i) => { if (i) recentId.current = i; });
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

  // Pages added in the editor are appended to the file (so the pages already there, and the edits on
  // them, keep their numbers) and placed in the page order where they were asked for.
  const addPages = async (after: number, what: AddWhat): Promise<number | null> => {
    if (!file || !pdf) return null;
    setBusy({ title: 'Adding pages', detail: 'On this device. Your edits stay.' });
    try {
      // pdf-lib is loaded only when needed
      const { loadDoc, addImagePage, imageBytes, save: saveDoc } = await import('./pdfops');
      const doc = await loadDoc(file.bytes);
      const before = doc.getPageCount();
      if (what.kind === 'blank') {
        const ref = hist.snap.pages[Math.max(0, Math.min(hist.snap.pages.length - 1, after - 1))];
        const info = ref ? infos[ref.src] : undefined;
        const turned = ref ? ref.rotation % 180 !== 0 : false;
        const dims: [number, number] = info ? (turned ? [info.h, info.w] : [info.w, info.h]) : [595.28, 841.89];
        for (let k = 0; k < what.count; k++) doc.addPage(dims);
      } else if (what.kind === 'pdf') {
        const other = await loadDoc(new Uint8Array(await what.file.arrayBuffer()));
        const copied = await doc.copyPages(other, other.getPageIndices());
        copied.forEach((pg) => doc.addPage(pg));
      } else {
        for (const f of what.files) await addImagePage(doc, await imageBytes(f), 'fit');
      }
      const added = doc.getPageCount() - before;
      if (!added) { setBusy(null); return null; }
      const bytes = await saveDoc(doc);
      const next = await openPdf(bytes);
      const more: PageInfo[] = [];
      for (let i = before + 1; i <= next.numPages; i++) {
        const vp = (await next.getPage(i)).getViewport({ scale: 1 });
        more.push({ w: vp.width, h: vp.height, vm: vp.transform as M });
      }
      const old = pdf;
      setInfos((l) => [...l.slice(0, before), ...more]);
      setPdf(next);
      setFile({ name: file.name, bytes });
      hist.commit((s) => {
        const at = Math.max(0, Math.min(s.pages.length, after));
        const fresh = more.map((_, k) => ({ src: before + k, rotation: 0 }));
        return { ...s, pages: [...s.pages.slice(0, at), ...fresh, ...s.pages.slice(at)] };
      });
      setTimeout(() => old.destroy?.(), 15000);
      setBusy(null);
      setToastMsg({ msg: `Added ${added} ${added === 1 ? 'page' : 'pages'}` });
      return before;
    } catch (e: any) {
      setBusy(null);
      setToastMsg({ msg: 'Couldn’t add pages: ' + (e?.message?.includes('encrypt') ? 'that PDF is password-protected' : e?.message ?? 'unknown error'), kind: 'err' });
      return null;
    }
  };

  const readFile = (f?: File | null) => {
    if (!f) return;
    f.arrayBuffer().then((b) => open(f.name, new Uint8Array(b)));
  };
  /** pictures, Office files or text dropped on the start screen: turned into one PDF and opened */
  const importFiles = async (files: File[]) => {
    const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : 'Combined.pdf';
    setOpenState({ kind: 'loading', name, progress: 0.05, detail: `Turning ${files.length === 1 ? 'the file' : `${files.length} files`} into a PDF…` });
    try {
      const { convertFile } = await import('./convert');
      const { PDFDocument } = await import('pdf-lib');
      const opt = { size: 'a4', orient: 'auto', margin: 'small' } as const;
      const parts: Uint8Array[] = [];
      for (let i = 0; i < files.length; i++) {
        parts.push((await convertFile(files[i], opt as any, (f) => setOpenState({ kind: 'loading', name, progress: 0.05 + 0.6 * (i + f) / files.length, detail: `Turning ${files[i].name} into a PDF…` }))).bytes);
      }
      let bytes = parts[0];
      if (parts.length > 1) {
        const out = await PDFDocument.create();
        for (const b of parts) { const d = await PDFDocument.load(b); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
        bytes = await out.save();
      }
      open(name, bytes);
    } catch (e: any) {
      setOpenState({ kind: 'error', message: e?.message === 'unsupported' ? 'That file type isn’t supported. Use a PDF, a picture, a Word, Excel or PowerPoint file, or text.' : `That file couldn’t be turned into a PDF${e?.message ? ` (${e.message})` : ''}.` } as any);
    }
  };
  const pick = async () => {
    if (host.isNative && host.pickPdf) {
      const r = await host.pickPdf();
      if (r) open(r.name, fromB64(r.base64));
    } else inputRef.current?.click();
  };
  // the same document with new bytes (e.g. after text recognition): keeps the edit history
  const close = () => { setFile(null); setPdf(null); setInfos([]); setRoute({ name: 'home' }); };
  const openTools = (back: 'home' | 'editor') => { startAfterOpen.current = undefined; setRoute({ name: 'tools', tool: 'hub', back }); };
  const quick = (q: QuickAction) => {
    if (q === 'sign' || q === 'fill') { startAfterOpen.current = q; pick(); }
    else if (q === 'tools') openTools('home');
    else if (q === 'scan') setRoute({ name: 'scan', back: 'home' });
    else { startAfterOpen.current = undefined; setRoute({ name: 'tools', tool: q, back: 'home' }); }
  };
  // ----- Android: opened with a PDF, files shared into the app, or a shortcut / widget button -----
  const firstIntent = useRef(true);
  const handleIntent = async () => {
    if (!host.takeIntent) return;
    const launch = firstIntent.current;
    firstIntent.current = false;
    let inc: Incoming | null = null;
    try { inc = await host.takeIntent(); } catch { return; }
    if (!inc) return;
    const files = inc.files ?? [];
    if (!files.length && !inc.text) {
      // a shortcut or widget button
      if (inc.mode === 'scan') setRoute({ name: 'scan', back: 'home' });
      else if (inc.mode === 'open') pick();
      else if (inc.mode === 'sign') quick('sign');
      else if (inc.mode === 'convert') setRoute({ name: 'tools', tool: 'convert', back: 'home' });
      return;
    }
    const convert = inc.mode === 'convert';
    setBusy({ title: convert ? 'Making your PDF' : 'Opening', detail: `${files.length > 1 ? files.length + ' files' : files[0]?.name ?? 'Shared text'} · on this device, nothing is uploaded` });
    try {
      const read = await Promise.all(files.map(async (f) => ({ ...f, bytes: fromB64(await host.readShared!(f.uri)) })));
      if (inc.mode === 'open' && read.length === 1) { setBusy(null); open(read[0].name, read[0].bytes); return; }
      // several PDFs are put together; pictures, office files and text are turned into PDF pages
      const { sharedToPdf, savePdfFile } = await import('./sharedPdf');
      const out = await sharedToPdf(read, inc.text, inc.subject, (f) => setBusy((b) => (b ? { ...b, progress: f } : b)));
      setBusy(null);
      if (!convert) { open(out.name, out.bytes, undefined, 'opened'); return; }
      saveRecent({ name: out.name, kind: 'opened', bytes: out.bytes }).catch(() => null);
      await savePdfFile(host, out.bytes, out.name);
      // opened only to convert: go back to the app the files came from
      if (launch && !file && host.exitApp) setTimeout(() => host.exitApp!(), 400);
      else setToastMsg({ msg: `${out.name} is ready`, action: { label: 'Edit', run: () => open(out.name, out.bytes) } });
    } catch (e: any) {
      setBusy(null);
      setToastMsg({ msg: 'Couldn’t open what was shared: ' + (e?.message ?? 'unknown error'), kind: 'err' });
    }
  };
  // Android: a Google scan that finished while the page was restarted (low memory): its pages
  useEffect(() => {
    host.takeScan?.().then((u) => { if (u?.length) setRoute({ name: 'scan', back: 'home', initial: u }); }, () => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!host.takeIntent) return;
    handleIntent();
    const on = () => { handleIntent(); };
    window.addEventListener('pe-intent', on);
    return () => window.removeEventListener('pe-intent', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <>
      <style>{fontFaces() + css}</style>
      <Suspense fallback={<div className="lazy-wait" role="status" aria-label="Loading"><span className="spinner" /></div>}>
      {route.name === 'editor' && file && pdf ? (
        <Editor key={docId} onAddPages={addPages} start={route.start} host={host} file={file} pdf={pdf} infos={infos} hist={hist}
          onClose={close} onTools={() => openTools('editor')} theme={theme} onTheme={toggleTheme} bp={bp}
          onSaved={(bytes, name) => { saveRecent({ id: recentId.current ?? undefined, name, kind: 'edited', bytes }).then((i) => { if (i) recentId.current = i; }); }}
          toast={setToastMsg} setBusy={setBusy} />
      ) : route.name === 'scan' ? (
        <Scanner host={host} bp={bp} initial={route.initial} toast={setToastMsg} setBusy={setBusy}
          onClose={() => setRoute(route.back === 'tools' ? { name: 'tools', tool: 'hub', back: 'home' } : { name: 'home' })}
          onOpenInEditor={(name, bytes) => open(name, bytes, undefined, 'scanned')}
          onSaved={(name, bytes) => { saveRecent({ name, kind: 'scanned', bytes }); }} />
      ) : route.name === 'tools' ? (
        <Tools initial={route.tool} bp={bp} host={host} toast={setToastMsg} setBusy={setBusy}
          current={file && pdf ? { name: file.name, bytes: file.bytes, pdf, pages: hist.snap.pages, changed: hist.past > 0 } : null}
          onBack={() => { startAfterOpen.current = undefined; setRoute(route.back === 'editor' && file ? { name: 'editor' } : { name: 'home' }); }}
          onOpenInEditor={(name, bytes) => open(name, bytes)}
          onEdit={(start) => { if (file) setRoute({ name: 'editor', start }); else { startAfterOpen.current = start; pick(); } }}
          onApplyPages={(pages) => { hist.commit((s) => ({ ...s, pages })); setRoute({ name: 'editor' }); }}
          onScan={() => setRoute({ name: 'scan', back: 'tools' })} />
      ) : (
        <Start state={openState} onFile={(f) => { startAfterOpen.current = undefined; readFile(f); }} onImport={importFiles} onPick={() => { startAfterOpen.current = undefined; pick(); }} mobile={bp === 'mobile'}
          onPassword={(pw) => pending.current && open(pending.current.name, pending.current.bytes, pw)}
          onTools={() => openTools('home')} onQuick={quick} isNative={host.isNative} theme={theme} onTheme={toggleTheme}
          onRecent={async (d) => {
            const b = await recentBytes(d.id);
            startAfterOpen.current = undefined; // a cancelled "Sign" must not leak into this file
            if (b) open(d.name, b, undefined, d.kind, d.id);
            else setToastMsg({ msg: 'That file is no longer stored here', kind: 'err' });
          }}
          onShareRecent={async (d) => {
            const b = await recentBytes(d.id);
            if (!b) { setToastMsg({ msg: 'That file is no longer stored here', kind: 'err' }); return; }
            const { shareFile } = await import('./share');
            await shareFile(host, b, /\.pdf$/i.test(d.name) ? d.name : d.name + '.pdf', 'application/pdf', setToastMsg);
          }} />
      )}
      </Suspense>
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
