import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gesture } from './gesture';
import { Icon } from './icons';
import { openPdf } from './pdfjs';
import { useHistory, uid, Tool, ToolStyle, RunEdit } from './store';
import { PageView, PageInfo, PageData, FillMark } from './PageView';
import { SignatureModal, Stamp } from './SignatureModal';
import { Organizer } from './Organizer';
import { Loupe } from './Loupe';
import { Thumb } from './Thumb';
import { RunProps, ObjProps, ToolProps, IdleProps, ChangeItem, OBJ_TITLE, Stepper, toolHasProps, fontLabel, Toggle } from './Panel';
import { readFields, FormField, isFilled } from './Fields';
import { exportPdf } from '../engine/exporter';
import type { EditorObject, TextEdit, FontFamily } from '../engine/types';
import type { FontInfo } from '../engine/pdfText';
import type { Bp, Theme } from './hooks';
import { ThemeButton } from './Start';

export interface HostProps {
  isNative?: boolean;
  pickPdf?: () => Promise<{ name: string; base64: string } | null>;
  savePdf?: (base64: string, name: string) => Promise<string | void>;
}
export interface ToastMsg { msg: string; kind?: 'ok' | 'err'; action?: { label: string; run: () => void } }
export interface BusyMsg { title: string; detail?: string; progress?: number }

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
  toast({ msg: `Saved ${name}`, action: type === 'application/pdf' ? { label: 'Open', run: () => window.open(url, '_blank') } : undefined });
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_Z = 0.25, MAX_Z = 4;
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

type RailItem = { t: Tool | 'shapes' | 'pages'; label: string; icon: string };
const RAIL: RailItem[] = [
  { t: 'edit', label: 'Edit', icon: 'edit' },
  { t: 'fill', label: 'Fill form', icon: 'fill' },
  { t: 'text', label: 'Add text', icon: 'text' },
  { t: 'sign', label: 'Sign', icon: 'sign' },
  { t: 'image', label: 'Image', icon: 'image' },
  { t: 'whiteout', label: 'Whiteout', icon: 'whiteout' },
  { t: 'highlight', label: 'Highlight', icon: 'highlight' },
  { t: 'shapes', label: 'Shapes', icon: 'shapes' },
  { t: 'draw', label: 'Draw', icon: 'draw' },
  { t: 'pages', label: 'Pages', icon: 'pages' },
];
const SHAPES: [Tool, string, string][] = [['rect', 'Box', 'rect'], ['ellipse', 'Circle', 'ellipse'], ['line', 'Line', 'line']];

export function Editor({ host, file, pdf, infos, hist, onClose, onTools, theme, onTheme, bp, toast, setBusy }: {
  host: HostProps; file: { name: string; bytes: Uint8Array }; pdf: any; infos: PageInfo[];
  hist: ReturnType<typeof useHistory>; onClose: () => void; onTools: () => void;
  theme: Theme; onTheme: () => void; bp: Bp; toast: (t: ToastMsg) => void; setBusy: (b: BusyMsg | null) => void;
}) {
  const { snap, commit } = hist;
  const mobile = bp === 'mobile', tablet = bp === 'tablet', large = bp === 'large', desk = bp === 'desktop' || large;
  const [tool, setTool] = useState<Tool>('edit');
  const [style, setStyle] = useState<ToolStyle>({
    color: '#000000', stroke: '#1E2559', fill: null, strokeWidth: 2, fontSize: 14, family: 'Helvetica', highlight: '#FFE14D',
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pageData, setPageData] = useState<Record<number, PageData>>({});
  const [fonts, setFonts] = useState<Record<string, FontInfo>>({});
  const [showSig, setShowSig] = useState<null | { field?: FormField }>(null);
  const [view, setView] = useState<'doc' | 'pages'>('doc');
  const [shapesOpen, setShapesOpen] = useState(false);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  const [slimOpen, setSlimOpen] = useState(false);
  const [dragInfo, setDragInfo] = useState<{ x: number; y: number; id: string; page: number } | null>(null);
  const [curPage, setCurPage] = useState(0);
  const [fields, setFields] = useState<FormField[]>([]);
  const [activeField, setActiveField] = useState<string | null>(null);
  const [fillMark, setFillMark] = useState<FillMark | null>(null);
  const [flatten, setFlatten] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const shapesBtn = useRef<HTMLButtonElement>(null);
  const ratios = useRef<Record<number, number>>({});

  useEffect(() => { readFields(pdf, infos.map((i) => i.vm)).then(setFields).catch(() => setFields([])); }, [pdf, infos]);

  // ----- zoom -----
  const fitZoom = () => {
    const el = wrapRef.current;
    if (!el) return 1;
    const maxW = Math.max(...infos.map((i) => i.w));
    const pad = mobile ? 24 : tablet ? 64 : 80;
    const cap = large ? 820 : desk ? 760 : 10000;
    return clampZ(Math.min(el.clientWidth - pad, cap) / maxW);
  };
  useEffect(() => { setZoom(fitZoom()); }, [infos]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  type Anchor = { el: HTMLElement; fx: number; fy: number; cx: number; cy: number };
  const pendingAnchor = useRef<Anchor | null>(null);
  const anchorAt = (cx: number, cy: number): Anchor | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    wrap.querySelectorAll<HTMLElement>('.pageOuter').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (d < bestD) { bestD = d; best = el; }
    });
    if (!best) return null;
    const r = (best as HTMLElement).getBoundingClientRect();
    return { el: best, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height, cx, cy };
  };
  const applyAnchor = (a: Anchor) => {
    const wrap = wrapRef.current;
    if (!wrap || !a.el.isConnected) return;
    const r = a.el.getBoundingClientRect();
    wrap.scrollLeft += r.left + a.fx * r.width - a.cx;
    wrap.scrollTop += r.top + a.fy * r.height - a.cy;
  };
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    pendingAnchor.current = null;
    if (a) applyAnchor(a);
  }, [zoom]);
  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const wrap = wrapRef.current;
    if (!wrap) { setZoom(clampZ(z)); return; }
    const wr = wrap.getBoundingClientRect();
    const a = anchorAt(cx ?? wr.left + wr.width / 2, cy ?? wr.top + wr.height / 2);
    const nz = clampZ(z);
    if (a) {
      if (Math.abs(nz - zoomRef.current) < 1e-4) { applyAnchor(a); return; }
      pendingAnchor.current = a;
    }
    setZoom(nz);
  };
  const zoomStep = (dir: 1 | -1) => {
    const z = zoomRef.current;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.01) ?? MAX_Z : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.01) ?? MIN_Z;
    zoomTo(next);
  };

  // two fingers: pinch to zoom and drag to pan; double-tap toggles fit width / 200%
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let start: null | { d: number; z: number; anchor: Anchor } = null;
    let frame = 0;
    let latest: TouchList | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; t: number } | null = null;
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const begin = (t: TouchList) => {
      const m = mid(t);
      const anchor = anchorAt(m.x, m.y);
      start = anchor ? { d: dist(t), z: zoomRef.current, anchor } : null;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        gesture.multi = true;
        tapStart = null;
        (document.activeElement as HTMLElement | null)?.blur?.();
        begin(e.touches);
        if (e.cancelable) e.preventDefault();
      } else if (e.touches.length === 1) {
        tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (tapStart && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tapStart.x, e.touches[0].clientY - tapStart.y) > 10) tapStart = null;
      if (e.touches.length < 2 || !start) return;
      if (e.cancelable) e.preventDefault();
      latest = e.touches;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!latest || latest.length < 2 || !start) return;
        const m = mid(latest);
        const z = clampZ(start.z * (dist(latest) / start.d));
        const a = { ...start.anchor, cx: m.x, cy: m.y };
        if (Math.abs(z - zoomRef.current) < 0.002) applyAnchor(a);
        else { pendingAnchor.current = a; setZoom(z); }
      });
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) { begin(e.touches); return; }
      start = null;
      latest = null;
      if (e.touches.length === 0) setTimeout(() => { gesture.multi = false; }, 0);
      // double tap on paper or desk (not on text, objects or fields)
      if (tapStart && e.touches.length === 0 && Date.now() - tapStart.t < 300) {
        const tgt = e.target as HTMLElement;
        const free = !tgt.closest('.run, .obj, .ff, .ffbox, .ffsig, .objbar') && tool !== 'draw';
        const now = Date.now();
        if (free && lastTap && now - lastTap.t < 320 && Math.hypot(tapStart.x - lastTap.x, tapStart.y - lastTap.y) < 30) {
          const fit = fitZoom();
          zoomTo(Math.abs(zoomRef.current - fit) < 0.05 ? 2 : fit, tapStart.x, tapStart.y);
          lastTap = null;
          if (e.cancelable) e.preventDefault();
        } else lastTap = free ? { t: now, x: tapStart.x, y: tapStart.y } : null;
      }
      tapStart = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
  });

  // ----- object helpers -----
  const addObject = (o: EditorObject) => commit((s) => ({ ...s, objects: [...s.objects, o] }));
  const changeObject = (id: string, patch: Partial<EditorObject>, merge: boolean) =>
    commit((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as EditorObject) : o)) }), merge);
  const removeObject = (id: string) => {
    commit((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id) }));
    setSelected((cur) => (cur === id ? null : cur));
    setEditing((cur) => (cur === id ? null : cur));
    setSheetFor(null);
  };
  const duplicateObject = (id: string) => {
    const o = snap.objects.find((x) => x.id === id);
    if (!o) return;
    const nid = uid();
    setEditing(null);
    addObject({ ...o, id: nid, x: o.x + 8, y: o.y + 8, ...(o.type === 'line' ? { x2: o.x2 + 8, y2: o.y2 + 8 } : {}) } as EditorObject);
    setSelected(nid);
  };
  const setRunEdit = (key: string, e: RunEdit | null) => commit((s) => {
    const edits = { ...s.edits };
    if (e) edits[key] = e; else delete edits[key];
    return { ...s, edits };
  });
  /** finish typing first (commits the text), then apply */
  const afterBlur = (fn: () => void) => { (document.activeElement as HTMLElement | null)?.blur?.(); setTimeout(fn, 0); };

  const stopEditing = (id: string) => {
    setEditing((cur) => (cur === id ? null : cur));
    commit((s) => {
      const o = s.objects.find((x) => x.id === id);
      if (o && o.type === 'text' && !o.text.trim()) return { ...s, objects: s.objects.filter((x) => x.id !== id) };
      return s;
    }, true);
  };

  const lastField = useRef<string | null>(null);
  const setFieldValue = (name: string, v: string | boolean) => {
    const merge = typeof v === 'string' && lastField.current === name;
    lastField.current = typeof v === 'string' ? name : null;
    commit((s) => ({ ...s, forms: { ...s.forms, [name]: v } }), merge);
  };

  const currentPage = () => {
    let best = snap.pages[0]?.src ?? 0;
    let r = -1;
    for (const p of snap.pages) if ((ratios.current[p.src] ?? 0) > r) { r = ratios.current[p.src] ?? 0; best = p.src; }
    return best;
  };

  const placeStamp = (st: Stamp, type: 'signature' | 'image', field?: FormField) => {
    const page = field ? field.page : currentPage();
    const info = infos[page];
    let w: number, h: number, x: number, y: number;
    if (field) {
      const k = Math.min(field.w / st.w, field.h / st.h) * 0.92;
      w = st.w * k; h = st.h * k; x = field.x + (field.w - w) / 2; y = field.y + (field.h - h) / 2;
    } else {
      const maxW = type === 'signature' ? Math.min(180, info.w * 0.4) : Math.min(260, info.w * 0.6);
      w = Math.min(maxW, st.w); h = (w * st.h) / st.w;
      x = (info.w - w) / 2;
      // centre of the visible part of the page
      const el = wrapRef.current?.querySelector<HTMLElement>(`.pageOuter[data-src="${page}"]`);
      const wr = wrapRef.current?.getBoundingClientRect();
      if (el && wr) {
        const r = el.getBoundingClientRect();
        const vis = (Math.max(r.top, wr.top) + Math.min(r.bottom, wr.bottom)) / 2;
        y = Math.max(8, Math.min(info.h - h - 8, (vis - r.top) / zoom - h / 2));
      } else y = (info.h - h) / 2;
    }
    const id = uid();
    addObject({ id, page, type, x, y, w, h, src: st.src });
    setSelected(id);
    if (!field) setTool('edit');
  };

  const onImage = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        let src = r.result as string;
        if (!/^data:image\/(png|jpe?g)/.test(src)) {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d')!.drawImage(im, 0, 0);
          src = c.toDataURL('image/png');
        }
        placeStamp({ src, w: im.naturalWidth, h: im.naturalHeight }, 'image');
      };
      im.onerror = () => toast({ msg: 'Couldn’t place image', kind: 'err' });
      im.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const textEdits = (editsObj: Record<string, RunEdit>): TextEdit[] => {
    const out: TextEdit[] = [];
    for (const [key, e] of Object.entries(editsObj)) {
      const page = +key.split(':')[0];
      const run = pageData[page]?.runs.find((r) => r.key === key);
      if (!run) continue;
      const font = fonts[run.fontName];
      out.push({
        page, key, region: run.region, text: e.text, sizeScale: e.sizeScale, color: e.color,
        charMap: font?.charMap ?? {}, fallback: font?.fallback ?? { family: 'Helvetica', bold: false, italic: false },
        bgColor: pageData[page]?.colors[key]?.bg ?? '#ffffff',
      });
    }
    return out;
  };

  // ----- live preview: re-write edited pages with the real fonts and show that -----
  const editKeyOf = (src: number) => {
    const list = Object.entries(snap.edits).filter(([k]) => k.startsWith(src + ':')).sort(([a], [b]) => (a < b ? -1 : 1));
    return list.length ? JSON.stringify(list) : '';
  };
  const [preview, setPreview] = useState<{ pdf: any; keys: Record<number, string> } | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const edits = textEdits(snap.edits);
    if (!edits.length) { setPreview(null); return; }
    const keys: Record<number, string> = {};
    for (const e of edits) keys[e.page] = editKeyOf(e.page);
    const t = setTimeout(async () => {
      try {
        const bytes = await exportPdf({
          bytes: file.bytes, pages: infos.map((_, i) => ({ src: i, rotation: 0 })), objects: [], edits,
          viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])),
        });
        if (seq !== previewSeq.current) return;
        const doc = await openPdf(bytes);
        if (seq !== previewSeq.current) { doc.destroy?.(); return; }
        setPreview((old) => { if (old?.pdf && old.pdf !== pdf) setTimeout(() => old.pdf.destroy?.(), 2000); return { pdf: doc, keys }; });
      } catch (err) {
        console.warn('preview failed', err);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.edits]);

  // ----- export -----
  const editCount = Object.keys(snap.edits).length + snap.objects.length + Object.keys(snap.forms).length;
  const download = async () => {
    setEditing(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    setBusy({ title: 'Preparing your PDF', detail: `Writing ${editCount || 'your'} ${editCount === 1 ? 'change' : 'changes'} into ${snap.pages.length} ${snap.pages.length === 1 ? 'page' : 'pages'}. Nothing is uploaded.` });
    try {
      const bytes = await exportPdf({
        bytes: file.bytes, pages: snap.pages, objects: snap.objects, edits: textEdits(snap.edits),
        viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])), forms: snap.forms, flatten,
      });
      const name = file.name.replace(/\.pdf$/i, '') + '-edited.pdf';
      setBusy(null);
      await saveFile(host, bytes, name, 'application/pdf', toast);
    } catch (e: any) {
      console.error(e);
      toast({ msg: 'The PDF could not be saved: ' + (e?.message || 'unknown error'), kind: 'err', action: { label: 'Retry', run: download } });
    } finally {
      setBusy(null);
    }
  };

  const findRun = (key: string) => pageData[+key.split(':')[0]]?.runs.find((r) => r.key === key);
  const selRun = selected?.includes(':') ? findRun(selected) : undefined;
  const selObj = selected && !selected.includes(':') ? snap.objects.find((o) => o.id === selected) : undefined;

  const nextRun = (key: string) => {
    const page = +key.split(':')[0];
    const order = snap.pages.map((p) => p.src);
    for (let pi = order.indexOf(page); pi < order.length; pi++) {
      const runs = pageData[order[pi]]?.runs ?? [];
      const i = order[pi] === page ? runs.findIndex((r) => r.key === key) + 1 : 0;
      if (runs[i]) { setSelected(runs[i].key); setEditing(runs[i].key); return; }
    }
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); hist.redo(); }
      else if (mod && k === '0') { e.preventDefault(); zoomTo(fitZoom()); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); }
      else if (mod && k === '-') { e.preventDefault(); zoomStep(-1); }
      else if (mod && k === 'd' && selObj) { e.preventDefault(); duplicateObject(selObj.id); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        if (selRun) setRunEdit(selRun.key, { text: '', sizeScale: 1, color: null });
        else if (selObj) removeObject(selObj.id);
        setSelected(null);
      } else if (e.key.startsWith('Arrow') && selObj) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        changeObject(selObj.id, { x: selObj.x + dx, y: selObj.y + dy, ...(selObj.type === 'line' ? { x2: selObj.x2 + dx, y2: selObj.y2 + dy } : {}) } as any, false);
      } else if (e.key === 'Escape') {
        if (view === 'pages') setView('doc');
        setSelected(null); setShapesOpen(false); setSheetFor(null);
        if (!selected) setTool('edit');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const objectsByPage = useMemo(() => {
    const m: Record<number, EditorObject[]> = {};
    for (const o of snap.objects) (m[o.page] ??= []).push(o);
    return m;
  }, [snap.objects]);
  const fieldsByPage = useMemo(() => {
    const m: Record<number, FormField[]> = {};
    for (const f of fields) (m[f.page] ??= []).push(f);
    return m;
  }, [fields]);
  const fillable = useMemo(() => {
    // one entry per field name (radio groups have several widgets), in page order
    const seen = new Set<string>();
    const order = new Map(snap.pages.map((p, i) => [p.src, i]));
    return fields.filter((f) => order.has(f.page) && !f.readOnly)
      .sort((a, b) => (order.get(a.page)! - order.get(b.page)!) || (a.y - b.y) || (a.x - b.x))
      .filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
  }, [fields, snap.pages]);

  const pickTool = (t: Tool) => {
    setShapesOpen(false);
    setSelected(null);
    setEditing(null);
    setSheetFor(null);
    setView('doc');
    if (t === 'sign') { setShowSig({}); return; }
    if (t === 'image') { imgInput.current?.click(); return; }
    if (t === 'fill') setFillMark(fields.length ? null : 'check');
    setTool(t);
  };
  const railClick = (r: RailItem) => {
    if (r.t === 'shapes') { setShapesOpen((v) => !v); return; }
    if (r.t === 'pages') { setShapesOpen(false); setSelected(null); setEditing(null); setView((v) => (v === 'pages' ? 'doc' : 'pages')); return; }
    pickTool(r.t);
  };
  const railActive = (r: RailItem) => r.t === 'pages' ? view === 'pages'
    : view === 'pages' ? false
    : r.t === 'shapes' ? ['rect', 'ellipse', 'line'].includes(tool) || shapesOpen
    : r.t === 'sign' ? !!showSig || selObj?.type === 'signature'
    : r.t === tool;

  // ----- focus helpers -----
  const scrollToEl = (el: Element | null | undefined, block: ScrollLogicalPosition = 'center') => el?.scrollIntoView({ block, inline: 'nearest', behavior: 'smooth' });
  const pickChange = (id: string) => {
    if (id === 'forms') { pickTool('fill'); return; }
    const sel = id.includes(':') ? `[data-key="${CSS.escape(id)}"]` : `[data-id="${CSS.escape(id)}"]`;
    scrollToEl(wrapRef.current?.querySelector(sel));
    setSelected(id);
  };
  const goToPage = (src: number) => {
    const el = wrapRef.current?.querySelector<HTMLElement>(`.pageOuter[data-src="${src}"]`);
    if (el && wrapRef.current) wrapRef.current.scrollTo({ top: el.offsetTop - 24, behavior: 'smooth' });
  };
  const focusField = (f?: FormField) => {
    if (!f) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(f.id)}"]`);
    if (el) { el.focus({ preventScroll: true }); scrollToEl(el, mobile ? 'start' : 'center'); }
    setActiveField(f.id);
  };
  const fieldIndex = fillable.findIndex((f) => f.id === activeField || f.name === fields.find((x) => x.id === activeField)?.name);
  const filledCount = fillable.filter((f) => isFilled(f, snap.forms)).length;

  // phone: keep the line being edited in the top third, above the keyboard
  useEffect(() => {
    if (!mobile || !editing) return;
    const go = () => {
      const wrap = wrapRef.current;
      const sel = editing.includes(':') ? `[data-key="${CSS.escape(editing)}"]` : `[data-id="${CSS.escape(editing)}"]`;
      const el = wrap?.querySelector(sel);
      if (!wrap || !el) return;
      const wr = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
      const target = wr.top + wr.height * 0.28;
      if (r.top > wr.top + wr.height * 0.45 || r.top < wr.top + 8) wrap.scrollBy({ top: r.top - target, behavior: 'smooth' });
    };
    const t1 = setTimeout(go, 60), t2 = setTimeout(go, 450);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [editing, mobile]);
  // phone: when typing ends, go back to the tool dock
  useEffect(() => {
    if (!mobile) return;
    if (!editing) { setSlimOpen(false); if (selected?.includes(':')) setSelected(null); }
  }, [editing, mobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // tablet: the floating card moves left when it would cover the selection
  const cardRef = useRef<HTMLElement>(null);
  const [cardLeft, setCardLeft] = useState(false);
  useLayoutEffect(() => {
    if (!tablet || !cardRef.current || !selected) return;
    const sel = selected.includes(':') ? `[data-key="${CSS.escape(selected)}"]` : `[data-id="${CSS.escape(selected)}"]`;
    const el = wrapRef.current?.querySelector(sel);
    if (!el) return;
    const a = el.getBoundingClientRect();
    const body = cardRef.current.parentElement!.getBoundingClientRect();
    const cw = 320, ch = cardRef.current.offsetHeight;
    const rightBox = { l: body.right - 20 - cw, t: body.bottom - 20 - ch, r: body.right - 20, b: body.bottom - 20 };
    const overlap = a.right > rightBox.l && a.left < rightBox.r && a.bottom > rightBox.t && a.top < rightBox.b;
    if (overlap !== cardLeft) setCardLeft(overlap);
  });

  // ----- changes list -----
  const changes: ChangeItem[] = useMemo(() => {
    const pageNo = (src: number) => snap.pages.findIndex((p) => p.src === src) + 1;
    const out: ChangeItem[] = [];
    for (const [key, e] of Object.entries(snap.edits)) {
      const src = +key.split(':')[0];
      out.push({ id: key, icon: e.text.trim() ? 'edit' : 'trash', label: e.text.trim() ? `Edited “${e.text.trim().slice(0, 28)}”` : 'Deleted a line', page: pageNo(src) });
    }
    for (const o of snap.objects) {
      const ic: Record<string, string> = { text: 'text', image: 'image', signature: 'sign', rect: 'rect', ellipse: 'ellipse', whiteout: 'whiteout', highlight: 'highlight', line: 'line', draw: 'draw', mark: 'check' };
      out.push({ id: o.id, icon: ic[o.type], label: o.type === 'text' ? `Text “${o.text.trim().slice(0, 24) || '…'}”` : OBJ_TITLE[o.type], page: pageNo(o.page) });
    }
    const nf = Object.keys(snap.forms).length;
    if (nf) out.push({ id: 'forms', icon: 'fill', label: `Filled ${nf} form ${nf === 1 ? 'field' : 'fields'}`, page: 1 });
    return out.filter((c) => c.page > 0);
  }, [snap]);

  // ----- panels -----
  const lineLabel = (key: string) => {
    const src = +key.split(':')[0];
    const runs = pageData[src]?.runs ?? [];
    return `Page ${snap.pages.findIndex((p) => p.src === src) + 1} · Line ${runs.findIndex((r) => r.key === key) + 1}`;
  };
  const runProps = (compact: boolean) => selRun && (
    <RunProps run={selRun} font={fonts[selRun.fontName]} edit={snap.edits[selRun.key]} line={lineLabel(selRun.key)} compact={compact}
      known={(c) => [selRun.fontName, ...Object.keys(selRun.fontChars ?? {})].some((n) => fonts[n]?.charMap[c] !== undefined)}
      origColor={pageData[+selRun.key.split(':')[0]]?.colors[selRun.key]?.fg ?? '#000000'}
      onEdit={(e) => (e.text === '' ? afterBlur(() => { setRunEdit(selRun.key, e); if (mobile) setSelected(null); }) : setRunEdit(selRun.key, e))}
      onReset={() => afterBlur(() => setRunEdit(selRun.key, null))} onClose={() => setSelected(null)} />
  );
  const objProps = (compact: boolean) => selObj && (
    <ObjProps o={selObj} compact={compact} onChange={(p) => changeObject(selObj.id, p, false)} onDelete={() => removeObject(selObj.id)}
      onDuplicate={() => duplicateObject(selObj.id)} onClose={() => { setSelected(null); setSheetFor(null); }} />
  );
  const fillPanel = (
    <FillPanel fields={fillable} values={snap.forms} index={fieldIndex} filled={filledCount} mark={fillMark} flatten={flatten}
      onPick={(f) => focusField(f)} onMark={(m) => setFillMark((cur) => (cur === m ? null : m))} onFlatten={setFlatten} onDownload={download}
      onPrev={() => focusField(fillable[Math.max(0, fieldIndex - 1)])} onNext={() => focusField(fillable[Math.min(fillable.length - 1, fieldIndex + 1)])} />
  );
  const panel = selRun ? runProps(false) : selObj ? objProps(false) : tool === 'fill' ? fillPanel
    : toolHasProps(tool) ? <ToolProps tool={tool} style={style} onChange={(s) => setStyle((v) => ({ ...v, ...s }))} /> : null;

  const mobileEditing = mobile && editing && (editing.includes(':') || snap.objects.find((o) => o.id === editing)?.type === 'text');
  const fieldNav = !desk && tool === 'fill' && activeField && fillable.length > 0;
  const sheetObj = sheetFor ? snap.objects.find((o) => o.id === sheetFor) : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <button className="ibtn" onClick={() => { if (!editCount || confirm('Close this document? Unsaved changes will be lost.')) onClose(); }} aria-label="Close document" title="Close"><Icon name="back" /></button>
        <div className="doc">
          <div className="pdfchip" aria-hidden="true">PDF</div>
          <div className="names">
            <div className="fname" title={file.name}>{file.name}</div>
            <div className="fmeta"><span>{snap.pages.length} {snap.pages.length === 1 ? 'page' : 'pages'}</span>
              {editCount > 0 && <><span className="dot" /><span className="chg">{editCount} {editCount === 1 ? 'change' : 'changes'}</span></>}</div>
          </div>
        </div>
        <div className="group">
          <button className="ibtn" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
          <button className="ibtn" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        </div>
        {!mobile && (
          <div className="zoompill">
            <button className="ibtn" onClick={() => zoomStep(-1)} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={16} /></button>
            <button className="pct" onClick={() => zoomTo(fitZoom())} title="Fit width (Ctrl+0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, fit width`}>{Math.round(zoom * 100)}%</button>
            <button className="ibtn" onClick={() => zoomStep(1)} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={16} /></button>
            {desk && <><span className="div" /><button className="ibtn" onClick={() => zoomTo(fitZoom())} aria-label="Fit width" title="Fit width"><Icon name="fit" size={16} /></button></>}
          </div>
        )}
        {desk && <ThemeButton theme={theme} onToggle={onTheme} />}
        {mobile
          ? <button className="ibtn primary" onClick={download} aria-label="Download PDF"><Icon name="download" size={20} /></button>
          : <button className="btn primary dl" onClick={download}><Icon name="download" size={17} />Download</button>}
      </header>

      <div className="body">
        {!mobile && (
          <nav className="rail" aria-label="Tools">
            {RAIL.map((r) => {
              const on = railActive(r);
              return (
                <button key={r.t} ref={r.t === 'shapes' ? shapesBtn : undefined} className={`tool${on ? ' active' : ''}`} aria-pressed={on} title={r.label} onClick={() => railClick(r)}>
                  <Icon name={r.icon} size={22} weight={on ? 'fill' : 'regular'} /><span>{r.label}</span>
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            {tablet && <ThemeButton theme={theme} onToggle={onTheme} />}
            <button className="tool" onClick={onTools} title="All tools"><Icon name="dots-three:bold" size={22} /><span>More</span></button>
          </nav>
        )}
        {large && view === 'doc' && (
          <aside className="thumbcol" aria-label="Pages">
            <div className="kicker">Pages</div>
            {snap.pages.map((p, i) => (
              <button key={p.src} className={curPage === p.src ? 'on' : ''} onClick={() => goToPage(p.src)} aria-label={`Go to page ${i + 1}`}>
                <div className="tc"><Thumb pdf={preview && preview.keys[p.src] !== undefined ? preview.pdf : pdf} src={p.src} rotation={p.rotation} size={150} /></div>
                {i + 1}
              </button>
            ))}
          </aside>
        )}
        <div className="deskWrap">
          <div className="canvasWrap" ref={wrapRef}>
            <div className="pages">
              {snap.pages.map((p, i) => (
                <PageView key={p.src} src={p.src} index={i} rotation={p.rotation} info={infos[p.src]} zoom={zoom} pdf={pdf}
                  tool={tool} style={style} data={pageData[p.src]} fonts={fonts} edits={snap.edits}
                  objects={objectsByPage[p.src] ?? []} selected={selected} editing={editing}
                  onData={(src, d, f) => { setPageData((m) => ({ ...m, [src]: d })); setFonts((m) => ({ ...m, ...f })); }}
                  onSelect={(id) => { setSelected(id); if (id === null) setSheetFor(null); }} onEditing={setEditing} onStopEditing={stopEditing}
                  onRunEdit={setRunEdit} onAdd={addObject} onChange={changeObject}
                  onPlace={() => false}
                  onDelete={removeObject} onDuplicate={duplicateObject}
                  onTextPlaced={() => setTool('edit')}
                  onVisible={(src, r) => { ratios.current[src] = r; const c = currentPage(); if (c !== curPage) setCurPage(c); }}
                  editKey={editKeyOf(p.src)}
                  onDragInfo={setDragInfo}
                  preview={preview && preview.keys[p.src] !== undefined ? { pdf: preview.pdf, key: preview.keys[p.src] } : undefined}
                  fields={fieldsByPage[p.src] ?? []} forms={snap.forms} activeField={activeField} fillMark={tool === 'fill' ? fillMark : null}
                  mobile={mobile} onFieldValue={setFieldValue} onFieldFocus={(id) => { setActiveField(id); setSelected(null); }}
                  onFieldSign={(f) => setShowSig({ field: f })}
                  onNextRun={nextRun} onMore={(id) => setSheetFor(id)} />
              ))}
            </div>
          </div>
          {view === 'pages' && (
            <Organizer pdf={pdf} pages={snap.pages} mobile={mobile} onDone={() => setView('doc')}
              onChange={(pages) => commit((s) => ({ ...s, pages }))} />
          )}
          {!mobile && view === 'doc' && (
            <div className="pagepill" aria-live="polite"><b>{Math.max(1, snap.pages.findIndex((p) => p.src === curPage) + 1)}</b>&nbsp;/ {snap.pages.length}</div>
          )}
          {fieldNav && (
            <div className="fieldnav" role="toolbar" aria-label="Form fields" onMouseDown={(e) => e.preventDefault()}>
              <button onClick={() => focusField(fillable[Math.max(0, fieldIndex - 1)])} disabled={fieldIndex <= 0} aria-label="Previous field"><Icon name="caret-up:bold" size={18} /></button>
              <button onClick={() => focusField(fillable[Math.min(fillable.length - 1, fieldIndex + 1)])} disabled={fieldIndex >= fillable.length - 1} aria-label="Next field"><Icon name="caret-down:bold" size={18} /></button>
              <div className="fn"><b>{fillable[fieldIndex]?.label || 'Field'}</b><span>Field {fieldIndex + 1} of {fillable.length} · {filledCount} filled</span></div>
              <button className="done" onClick={() => { (document.activeElement as HTMLElement | null)?.blur?.(); setActiveField(null); }}>Done</button>
            </div>
          )}
        </div>
        {desk && view === 'doc' && (
          <aside className="side" aria-label="Properties">
            {panel ?? <IdleProps changes={changes} onPick={pickChange} />}
          </aside>
        )}
        {tablet && view === 'doc' && panel && !(tool === 'fill' && activeField) && (
          <aside ref={cardRef} className={`floatcard ${cardLeft ? 'l' : 'r'}`} aria-label="Properties">{panel}</aside>
        )}
        {shapesOpen && (
          <div className="flyout" role="menu" style={mobile
            ? { left: 8, right: 8, bottom: 8, justifyContent: 'center' }
            : { left: 92, top: (shapesBtn.current?.offsetTop ?? 400) - (shapesBtn.current?.parentElement?.scrollTop ?? 0) - 6 }}>
            {SHAPES.map(([t, label, ic]) => (
              <button key={t} role="menuitem" className={`tool${tool === t ? ' active' : ''}`} onClick={() => pickTool(t)}>
                <Icon name={ic} size={22} weight={tool === t ? 'fill' : 'regular'} /><span>{label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {mobile && mobileEditing && (
        <SlimBar open={slimOpen} onToggle={() => setSlimOpen((v) => !v)} onDone={() => (document.activeElement as HTMLElement | null)?.blur?.()}
          run={selRun && editing === selRun.key ? { label: fontLabel(fonts[selRun.fontName]), css: fonts[selRun.fontName]?.cssFallback,
            size: selRun.region.height * (snap.edits[selRun.key]?.sizeScale ?? 1),
            color: snap.edits[selRun.key]?.color ?? pageData[+selRun.key.split(':')[0]]?.colors[selRun.key]?.fg ?? '#000',
            onSize: (v) => { const cur = snap.edits[selRun.key] ?? { text: selRun.str, sizeScale: 1, color: null }; setRunEdit(selRun.key, { ...cur, sizeScale: v / selRun.region.height }); } } : undefined}
          obj={selObj?.type === 'text' ? selObj : undefined}
          onObj={(p) => selObj && changeObject(selObj.id, p, false)}>
          {selRun ? runProps(true) : objProps(true)}
        </SlimBar>
      )}
      {mobile && !mobileEditing && !(fieldNav) && (
        <nav className="dock" aria-label="Tools">
          <div className="scroll">
            {RAIL.map((r) => {
              const on = railActive(r);
              return (
                <button key={r.t} className={`tool${on ? ' active' : ''}`} aria-pressed={on} onClick={() => railClick(r)}>
                  <Icon name={r.icon} size={23} weight={on ? 'fill' : 'regular'} /><span>{r.label}</span>
                </button>
              );
            })}
            <button className="tool" onClick={onTools}><Icon name="dots-three:bold" size={23} /><span>More</span></button>
            <button className="tool" onClick={onTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={23} /><span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
          </div>
          <div className="fade" />
        </nav>
      )}
      {mobile && sheetObj && (
        <>
          <div className="sheet-scrim" onClick={() => setSheetFor(null)} />
          <div className="bsheet" role="dialog" aria-label="Object properties">
            <div className="grab" />
            <ObjProps o={sheetObj} onChange={(p) => changeObject(sheetObj.id, p, false)} onDelete={() => removeObject(sheetObj.id)}
              onDuplicate={() => { duplicateObject(sheetObj.id); setSheetFor(null); }} onClose={() => setSheetFor(null)} />
          </div>
        </>
      )}
      {mobile && tool === 'fill' && !activeField && !mobileEditing && (
        <MobileFillBar fields={fillable.length} filled={filledCount} mark={fillMark} onMark={(m) => setFillMark((cur) => (cur === m ? null : m))}
          onStart={() => focusField(fillable[0])} />
      )}

      <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
      {showSig && <SignatureModal sheet={mobile} onClose={() => setShowSig(null)} onPick={(s) => { const f = showSig.field; setShowSig(null); placeStamp(s, 'signature', f); }} />}
      {dragInfo && (() => {
        const obj = snap.objects.find((o) => o.id === dragInfo.id);
        const pg = snap.pages.find((q) => q.src === dragInfo.page);
        if (!obj || !pg || obj.type !== 'text') return null; // only text needs precise placement
        const src = preview && preview.keys[dragInfo.page] !== undefined ? preview.pdf : pdf;
        return <Loupe x={dragInfo.x} y={dragInfo.y} page={dragInfo.page} obj={obj} pdf={src} pageW={infos[dragInfo.page].w} pageH={infos[dragInfo.page].h} rotation={pg.rotation} zoom={zoom} />;
      })()}
    </div>
  );
}

// ---------------- phone: slim properties bar above the keyboard ----------------
function SlimBar({ open, onToggle, onDone, run, obj, onObj, children }: {
  open: boolean; onToggle: () => void; onDone: () => void;
  run?: { label: string; css?: string; size: number; color: string; onSize: (v: number) => void };
  obj?: Extract<EditorObject, { type: 'text' }>; onObj: (p: any) => void; children: React.ReactNode;
}) {
  const fams: FontFamily[] = ['Helvetica', 'Times', 'Courier'];
  const famLabel: Record<FontFamily, string> = { Helvetica: 'Sans', Times: 'Serif', Courier: 'Mono' };
  const famCss: Record<FontFamily, string> = { Helvetica: 'Arial, sans-serif', Times: '"Times New Roman", serif', Courier: '"Courier New", monospace' };
  return (
    // keep the text field focused while using the bar
    <div className="slimbar" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}>
      {open && <div className="more">{children}</div>}
      <div className="row">
        {run && <button className="chipb" onClick={onToggle} aria-label={`Font ${run.label}`}><span style={{ fontFamily: run.css }}>Aa</span><span className="fn">{run.label}</span></button>}
        {obj && (
          <button className="chipb" aria-label="Change font" onClick={() => onObj({ family: fams[(fams.indexOf(obj.family) + 1) % 3] })}>
            <span style={{ fontFamily: famCss[obj.family] }}>Aa</span><span className="fn">{famLabel[obj.family]}</span>
          </button>
        )}
        {run && <Stepper soft value={run.size} min={2} max={300} onChange={run.onSize} label="size" />}
        {obj && <Stepper soft value={obj.size} min={4} max={200} onChange={(size) => onObj({ size })} label="size" />}
        <button className="cdot" onClick={onToggle} aria-label="Colour"><i style={{ background: run?.color ?? obj?.color }} /></button>
        <button className="ibtn muted" onClick={onToggle} aria-label={open ? 'Fewer options' : 'More options'} aria-expanded={open}><Icon name={open ? 'down' : 'up'} size={20} /></button>
        <div className="sp" />
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

function MobileFillBar({ fields, filled, mark, onMark, onStart }: { fields: number; filled: number; mark: FillMark | null; onMark: (m: FillMark) => void; onStart: () => void }) {
  return (
    <div className="slimbar">
      <div className="row" style={{ overflowX: 'auto' }}>
        {fields > 0 && <button className="btn primary" onClick={onStart}>Fill {fields} fields</button>}
        {fields > 0 && <span className="label num" style={{ whiteSpace: 'nowrap' }}>{filled}/{fields}</span>}
        <div className="sp" />
        {MARKS.map(([m, ic, label]) => (
          <button key={m} className={`ibtn${mark === m ? ' primary' : ''}`} style={mark === m ? { width: 44, height: 44 } : { width: 44, height: 44 }} onClick={() => onMark(m)} aria-label={`Place ${label}`} aria-pressed={mark === m}>
            <Icon name={ic} size={19} />
          </button>
        ))}
      </div>
    </div>
  );
}

const MARKS: [FillMark, string, string][] = [['check', 'check', 'Tick'], ['cross', 'x:bold', 'Cross'], ['dot', 'circle:fill', 'Dot'], ['text', 'text', 'Text'], ['date', 'calendar-blank', 'Date']];

function FillPanel({ fields, values, index, filled, mark, flatten, onPick, onMark, onFlatten, onDownload, onPrev, onNext }: {
  fields: FormField[]; values: Record<string, string | boolean>; index: number; filled: number; mark: FillMark | null; flatten: boolean;
  onPick: (f: FormField) => void; onMark: (m: FillMark) => void; onFlatten: (v: boolean) => void; onDownload: () => void; onPrev: () => void; onNext: () => void;
}) {
  const kind: Record<FormField['type'], string> = { text: 'Text', check: 'Checkbox', radio: 'Choice', choice: 'List', sig: 'Signature' };
  return (
    <div className="props" style={{ minHeight: '100%' }}>
      {fields.length > 0 ? (
        <>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Form fields</h3>
              <span className="label num">{filled} of {fields.length} filled</span>
            </div>
            <div className="progress" style={{ width: '100%' }}><div style={{ width: `${(filled / fields.length) * 100}%` }} /></div>
          </div>
          <div className="fieldlist">
            {fields.map((f, i) => {
              const done = isFilled(f, values);
              return (
                <button key={f.id} className={i === index ? 'on' : ''} onClick={() => onPick(f)}>
                  <Icon name={done ? 'check-circle:fill' : i === index ? 'pencil-circle:fill' : 'circle'} size={17}
                    style={{ color: done ? 'var(--success)' : i === index ? 'var(--sel)' : 'var(--faint)' }} />
                  <span className="nm">{f.label || f.name}</span><span className="k">{kind[f.type]}</span>
                </button>
              );
            })}
          </div>
          <div className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className="btn outline" onClick={onPrev} disabled={index <= 0}><Icon name="caret-up:bold" size={16} />Previous</button>
            <button className="btn outline" onClick={onNext} disabled={index >= fields.length - 1}>Next field<Icon name="caret-down:bold" size={16} /></button>
          </div>
        </>
      ) : (
        <div className="head"><div className="t"><div className="kicker">Fill form</div><h3 style={{ whiteSpace: 'normal' }}>No fillable fields found</h3>
          <div className="hint" style={{ fontSize: 13.5, marginTop: 2 }}>Pick a mark below, then tap the page where it goes.</div></div></div>
      )}
      <div className="field">
        <div className="kicker">{fields.length ? 'No field? Tap the page to add' : 'Marks'}</div>
        <div className="marks">
          {MARKS.map(([m, ic, label]) => (
            <button key={m} className={mark === m ? 'on' : ''} onClick={() => onMark(m)} aria-pressed={mark === m}><Icon name={ic} size={18} />{label}</button>
          ))}
        </div>
      </div>
      {fields.length > 0 && <Toggle label="Flatten on download" hint="Answers become part of the page" checked={flatten} onChange={onFlatten} />}
      <div style={{ flex: 1 }} />
      <button className="btn primary lg block" onClick={onDownload}><Icon name="download" size={18} />Download filled PDF</button>
    </div>
  );
}
