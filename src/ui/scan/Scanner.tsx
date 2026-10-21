import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { Seg, Toggle } from '../Panel';
import { saveFile, type BusyMsg, type HostProps, type ToastMsg } from '../Editor';
import { ConfirmClose } from '../ConfirmClose';
import { SortableArea, useSortableItem } from '../sortable';
import type { Bp } from '../hooks';
import type { Quad } from './geom';
import type { Filter } from './kernels';
import { Camera, MODES } from './Camera';
import { CropEditor } from './CropEditor';
import { DEFAULT_FILTER, decode, findDocument, forget, newId, orientPage, outputSize, renderPage, shapeOf, type Quality, type ScanMode, type ScanPage } from './engine';
import { buildScanPdf, sheetsOf, type PaperOpt } from './scanPdf';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'auto', label: 'Auto' }, { id: 'color', label: 'Photo' }, { id: 'gray', label: 'Grey' }, { id: 'bw', label: 'B & W' }, { id: 'original', label: 'Original' },
];
const FORMAT_LABEL: Record<string, string> = { a4: 'A4', letter: 'Letter', legal: 'Legal', a5: 'A5', id1: 'ID card', id3: 'Passport' };

interface Render { key: string; url: string; w: number; h: number }
const keyOf = (p: ScanPage) => `${p.id}:${p.ver}`;
const geoKey = (p: ScanPage) => `${p.id}:${p.quad.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(';')}:${p.rot}`;

const readMode = (): ScanMode => { try { const m = localStorage.getItem('pe.scan.mode'); return (['doc', 'id', 'passport', 'receipt'] as const).find((x) => x === m) ?? 'doc'; } catch { return 'doc'; } };
const stamp = () => {
  const d = new Date(), z = (n: number) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`;
};

/**
 * The document scanner: camera (or photos) → automatic crop and straightening → clean-up filters →
 * a PDF at real paper size, optionally searchable. Everything runs on the device.
 */
export function Scanner({ host, bp, toast, setBusy, onClose, onOpenInEditor }: {
  host: HostProps; bp: Bp; toast: (t: ToastMsg) => void; setBusy: (b: BusyMsg | null) => void;
  onClose: () => void; onOpenInEditor: (name: string, bytes: Uint8Array) => void;
}) {
  const mobile = bp === 'mobile';
  const [mode, setModeState] = useState<ScanMode>(readMode);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [view, setView] = useState<'camera' | 'review'>('camera');
  const [cur, setCur] = useState(0);
  const [crop, setCrop] = useState<string | null>(null);
  const [renders, setRenders] = useState<Record<string, Render>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [finding, setFinding] = useState(0);
  const [quality, setQuality] = useState<Quality>('standard');
  const [paper, setPaper] = useState<PaperOpt>('auto');
  const [cardSheet, setCardSheet] = useState(true);
  const [ocr, setOcr] = useState(false);
  const [name, setName] = useState(stamp);
  const [saved, setSaved] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const curRef = useRef(cur); curRef.current = cur;

  const setMode = (m: ScanMode) => { setModeState(m); try { localStorage.setItem('pe.scan.mode', m); } catch { /* private */ } };
  const patch = useCallback((id: string, f: (p: ScanPage) => Partial<ScanPage>) => {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...f(p), ver: p.ver + 1 } : p)));
    setSaved(false);
  }, []);

  // ---- adding photos
  const add = useCallback(async (blob: Blob, kind: ScanMode, side?: 'front' | 'back') => {
    const id = newId();
    setFinding((n) => n + 1);
    try {
      const bmp = await decode(blob);
      const w = bmp.width, h = bmp.height;
      const found = await findDocument(bmp, kind);
      const page: ScanPage = {
        id, blob, w, h, quad: found.quad, auto: found.sure ? found.quad : found.quad, sure: found.sure, rot: 0,
        // a card photographed in document mode keeps its photo and colours
        filter: kind === 'doc' && (found.format === 'id1' || found.format === 'id3') ? 'color' : DEFAULT_FILTER[kind], kind, side, format: found.format, ratio: found.ratio, ver: 1,
      };
      setPages((ps) => [...ps, page]);
      // pages photographed sideways or upside down: turn them so the text reads upright
      orientPage(page).then((t) => { if (t) setPages((ps) => ps.map((x) => (x.id === id && x.ver === 1 ? { ...x, rot: t, ver: 2 } : x))); }).catch(() => null);
      setSaved(false);
      return page;
    } catch (e) {
      console.warn('scan: photo not usable', e);
      toast({ msg: 'That photo couldn’t be read.', kind: 'err' });
      return null;
    } finally { setFinding((n) => n - 1); }
  }, [toast]);

  const idCount = pages.filter((p) => p.kind === 'id').length;
  const onShot = useCallback((blob: Blob) => {
    const m = mode;
    if (m === 'id') {
      const n = pagesRef.current.filter((p) => p.kind === 'id').length + 0;
      const side = n % 2 === 0 ? 'front' : 'back';
      add(blob, 'id', side).then(() => { if (side === 'back') { setView('review'); setCur(pagesRef.current.length - 1); } });
      return;
    }
    add(blob, m).then(() => { if (m === 'passport') { setView('review'); setCur(pagesRef.current.length - 1); } });
  }, [add, mode]);

  const onImport = useCallback(async (files: File[]) => {
    const start = pagesRef.current.length;
    let k = pagesRef.current.filter((p) => p.kind === 'id').length;
    for (const f of files) {
      const side = mode === 'id' ? (k++ % 2 === 0 ? 'front' : 'back') : undefined;
      await add(f, mode, side);
    }
    setView('review');
    setCur(start);
  }, [add, mode]);

  // ---- rendering (one at a time; the page on screen first)
  const busyRender = useRef(false);
  const [kick, setKick] = useState(0);
  useEffect(() => {
    if (busyRender.current) return;
    const list = pagesRef.current;
    const order = [list[curRef.current], ...list].filter(Boolean) as ScanPage[];
    const todo = order.find((p) => renders[p.id]?.key !== keyOf(p));
    const long = mobile ? 1200 : 1600;
    if (todo) {
      busyRender.current = true;
      const key = keyOf(todo);
      renderPage(todo, { quality: 'standard', long }).then((r) => {
        setRenders((rs) => { const old = rs[todo.id]; if (old) URL.revokeObjectURL(old.url); return { ...rs, [todo.id]: { key, url: r.url, w: r.w, h: r.h } }; });
      }).catch((e) => console.warn('scan render failed', e)).finally(() => { busyRender.current = false; setKick((n) => n + 1); });
      return;
    }
    // filter previews of the page on screen
    const p = list[curRef.current];
    if (view !== 'review' || !p) return;
    const missing = FILTERS.find((f) => !previews[`${geoKey(p)}:${f.id}`]);
    if (!missing) return;
    busyRender.current = true;
    const k = `${geoKey(p)}:${missing.id}`;
    renderPage(p, { quality: 'small', long: 220, filter: missing.id, jpeg: 0.8 }).then((r) => setPreviews((pv) => ({ ...pv, [k]: r.url })))
      .catch(() => setPreviews((pv) => ({ ...pv, [k]: '' })))
      .finally(() => { busyRender.current = false; setKick((n) => n + 1); });
  }, [pages, cur, renders, previews, view, kick, mobile]);

  // tidy up object URLs when leaving
  useEffect(() => () => {
    Object.values(renders).forEach((r) => URL.revokeObjectURL(r.url));
    Object.values(previews).forEach((u) => u && URL.revokeObjectURL(u));
    pagesRef.current.forEach((p) => forget(p.blob));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const page = pages[Math.min(cur, pages.length - 1)] as ScanPage | undefined;
  const lastThumb = pages.length ? renders[pages[pages.length - 1].id]?.url ?? null : null;
  const step = mode === 'id' ? (idCount % 2 === 0 ? 'Front side' : 'Back side') : mode === 'passport' ? 'Photo page' : null;

  // ---- page actions
  const rotate = (d: number) => page && patch(page.id, (p) => ({ rot: (p.rot + d + 4) % 4 }));
  const remove = (id: string) => {
    const i = pages.findIndex((p) => p.id === id);
    setPages((ps) => ps.filter((p) => p.id !== id));
    setCur((c) => Math.max(0, Math.min(c >= i ? c - 1 : c, pages.length - 2)));
    if (pages.length <= 1) setView('camera');
  };
  const setFilter = (f: Filter, all = false) => {
    if (all) { setPages((ps) => ps.map((p) => (p.filter === f ? p : { ...p, filter: f, ver: p.ver + 1 }))); setSaved(false); }
    else if (page) patch(page.id, () => ({ filter: f }));
  };
  const applyCrop = (q: Quad) => {
    const p = pages.find((x) => x.id === crop);
    if (p) patch(p.id, () => ({ quad: q, sure: true, ...shapeOf(q, p.w, p.h, p.kind) }));
    setCrop(null);
  };

  // ---- output
  const sheets = useMemo(() => sheetsOf(pages, { cardLayout: cardSheet ? 'sheet' : 'card' }), [pages, cardSheet]);
  const hasCards = pages.some((p) => p.format === 'id1' || p.format === 'id3');
  const estimate = useMemo(() => {
    // rough: JPEG of a cleaned page ≈ 0.11 bytes / pixel (colour photos more)
    let px = 0;
    for (const p of pages) { const s = outputSize(p, quality); px += s.w * s.h * (p.filter === 'color' || p.filter === 'original' ? 0.16 : p.filter === 'bw' ? 0.06 : 0.1); }
    const kb = px / 1024;
    return kb < 1024 ? `${Math.max(1, Math.round(kb / 10) * 10)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }, [pages, quality]);
  const fileName = (name.trim() || 'Scan').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
  const build = async () => {
    const title = 'Making your PDF';
    setBusy({ title, detail: 'Preparing…', progress: 0 });
    try {
      return await buildScanPdf(pages, {
        quality, paper, ocr, cardLayout: cardSheet ? 'sheet' : 'card',
        progress: (f, msg) => setBusy({ title, detail: msg, progress: f }),
      });
    } finally { setBusy(null); }
  };
  const save = async (): Promise<boolean> => {
    if (!pages.length) return false;
    try {
      const bytes = await build();
      await saveFile(host, bytes, fileName, 'application/pdf', toast);
      setSaved(true); setSheetOpen(false);
      return true;
    } catch (e) {
      console.warn('scan export failed', e);
      toast({ msg: 'The PDF couldn’t be made on this device.', kind: 'err' });
      return false;
    }
  };
  const edit = async () => {
    try { const bytes = await build(); setSaved(true); onOpenInEditor(fileName, bytes); }
    catch (e) { console.warn(e); toast({ msg: 'The PDF couldn’t be made on this device.', kind: 'err' }); }
  };
  const close = () => (pages.length && !saved ? setAskClose(true) : onClose());

  // Android back / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || crop || askClose || sheetOpen) return;
      if (view === 'review') setView('camera'); else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const crumbs = (
    <>
      {crop && pages.find((p) => p.id === crop) && <CropEditor page={pages.find((p) => p.id === crop)!} onApply={applyCrop} onCancel={() => setCrop(null)} />}
      {askClose && (
        <ConfirmClose changes={pages.length} sheet={mobile} title="Leave the scan?"
          body={`${pages.length} scanned ${pages.length === 1 ? 'page isn’t' : 'pages aren’t'} saved yet. Save them as a PDF, or they’ll be lost.`}
          saveLabel="Save PDF and close" keepLabel="Keep scanning"
          onCancel={() => setAskClose(false)} onDiscard={() => { setAskClose(false); onClose(); }}
          onDownload={async () => { setAskClose(false); if (await save()) onClose(); }} />
      )}
    </>
  );

  if (view === 'camera') {
    return (
      <>
        <Camera mode={mode} onMode={setMode} count={pages.length} lastThumb={lastThumb} step={step}
          onShot={onShot} onImport={onImport} onDone={() => { setView('review'); setCur(Math.max(0, pages.length - 1)); }} onClose={pages.length ? () => setView('review') : close} />
        {finding > 0 && <div className="scam-finding" role="status"><span className="spinner" />Finding the page…</div>}
        {crumbs}
      </>
    );
  }

  const r = page ? renders[page.id] : undefined;
  const stale = !!page && r?.key !== keyOf(page);
  const settings = (
    <div className="sc-settings">
      <label className="sc-field">
        <span className="kicker">File name</span>
        <span className="sc-name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" /><em>.pdf</em></span>
      </label>
      <div className="sc-field">
        <span className="kicker">Page size</span>
        <Seg value={paper} onChange={(v) => setPaper(v as PaperOpt)} options={[['auto', 'Auto'], ['a4', 'A4'], ['letter', 'Letter'], ['fit', 'Fit']]} />
      </div>
      <div className="sc-field">
        <span className="kicker">Quality <small>· about {estimate}</small></span>
        <Seg value={quality} onChange={(v) => setQuality(v as Quality)} options={[['small', 'Small'], ['standard', 'Standard'], ['high', 'Best']]} />
      </div>
      {hasCards && <Toggle label="Cards at actual size on A4" hint="Front and back together, like a photocopy" checked={cardSheet} onChange={setCardSheet} />}
      <Toggle label="Searchable text" hint="Recognises the text so you can search, copy and edit it" checked={ocr} onChange={setOcr} />
    </div>
  );

  return (
    <div className="scr">
      <header className="topbar">
        <button className="ibtn" onClick={close} aria-label="Close scanner"><Icon name="back" /></button>
        <div className="doc"><div className="names">
          <div className="fname">{mobile ? 'Scan' : name}</div>
          <div className="fmeta">{pages.length} {pages.length === 1 ? 'page' : 'pages'}{sheets.length !== pages.length ? ` · ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}` : ''}{finding ? ' · finding the page…' : ''}</div>
        </div></div>
        {!mobile && <div className="privacy-pill"><Icon name="lock" size={14} />Processed on this device</div>}
        {mobile
          ? <button className="btn primary dl" onClick={() => setSheetOpen(true)} disabled={!pages.length}><Icon name="download" size={18} />Save</button>
          : <button className="btn primary dl" onClick={save} disabled={!pages.length}><Icon name="download" size={18} />Save PDF</button>}
      </header>
      <div className="sc-body">
        <main className="sc-main">
          {page ? (
            <div className="sc-view">
              <button className="sc-nav l" onClick={() => setCur(Math.max(0, cur - 1))} disabled={cur === 0} aria-label="Previous page"><Icon name="left" size={20} /></button>
              <div className="sc-paper">
                {r ? <img src={r.url} alt={`Page ${cur + 1}`} className={stale ? 'stale' : ''} style={{ aspectRatio: `${r.w} / ${r.h}` }} /> : <div className="sc-skel" />}
                {(stale || !r) && <div className="sc-working"><span className="spinner" />Straightening and cleaning…</div>}
                {!page.sure && !stale && (
                  <button className="sc-check" onClick={() => setCrop(page.id)}><Icon name="crop" size={16} />Check the corners</button>
                )}
              </div>
              <button className="sc-nav r" onClick={() => setCur(Math.min(pages.length - 1, cur + 1))} disabled={cur >= pages.length - 1} aria-label="Next page"><Icon name="right" size={20} /></button>
              <div className="sc-count num">{cur + 1} / {pages.length}{page.format ? ` · ${FORMAT_LABEL[page.format]}` : ''}{page.side ? ` · ${page.side === 'front' ? 'Front' : 'Back'}` : ''}</div>
            </div>
          ) : <div className="sc-empty">No pages yet</div>}

          {page && (
            <div className="sc-filters" role="radiogroup" aria-label="Look">
              {FILTERS.map((f) => {
                const u = previews[`${geoKey(page)}:${f.id}`];
                return (
                  <button key={f.id} role="radio" aria-checked={page.filter === f.id} className={`sc-ft${page.filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                    <span className="im">{u ? <img src={u} alt="" /> : <span className="spinner" />}</span>
                    <span className="lb">{f.label}</span>
                  </button>
                );
              })}
              {pages.length > 1 && <button className="sc-all" onClick={() => setFilter(page.filter, true)}>Use on all pages</button>}
            </div>
          )}

          {page && (
            <div className="sc-acts">
              <button onClick={() => setCrop(page.id)}><Icon name="crop" size={21} /><span>Crop</span></button>
              <button onClick={() => rotate(-1)}><Icon name="restore" size={21} /><span>Left</span></button>
              <button onClick={() => rotate(1)}><Icon name="rotate" size={21} /><span>Right</span></button>
              <button onClick={() => remove(page.id)} className="danger"><Icon name="trash" size={21} /><span>Delete</span></button>
              <button onClick={() => setView('camera')} className="add"><Icon name="camera-plus" size={21} /><span>Add page</span></button>
            </div>
          )}

          <div className="sc-strip">
            <SortableArea items={pages} idOf={(p) => p.id} layout="grid" onReorder={(next) => { const id = page?.id; setPages(next); if (id) setCur(next.findIndex((p) => p.id === id)); setSaved(false); }}
              overlay={(p) => <Thumb p={p} r={renders[p.id]} i={pages.indexOf(p)} on={false} />}>
              {pages.map((p, i) => <SortThumb key={p.id} p={p} r={renders[p.id]} i={i} on={i === cur} onClick={() => setCur(i)} />)}
            </SortableArea>
            <button className="sc-addtile" onClick={() => setView('camera')} aria-label="Add a page"><Icon name="plus" size={22} /></button>
          </div>
        </main>
        {!mobile && (
          <aside className="sc-side">
            <h3>Save as PDF</h3>
            {settings}
            <div className="sc-go">
              <button className="btn primary lg block" onClick={save} disabled={!pages.length}><Icon name="download" size={18} />Save PDF</button>
              <button className="btn secondary lg block" onClick={edit} disabled={!pages.length}><Icon name="pencil-simple" size={18} />Open in the editor</button>
            </div>
            <p className="sc-note"><Icon name="lock" size={13} />Photos and PDF stay on this device.</p>
          </aside>
        )}
      </div>
      {mobile && sheetOpen && createPortal(
        <div className="scrim sheet" onPointerDown={(e) => e.target === e.currentTarget && setSheetOpen(false)}>
          <div className="modal sc-sheet" role="dialog" aria-modal="true" aria-label="Save as PDF">
            <div className="grab" />
            <h2>Save as PDF</h2>
            {settings}
            <div className="sc-go">
              <button className="btn primary lg block" onClick={save}><Icon name="download" size={18} />{host.isNative ? 'Save or share PDF' : 'Save PDF'}</button>
              <button className="btn secondary lg block" onClick={edit}><Icon name="pencil-simple" size={18} />Open in the editor</button>
            </div>
          </div>
        </div>, document.body)}
      {crumbs}
    </div>
  );
}

function Thumb({ p, r, i, on }: { p: ScanPage; r?: Render; i: number; on: boolean }) {
  return (
    <span className={`sc-th${on ? ' on' : ''}`}>
      {r ? <img src={r.url} alt="" /> : <span className="spinner" />}
      <em className="num">{i + 1}</em>
      {!p.sure && <i className="warn" aria-label="Check the corners" />}
    </span>
  );
}

function SortThumb({ p, r, i, on, onClick }: { p: ScanPage; r?: Render; i: number; on: boolean; onClick: () => void }) {
  const { ref, style, pointer, grip, dragging } = useSortableItem(p.id);
  return (
    <button {...pointer} {...grip} ref={(el) => { ref(el); grip.ref(el); }} style={{ ...style, opacity: dragging ? 0.3 : 1 }} className="sc-thb" onClick={onClick} aria-label={`Page ${i + 1}`} aria-current={on}>
      <Thumb p={p} r={r} i={i} on={on} />
    </button>
  );
}

export { MODES };
