import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { Seg, Toggle } from '../Panel';
import type { BusyMsg, HostProps, ToastMsg } from '../Editor';
import { canShareFiles, saveFile, shareFile } from '../share';
import { ConfirmClose } from '../ConfirmClose';
import { useBack } from '../back';
import { SortableArea, useSortableItem } from '../sortable';
import type { Bp } from '../hooks';
import type { Quad } from './geom';
import type { Filter } from './kernels';
import { Camera, MODES, type ShotHint } from './Camera';
import { CropEditor } from './CropEditor';
import { EraseEditor } from './EraseEditor';
import { DropOverlay, isImage, useFileDrop } from '../drop';
import { Pager } from './Pager';
import { aiKey, eraseTag, stopAi, DEFAULT_FILTER, decode, findDocument, flattenPage, forget, forgetBases, gridOf, looksCurved, newId, outputSize, pixelsOf, renderLook, renderPage, renderThumbs, shapeOf, turnsFor, type Quality, type ScanMode, type ScanPage } from './engine';
import { findGutter, splitSpread } from './book';
import { buildScanPdf, jpegFor, sheetsOf, type PaperOpt } from './scanPdf';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'original', label: 'Original' }, { id: 'lighten', label: 'Lighten' }, { id: 'enhance', label: 'Enhance' }, { id: 'auto', label: 'Magic' },
  { id: 'color', label: 'Photo' }, { id: 'gray', label: 'Grey' }, { id: 'bw', label: 'B & W' },
];
const FILTER_IDS = FILTERS.map((f) => f.id);
const FORMAT_LABEL: Record<string, string> = { a4: 'A4', letter: 'Letter', legal: 'Legal', a5: 'A5', id1: 'ID card', id3: 'Passport' };

interface Render { key: string; url: string; w: number; h: number; quick?: boolean }
const keyOf = (p: ScanPage) => `${p.id}:${p.ver}`;
/** crop + turns: what the look previews and the compare picture depend on */
const geoKey = (p: ScanPage) => `${p.id}:${p.quad.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(';')}:${p.bend ? 1 : 0}:${p.rot}:${eraseTag(p)}`;

const readMode = (): ScanMode => { try { const m = localStorage.getItem('pe.scan.mode'); return (['doc', 'id', 'passport', 'receipt', 'book'] as const).find((x) => x === m) ?? 'doc'; } catch { return 'doc'; } };
const stamp = () => {
  const d = new Date(), z = (n: number) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`;
};

/**
 * The document scanner: camera (or photos) → automatic crop and straightening → clean-up filters →
 * a PDF at real paper size, optionally searchable. Everything runs on the device.
 */
export function Scanner({ host, bp, toast, setBusy, onClose, onOpenInEditor, onSaved }: {
  host: HostProps; bp: Bp; toast: (t: ToastMsg) => void; setBusy: (b: BusyMsg | null) => void;
  onClose: () => void; onOpenInEditor: (name: string, bytes: Uint8Array) => void; onSaved?: (name: string, bytes: Uint8Array) => void;
}) {
  const mobile = bp === 'mobile';
  const [mode, setModeState] = useState<ScanMode>(readMode);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [view, setView] = useState<'camera' | 'review'>('camera');
  const toCamera = () => setView('camera');
  const [cur, setCur] = useState(0);
  const [crop, setCrop] = useState<string | null>(null);
  const [erasing, setErasing] = useState<string | null>(null);
  const [renders, setRenders] = useState<Record<string, Render>>({});
  const [previews, setPreviews] = useState<Record<string, Record<string, string>>>({});
  // the page at the screen's full sharpness (and sharper still when you zoom in): a few pages' worth
  const [sharp, setSharp] = useState<Record<string, { key: string; url: string; long: number }>>({});
  const sharpBusy = useRef('');
  const [finding, setFinding] = useState(0);
  const [flattening, setFlattening] = useState(0);
  const findingRef = useRef(0);
  // Best by default: the page at the photo's full detail (remembered when changed)
  const [quality, setQualityState] = useState<Quality>(() => { try { const q = localStorage.getItem('pe.scan.quality'); return q === 'small' || q === 'standard' || q === 'high' ? q : 'high'; } catch { return 'high'; } });
  const setQuality = (q: Quality) => { setQualityState(q); try { localStorage.setItem('pe.scan.quality', q); } catch { /* private */ } };
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
  const add = useCallback(async (blob: Blob, kind: ScanMode, side?: 'front' | 'back', hint?: ShotHint) => {
    const id = newId();
    findingRef.current++;
    setFinding((n) => n + 1);
    try {
      const bmp = await decode(blob);
      const w = bmp.width, h = bmp.height;
      let found = await findDocument(bmp, kind, hint);
      if (kind === 'book') {
        // an open book: the two pages of the spread, cut at the gutter
        const px = pixelsOf(bmp, 700);
        const L = new Float32Array(px.w * px.h);
        for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = 0.299 * px.data[j] + 0.587 * px.data[j + 1] + 0.114 * px.data[j + 2];
        const halves = splitSpread(found.quad, found.bend, w, h, findGutter(found.quad, found.bend, L, px.w, px.h, px.scale));
        if (halves) {
          const made = halves.map((hf): ScanPage => ({
            id: newId(), blob, w, h, quad: hf.quad, auto: hf.quad, bend: hf.bend, autoBend: hf.bend, sure: found.sure, rot: 0,
            filter: DEFAULT_FILTER.book, kind: 'book', ...shapeOf(hf.quad, w, h, 'book', !!hf.bend), ver: 1,
          }));
          setPages((ps) => [...ps, ...made]);
          setSaved(false);
          return made[0];
        }
      }
      // a long narrow strip photographed in document mode is a till receipt: receipt page size
      if (kind === 'doc' && !found.format && found.sure && (found.ratio < 0.5 || found.ratio > 2)) {
        kind = 'receipt';
        found = { ...found, ...shapeOf(found.quad, w, h, kind, !!found.bend) };
      }
      const page: ScanPage = {
        id, blob, w, h, quad: found.quad, auto: found.quad, bend: found.bend, autoBend: found.bend, sure: found.sure, rot: 0,
        // a card photographed in document mode keeps its photo and colours
        filter: kind === 'doc' && (found.format === 'id1' || found.format === 'id3') ? 'color' : DEFAULT_FILTER[kind], kind, side, format: found.format, ratio: found.ratio, ver: 1,
      };
      // pages photographed sideways or upside down are turned upright after their first render
      setPages((ps) => [...ps, page]);
      setSaved(false);
      return page;
    } catch (e) {
      console.warn('scan: photo not usable', e);
      toast({ msg: 'That photo couldn’t be read.', kind: 'err' });
      return null;
    } finally { findingRef.current--; setFinding((n) => n - 1); }
  }, [toast]);

  // Done in the camera while the last photo is still being taken or read: the review opens once it is in
  const [toReview, setToReview] = useState(false);
  const goReview = () => {
    if (findingRef.current > 0) { setToReview(true); return; }
    setView('review'); setCur(Math.max(0, pagesRef.current.length - 1));
  };
  useEffect(() => {
    if (!toReview || finding > 0) return;
    setToReview(false);
    if (pagesRef.current.length) { setView('review'); setCur(Math.max(0, pagesRef.current.length - 1)); }
  }, [toReview, finding]);

  const idCount = pages.filter((p) => p.kind === 'id').length;
  const onShot = useCallback((blob: Blob, hint?: ShotHint) => {
    const m = mode;
    if (m === 'id') {
      const n = pagesRef.current.filter((p) => p.kind === 'id').length + 0;
      const side = n % 2 === 0 ? 'front' : 'back';
      add(blob, 'id', side, hint).then(() => { if (side === 'back') { setView('review'); setCur(pagesRef.current.length - 1); } });
      return;
    }
    add(blob, m, undefined, hint).then(() => { if (m === 'passport') { setView('review'); setCur(pagesRef.current.length - 1); } });
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
  // photos dragged in from the computer: more pages
  const photoDrop = useFileDrop((f) => onImport(f), { accept: isImage, onReject: () => toast({ msg: 'Drop photos (JPG, PNG, HEIC) to add pages', kind: 'err' }) });

  // ---- rendering. The page on screen first: a quick look within a moment, then the cleaned page. The
  // straightened page is kept, so changing the look or turning only redoes the last step. Then the
  // previews of every look, the pages next to it (for swiping), the rest, and — once you pause — the
  // pages at saving quality in the background (so Save only has to put the PDF together).
  const inflight = useRef(new Set<string>());
  const finals = useRef(new Map<string, Blob>());
  const [kick, setKick] = useState(0);
  const [compare, setCompare] = useState(false);
  const [origs, setOrigs] = useState<Record<string, string>>({});
  const lastAct = useRef(0);
  const done = () => setKick((n) => n + 1);
  const LONG = mobile ? 1200 : 1600;
  useEffect(() => {
    const list = pagesRef.current;
    const busy = inflight.current;
    const start = (key: string, run: () => Promise<unknown>) => { busy.add(key); run().catch((e) => console.warn('scan render failed', e)).finally(() => { busy.delete(key); done(); }); };
    const room = () => busy.size < 2;
    const ci = Math.min(curRef.current, list.length - 1);
    const p = list[ci];
    const look = (q: ScanPage) => {
      const key = keyOf(q);
      if (renders[q.id]?.key === key || busy.has('v' + key)) return false;
      // the first look at a fresh page also reads which way its text runs
      const orient = q.ver === 1;
      start('v' + key, () => renderLook(q, { long: LONG, orient }).then((r) => {
        setRenders((rs) => { const old = rs[q.id]; if (old) URL.revokeObjectURL(old.url); return { ...rs, [q.id]: { key, url: r.url, w: r.w, h: r.h } }; });
        const t = orient ? turnsFor(q, r.orient) : null;
        if (t) setPages((ps) => ps.map((x) => (x.id === q.id && x.ver === q.ver ? { ...x, rot: t, ver: x.ver + 1 } : x)));
        // a curved sheet (once it is upright): the AI flattening is worked out in the background
        else if (looksCurved(q, r.bent)) flatten(q);
      }));
      return true;
    };
    const flatten = (q: ScanPage) => {
      const k = 'a' + q.id + aiKey(q);
      if (busy.has(k)) return;
      busy.add(k);
      setFlattening((n) => n + 1);
      flattenPage(q).then((ai) => {
        // kept when the crop hasn't changed meanwhile; a page that gets the AI map is drawn again
        setPages((ps) => ps.map((x) => (x.id === q.id && aiKey(x) === ai.key ? { ...x, ai, ver: ai.grid && !x.aiOff ? x.ver + 1 : x.ver } : x)));
      }).finally(() => { busy.delete(k); setFlattening((n) => n - 1); });
    };
    const quick = (q: ScanPage) => {
      if (renders[q.id] || busy.has('q' + q.id)) return;
      start('q' + q.id, () => renderPage(q, { quality: 'standard', long: 640, quick: true, jpeg: 0.8 }).then((r) => {
        setRenders((rs) => { if (rs[q.id]) { URL.revokeObjectURL(r.url); return rs; } return { ...rs, [q.id]: { key: 'quick', url: r.url, w: r.w, h: r.h, quick: true } }; });
      }));
    };
    if (p) {
      if (room()) quick(p);
      if (room()) look(p);
      if (view === 'review' && compare) {
        const k = geoKey(p);
        if (origs[k] === undefined && !busy.has('o' + k)) {
          if (!room()) return;
          start('o' + k, () => renderLook(p, { long: LONG, filter: 'original', noErase: true }).then((r) => setOrigs((o) => ({ ...o, [k]: r.url })), () => setOrigs((o) => ({ ...o, [k]: '' }))));
        }
      }
      if (view === 'review') {
        const k = geoKey(p);
        if (previews[k] === undefined && !busy.has('t' + k)) {
          if (!room()) return;
          start('t' + k, () => renderThumbs(p, FILTER_IDS, LONG, mobile ? 150 : 180).then((u) => setPreviews((pv) => ({ ...pv, [k]: u })), () => setPreviews((pv) => ({ ...pv, [k]: {} }))));
        }
        if (previews[k] === undefined) return;
      }
    }
    // the pages either side (for swiping), then the rest
    const order = [list[ci + 1], list[ci - 1], ...list].filter(Boolean) as ScanPage[];
    for (const q of order) { if (!room()) return; look(q); }
    if (order.some((q) => renders[q.id]?.key !== keyOf(q))) return;
    // pages at saving quality, ready for Save: one at a time, once you pause, and only with a worker to spare
    if ((navigator.hardwareConcurrency ?? 2) < 4 || busy.size) return;
    const idle = performance.now() - lastAct.current;
    if (idle < 1500) { const t = setTimeout(done, 1600 - idle); return () => clearTimeout(t); }
    for (const q of list) {
      const k = `f${keyOf(q)}:${quality}`;
      if (finals.current.has(k)) continue;
      start(k, () => renderPage(q, { quality, low: true, jpeg: jpegFor(quality) }).then((r) => {
        URL.revokeObjectURL(r.url);
        for (const old of [...finals.current.keys()]) if (old.startsWith(`f${q.id}:`)) finals.current.delete(old);
        finals.current.set(k, r.blob);
      }));
      return;
    }
  }, [pages, cur, renders, previews, origs, compare, view, kick, mobile, quality, LONG]);
  // every change counts as activity (holds back the background saving renders a moment)
  useEffect(() => { lastAct.current = performance.now(); }, [pages, cur, compare]);

  // tidy up object URLs when leaving
  const live = useRef({ renders, previews, origs, sharp }); live.current = { renders, previews, origs, sharp };
  useEffect(() => () => {
    const l = live.current;
    Object.values(l.sharp).forEach((r) => URL.revokeObjectURL(r.url));
    Object.values(l.renders).forEach((r) => URL.revokeObjectURL(r.url));
    Object.values(l.previews).forEach((m) => Object.values(m).forEach((u) => u && URL.revokeObjectURL(u)));
    Object.values(l.origs).forEach((u) => u && URL.revokeObjectURL(u));
    pagesRef.current.forEach((p) => forget(p.blob));
    forgetBases();
    stopAi();
  }, []);

  const page = pages[Math.min(cur, pages.length - 1)] as ScanPage | undefined;
  const wantSharp = (id: string, want: number) => {
    const q = pagesRef.current.find((x) => x.id === id);
    if (!q) return;
    const key = keyOf(q);
    // by pixels, not the longest side: a long receipt gets the same sharpness across as a sheet
    const thin = Math.min(q.ratio, 1 / q.ratio);
    const cap = Math.round(Math.min(5200, Math.sqrt((mobile ? 5.6e6 : 8.2e6) / Math.max(0.05, thin))));
    // a little over the screen's pixels, in steps (so a small change in size doesn't render again)
    const long = want > 0 ? Math.min(cap, Math.ceil(want / 200) * 200) : cap;
    const have = live.current.sharp[id];
    if ((have?.key === key && have.long >= long) || sharpBusy.current.startsWith(id + key)) return;
    sharpBusy.current = id + key + ':' + long;
    renderLook(q, { long, jpeg: 0.9 }).then((r) => {
      setSharp((m) => {
        const next = { ...m, [id]: { key, url: r.url, long } };
        if (m[id]) URL.revokeObjectURL(m[id].url);
        // keep the latest three pages
        const ids = Object.keys(next);
        for (const k of ids.slice(0, Math.max(0, ids.length - 3))) { URL.revokeObjectURL(next[k].url); delete next[k]; }
        return next;
      });
    }, () => { /* the normal picture stays */ }).finally(() => { if (sharpBusy.current === id + key + ':' + long) sharpBusy.current = ''; });
  };
  const lastThumb = pages.length ? renders[pages[pages.length - 1].id]?.url ?? null : null;
  const step = mode === 'id' ? (idCount % 2 === 0 ? 'Front side' : 'Back side') : mode === 'passport' ? 'Photo page' : mode === 'book' ? 'Both pages of the open book' : null;

  // ---- page actions
  const rotate = (d: number) => page && patch(page.id, (p) => ({ rot: (p.rot + d + 4) % 4 }));
  const remove = (id: string) => {
    const i = pages.findIndex((p) => p.id === id);
    setPages((ps) => ps.filter((p) => p.id !== id));
    setCur((c) => Math.max(0, Math.min(c >= i ? c - 1 : c, pages.length - 2)));
    if (pages.length <= 1) toCamera();
  };
  const setFilter = (f: Filter, all = false) => {
    if (all) { setPages((ps) => ps.map((p) => (p.filter === f ? p : { ...p, filter: f, ver: p.ver + 1 }))); setSaved(false); }
    else if (page) patch(page.id, () => ({ filter: f }));
  };
  const applyCrop = (q: Quad) => {
    const p = pages.find((x) => x.id === crop);
    // corners moved by hand: straight sides (the found curve only fits the found corners)
    const same = (a: Quad | null) => !!a && a.every((c, i) => Math.hypot(c.x - q[i].x, c.y - q[i].y) < 0.5);
    if (p) {
      const bend = same(p.auto) ? p.autoBend : same(p.quad) ? p.bend : null;
      patch(p.id, () => ({ quad: q, bend, sure: true, ...shapeOf(q, p.w, p.h, p.kind, !!bend) }));
    }
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
        ready: (p) => finals.current.get(`f${keyOf(p)}:${quality}`),
        progress: (f, msg) => setBusy({ title, detail: msg, progress: f }),
      });
    } finally { setBusy(null); }
  };
  const save = async (share = false): Promise<boolean> => {
    if (!pages.length) return false;
    try {
      const bytes = await build();
      if (share) await shareFile(host, bytes, fileName, 'application/pdf', toast);
      else await saveFile(host, bytes, fileName, 'application/pdf', toast);
      onSaved?.(fileName, bytes);
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

  // the web app on a phone: a separate Share (the Android app's Save already opens the share sheet)
  const canShare = useMemo(() => !host.isNative && canShareFiles(), [host.isNative]);

  // phone / browser back: sheet → camera → leave (asks first when pages aren't saved)
  useBack(() => {
    if (sheetOpen) setSheetOpen(false);
    else if (view === 'camera' && pages.length) setView('review');
    else close();
  });
  // Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (crop || erasing || askClose || sheetOpen) return;
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea');
      if (view === 'review' && !typing && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        setCur((c) => Math.max(0, Math.min(pages.length - 1, c + (e.key === 'ArrowLeft' ? -1 : 1))));
        return;
      }
      if (e.key !== 'Escape') return;
      if (compare) { setCompare(false); return; }
      if (view === 'review') toCamera(); else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const crumbs = (
    <>
      {erasing && pages.find((p) => p.id === erasing) && <EraseEditor page={pages.find((p) => p.id === erasing)!} long={LONG}
        onApply={(st) => { const id = erasing; setErasing(null); patch(id, () => ({ erase: st.length ? st : undefined })); }} onCancel={() => setErasing(null)} />}
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
        <Camera mode={mode} onMode={setMode} count={pages.length + finding} lastThumb={lastThumb} step={step} waiting={toReview}
          onShot={onShot} onImport={onImport} onDone={goReview} onClose={pages.length ? () => setView('review') : close} />
        {finding > 0 && <div className="scam-finding" role="status"><span className="spinner" />{toReview ? 'Finishing the last page…' : 'Finding the page…'}</div>}
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
    <div className="scr" {...photoDrop.bind}>
      <DropOverlay show={photoDrop.over} title="Drop photos to add pages" sub="Each photo is straightened and cleaned like a scan" icon="image" />
      <header className="topbar">
        <button className="ibtn" onClick={close} aria-label="Close scanner"><Icon name="back" /></button>
        <div className="doc"><div className="names">
          <div className="fname">{mobile ? 'Scan' : name}</div>
          <div className="fmeta">{pages.length} {pages.length === 1 ? 'page' : 'pages'}{sheets.length !== pages.length ? ` · ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}` : ''}{finding ? ' · finding the page…' : ''}</div>
        </div></div>
        {!mobile && <div className="privacy-pill"><Icon name="lock" size={14} />Processed on this device</div>}
        {mobile
          ? <button className="btn primary dl" onClick={() => setSheetOpen(true)} disabled={!pages.length}><Icon name="download" size={18} />Save</button>
          : <button className="btn primary dl" onClick={() => save()} disabled={!pages.length}><Icon name="download" size={18} />Save PDF</button>}
      </header>
      <div className="sc-body">
        <main className="sc-main">
          {page ? (
            <div className="sc-view">
              <button className="sc-nav l" onClick={() => setCur(Math.max(0, cur - 1))} disabled={cur === 0} aria-label="Previous page"><Icon name="left" size={20} /></button>
              <Pager pages={pages} renders={renders} cur={Math.min(cur, pages.length - 1)} onCur={setCur} onAdd={toCamera} keyOf={keyOf}
                compare={compare} orig={origs[geoKey(page)] || undefined} label={FILTERS.find((f) => f.id === page.filter)?.label ?? ''} onCheck={setCrop}
                sharp={sharp} onSharp={wantSharp} />
              <button className="sc-nav r" onClick={() => setCur(Math.min(pages.length - 1, cur + 1))} disabled={cur >= pages.length - 1} aria-label="Next page"><Icon name="right" size={20} /></button>
            </div>
          ) : <div className="sc-empty">No pages yet</div>}

          {page && (
            <div className="sc-under">
              <span className="sc-count num">{cur + 1} / {pages.length}{page.format ? ` · ${FORMAT_LABEL[page.format]}` : ''}{page.side ? ` · ${page.side === 'front' ? 'Front' : 'Back'}` : ''}</span>
              {page.ai?.key === aiKey(page) && page.ai.grid
                ? <button className={`sc-cmp${page.aiOff ? '' : ' on'}`} onClick={() => patch(page.id, (p) => ({ aiOff: !p.aiOff }))} aria-pressed={!page.aiOff}
                  title={page.aiOff ? 'Flatten the curved page with AI (on this device)' : 'Curved page flattened with AI (on this device). Tap to undo'}><Icon name="sparkle" size={17} />{page.aiOff ? 'Flatten' : 'Flattened'}</button>
                : flattening > 0 && !page.ai ? <span className="sc-count" role="status"><span className="spinner" /> Flattening…</span> : null}
              <button className={`sc-cmp${compare ? ' on' : ''}`} onClick={() => setCompare(!compare)} aria-pressed={compare}><Icon name="split-horizontal" size={17} />Compare</button>
            </div>
          )}

          {page && (
            <div className="sc-filters" role="radiogroup" aria-label="Look">
              {FILTERS.map((f) => {
                const u = previews[geoKey(page)]?.[f.id];
                return (
                  <button key={f.id} role="radio" aria-checked={page.filter === f.id} className={`sc-ft${page.filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                    <span className="im">{u ? <img src={u} alt="" /> : <span className="spinner" />}<span className="lb">{f.label}</span></span>
                  </button>
                );
              })}
              {pages.length > 1 && <button className="sc-all" onClick={() => setFilter(page.filter, true)}>Use on all pages</button>}
            </div>
          )}

          {page && (
            <div className="sc-acts">
              <button onClick={() => setCrop(page.id)}><Icon name="crop" size={21} /><span>Crop</span></button>
              <button onClick={() => setErasing(page.id)} className={page.erase?.length ? 'on' : ''}><Icon name="eraser" size={21} /><span>Remove</span></button>
              <button onClick={() => rotate(-1)}><Icon name="restore" size={21} /><span>Left</span></button>
              <button onClick={() => rotate(1)}><Icon name="rotate" size={21} /><span>Right</span></button>
              <button onClick={() => remove(page.id)} className="danger"><Icon name="trash" size={21} /><span>Delete</span></button>
              <button onClick={toCamera} className="add"><Icon name="camera-plus" size={21} /><span>Add page</span></button>
            </div>
          )}

          <div className="sc-strip">
            <SortableArea items={pages} idOf={(p) => p.id} layout="grid" onReorder={(next) => { const id = page?.id; setPages(next); if (id) setCur(next.findIndex((p) => p.id === id)); setSaved(false); }}
              overlay={(p) => <Thumb p={p} r={renders[p.id]} i={pages.indexOf(p)} on={false} />}>
              {pages.map((p, i) => <SortThumb key={p.id} p={p} r={renders[p.id]} i={i} on={i === cur} onClick={() => setCur(i)} />)}
            </SortableArea>
            <button className="sc-addtile" onClick={toCamera} aria-label="Add a page"><Icon name="plus" size={22} /></button>
          </div>
        </main>
        {!mobile && (
          <aside className="sc-side">
            <h3>Save as PDF</h3>
            {settings}
            <div className="sc-go">
              <button className="btn primary lg block" onClick={() => save()} disabled={!pages.length}><Icon name="download" size={18} />Save PDF</button>
              {canShare && <button className="btn secondary lg block" onClick={() => save(true)} disabled={!pages.length}><Icon name="share-network" size={18} />Share PDF</button>}
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
              <button className="btn primary lg block" onClick={() => save()}><Icon name="download" size={18} />{host.isNative ? 'Save or share PDF' : 'Save PDF'}</button>
              {canShare && <button className="btn secondary lg block" onClick={() => save(true)}><Icon name="share-network" size={18} />Share PDF</button>}
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

