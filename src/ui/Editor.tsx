import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pageCover, pageRules } from './rules';
import { gesture } from './gesture';
import { Icon } from './icons';
import { openPdf } from './pdfjs';
import { useHistory, uid, Tool, ToolStyle, RunEdit } from './store';
import { PageView, PageInfo, PageData, FillMark, lineRooms } from './PageView';
import { SignatureModal, Stamp } from './SignatureModal';
import { Organizer } from './Organizer';
import { runBox } from './geometry';
import { AddPagesSheet, type AddWhat } from './AddPages';
import { FindBar, PrivacyCheck } from './FindBar';
import type { Hit, DocRef } from './search';
import { Loupe } from './Loupe';
import { Thumb } from './Thumb';
import { contentReader, cutsSomething, textureFill } from './removeTool';
import { ShortcutsSheet } from './Shortcuts';
import type { CutStroke } from '../engine/cut';
import { DropOverlay, isImage, isPdf, useFileDrop } from './drop';
import { underStrokes } from '../engine/cut';
import { RunProps, ObjProps, ToolProps, IdleProps, ChangeItem, objTitle, Stepper, toolHasProps, fontLabel, Toggle, RunTextTools, ObjTextTools } from './Panel';
import { readFields, FormField, isFilled } from './Fields';
import { exportPdf } from '../engine/exporter';
import { pageNeedsText, LayerLine } from '../engine/textLayer';
import { scanStyles } from './scanStyle';
import { ConfirmClose } from './ConfirmClose';
import { useBack } from './back';
import { cloneLineText, pageGlyphs, PageCtx } from './scanGlyphs';
import type { EditorObject, TextEdit, FontFamily, ClonedText, DocFont } from '../engine/types';
import { docFontOf, plainFontName, matchFontBytes } from './textFonts';
import { useLineSelSize, lineEditor } from './lineEdit';
import type { FontInfo, TextRun } from '../engine/pdfText';
import type { Bp, Theme } from './hooks';
import { setSoftKeyboard, safeTop } from './hooks';
import { ThemeButton } from './Start';

/** a copied line: its text and how it looks (pasted as a text box) */
interface Clip { text: string; size: number; color: string; font: DocFont | null; family: FontFamily; bold: boolean; italic: boolean }

/** a move on the screen (viewport units) as a move in PDF user space */
function userDelta(vm: number[], dx: number, dy: number): [number, number] {
  const det = vm[0] * vm[3] - vm[1] * vm[2] || 1;
  return [(vm[3] * dx - vm[2] * dy) / det, (-vm[1] * dx + vm[0] * dy) / det];
}

export interface HostProps {
  isNative?: boolean;
  pickPdf?: () => Promise<{ name: string; base64: string } | null>;
  savePdf?: (base64: string, name: string) => Promise<string | void>;
  /** Android: colours at the page's top / bottom edge, for the system bars */
  onChrome?: (c: import('./hooks').ChromeColors) => void;
  /** Android: sizes of the status / navigation bars the page draws under */
  getInsets?: () => Promise<{ top: number; bottom: number; left: number; right: number }>;
  /** Android: leave the app (back button with nothing left to close) */
  exitApp?: () => void;
  /** Android: what the app was opened with ("Open with", the share sheet, a shortcut or widget) */
  takeIntent?: () => Promise<Incoming | null>;
  /** Android: a shared file's contents (base64) */
  readShared?: (uri: string) => Promise<string>;
  /** Android: open the calendar app with an event filled in */
  addToCalendar?: (e: CalEvent) => Promise<boolean>;
  /** Android: Google's document scanner; true when pages are ready (then takeScan gives their file URIs) */
  googleScan?: () => Promise<boolean>;
  takeScan?: () => Promise<string[] | null>;
}
export interface CalEvent { title: string; begin: number; allDay: boolean; note: string }
export interface Incoming {
  /** open: PDFs; import: other files / text to turn into a PDF and edit; convert: the "Convert to PDF" share entry
   *  (or, without files, the shortcut); scan / open / sign: shortcut or widget buttons */
  mode: string;
  files: { uri: string; name: string; mime: string | null; size: number | null }[];
  text: string | null;
  subject: string | null;
}
export interface ToastMsg { msg: string; kind?: 'ok' | 'err'; action?: { label: string; run: () => void } }
export interface BusyMsg { title: string; detail?: string; progress?: number }

export { toB64, saveFile, shareFile, canShareFiles, printPdf } from './share';
import { saveFile, shareFile, printPdf } from './share';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const MIN_Z = 0.25, MAX_Z = 4;
const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));

type RailT = Tool | 'shapes' | 'markup' | 'pages';
type RailItem = { t: RailT; label: string; icon: string; key: string; opts?: boolean };
/** Tools grouped by intent (rail, mobile "All tools" sheet). `opts`: the tool has a flyout with options. */
const GROUPS: { name: string; tint: string; items: RailItem[] }[] = [
  { name: 'Change', tint: 'var(--tint-change)', items: [
    { t: 'edit', label: 'Edit', icon: 'cursor-text', key: 'E' },
    { t: 'fill', label: 'Fill', icon: 'textbox', key: 'F' }] },
  { name: 'Add', tint: 'var(--tint-add)', items: [
    { t: 'text', label: 'Text', icon: 'text-t', key: 'T', opts: true },
    { t: 'sign', label: 'Sign', icon: 'signature', key: 'S' },
    { t: 'image', label: 'Image', icon: 'image', key: 'I' },
    { t: 'link', label: 'Link', icon: 'link', key: 'K' }] },
  { name: 'Mark up', tint: 'var(--tint-markup)', items: [
    { t: 'whiteout', label: 'Whiteout', icon: 'eraser', key: 'W' },
    { t: 'redact', label: 'Redact', icon: 'eye-slash', key: 'X' },
    { t: 'remove', label: 'Remove', icon: 'bandaids', key: 'M', opts: true },
    { t: 'markup', label: 'Highlight', icon: 'highlighter', key: 'H', opts: true },
    { t: 'shapes', label: 'Shapes', icon: 'shapes', key: 'R', opts: true },
    { t: 'draw', label: 'Draw', icon: 'scribble', key: 'D', opts: true }] },
  { name: 'Document', tint: 'var(--tint-doc)', items: [
    { t: 'pages', label: 'Pages', icon: 'squares-four', key: 'P' }] },
];
const RAIL: RailItem[] = GROUPS.flatMap((g) => g.items);
/** phone: every tool in the bottom bar, most used first (it scrolls sideways) */
const DOCK: RailT[] = ['edit', 'text', 'sign', 'markup', 'draw', 'shapes', 'whiteout', 'remove', 'redact', 'image', 'link', 'fill', 'pages'];
const SHAPE_TOOLS: Tool[] = ['rect', 'ellipse', 'line', 'arrow'];
/** highlight, underline, strike-through: one rail button, picked in its flyout */
const MARK_TOOLS: Tool[] = ['highlight', 'underline', 'strike'];
const MARK_TILES: [Tool, string, string][] = [['highlight', 'Highlight', 'highlighter'], ['underline', 'Underline', 'text-underline'], ['strike', 'Strike', 'text-strikethrough']];

// phone dock: the 4 most recently used tools (slots stay put; a new tool replaces the least recent)
const RECENT_KEY = 'pe-recent-tools';
type Recent = { slots: RailT[]; used: Partial<Record<RailT, number>> };
const readRecent = (): Recent => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null');
    if (v && Array.isArray(v.slots) && v.slots.length === 4 && v.slots.every((t: string) => RAIL.some((r) => r.t === t))) return v;
  } catch { /* storage unavailable */ }
  return { slots: ['edit', 'text', 'markup', 'sign'], used: {} };
};
const useRecent = (r: Recent, t: RailT): Recent => {
  const used = { ...r.used, [t]: Date.now() };
  let slots = r.slots;
  if (!slots.includes(t)) {
    let at = 0;
    slots.forEach((x, i) => { if ((used[x] ?? 0) < (used[slots[at]] ?? 0)) at = i; });
    slots = slots.map((x, i) => (i === at ? t : x));
  }
  const next = { slots, used };
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
};
const SHAPES: [Tool, string, string][] = [['rect', 'Box', 'rect'], ['ellipse', 'Circle', 'ellipse'], ['line', 'Line', 'line'], ['arrow', 'Arrow', 'arrow-up-right']];

/** What the editor opens with when started from the tools page. */
export type EditorStart = 'edit' | 'fill' | 'sign' | 'pages' | 'privacy';

export function Editor({ host, file, pdf, infos, hist, onClose, onTools, theme, onTheme, bp, toast, setBusy, start, onSaved, onAddPages }: {
  /** add pages to the document after this many pages; resolves to the first new page's source index */
  onAddPages?: (after: number, what: AddWhat) => Promise<number | null>;
  host: HostProps; file: { name: string; bytes: Uint8Array }; pdf: any; infos: PageInfo[];
  hist: ReturnType<typeof useHistory>; onClose: () => void; onTools: () => void;
  theme: Theme; onTheme: () => void; bp: Bp; toast: (t: ToastMsg) => void; setBusy: (b: BusyMsg | null) => void;
  start?: EditorStart;
  /** the edited PDF was saved (for the recent documents list) */
  onSaved?: (bytes: Uint8Array, name: string) => void;
}) {
  const { snap, commit } = hist;
  // looks of scanned lines belong to this document
  useState(() => { scanStyles.clear(); return 0; });
  const mobile = bp === 'mobile', tablet = bp === 'tablet', large = bp === 'large', desk = bp === 'desktop' || large;
  const [tool, setTool] = useState<Tool>('edit');
  const [style, setStyle] = useState<ToolStyle>({
    color: '#000000', stroke: '#1E2559', fill: null, strokeWidth: 2, fontSize: 14, family: 'Helvetica', highlight: '#FFE14D', ink: '#D93025', match: true, removeSize: 9,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // the list of pages on the right: open by default on big screens (and remembered there)
  const [addAfter, setAddAfter] = useState<number | null>(null); // the Add pages sheet: new pages after this many
  // find in document / privacy check: matches drawn over the pages
  const [findOpen, setFindOpen] = useState(false);
  /** the keyboard shortcuts sheet */
  const [keysOpen, setKeysOpen] = useState(false);
  /** an added object copied with Ctrl+C (pasted with Ctrl+V on the page in view) */
  const objClip = useRef<EditorObject | null>(null);
  const lastCopy = useRef<'run' | 'obj' | null>(null);
  const [privOpen, setPrivOpen] = useState(start === 'privacy');
  const [found, setFound] = useState<{ list: Hit[]; cur: number; priv: boolean }>({ list: [], cur: -1, priv: false });
  const [strip, setStripRaw] = useState<boolean>(() => {
    if (bp !== 'desktop' && bp !== 'large') return false;
    try { return localStorage.getItem('pe-strip') !== '0'; } catch { return true; }
  });
  const setStrip = (v: boolean | ((x: boolean) => boolean)) => setStripRaw((cur) => {
    const n = typeof v === 'function' ? v(cur) : v;
    if (bp === 'desktop' || bp === 'large') { try { localStorage.setItem('pe-strip', n ? '1' : '0'); } catch { /* fine */ } }
    return n;
  });
  // phone: the bottom bar keeps the chosen tool in view
  const dockRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pageData, setPageData] = useState<Record<number, PageData>>({});
  const [fonts, setFonts] = useState<Record<string, FontInfo>>({});
  const [showSig, setShowSig] = useState<null | { field?: FormField }>(null);
  /** Remove strokes being worked out (shown as paint until the page shows them taken out) */
  const [removingBusy, setRemovingBusy] = useState(0);
  const [view, setView] = useState<'doc' | 'pages'>(start === 'pages' ? 'pages' : 'doc');
  // tool flyout beside the rail (tablet / desktop) or above the dock (phone, shapes only)
  const [flyout, setFlyout] = useState<{ t: RailT; top: number } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const savedSnap = useRef<unknown>(null); // what the last download contained: closing then needs no question
  const [recent, setRecent] = useState<Recent>(readRecent);
  const railBtns = useRef<Partial<Record<RailT, HTMLButtonElement | null>>>({});
  const lastShape = useRef<Tool>('rect');
  const lastMark = useRef<Tool>('highlight');
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
  const ratios = useRef<Record<number, number>>({});

  const [fieldsReady, setFieldsReady] = useState(false);
  useEffect(() => {
    readFields(pdf, infos.map((i) => i.vm)).then(setFields).catch(() => setFields([])).finally(() => setFieldsReady(true));
  }, [pdf, infos]);

  // ----- zoom -----
  const fitZoom = () => {
    const el = wrapRef.current;
    if (!el) return 1;
    const maxW = Math.max(...infos.map((i) => i.w));
    // the page column's own side padding (it leaves room for the floating rail)
    const cs = el.firstElementChild ? getComputedStyle(el.firstElementChild) : null;
    const pad = cs ? parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) : mobile ? 24 : 80;
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
  // runs right before the anchor is applied, in the same frame as the new zoom (ends a pinch preview)
  const beforeAnchor = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    beforeAnchor.current?.();
    beforeAnchor.current = null;
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

  // the gesture handlers are attached once; they read the current values through this ref
  const live = useRef({ tool, fitZoom, zoomTo });
  live.current = { tool, fitZoom, zoomTo };

  // Two fingers: pinch to zoom and drag to pan; double-tap toggles fit width / 200%.
  // While the fingers move, the pages are only scaled with a CSS transform (smooth, no re-layout);
  // the real zoom is applied once when the pinch ends, keeping the same spot under the fingers.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const content = () => el.querySelector<HTMLElement>('.pages');
    let pinch: null | {
      d0: number; z0: number; m0: { x: number; y: number }; m: { x: number; y: number }; k: number;
      anchor: Anchor; ox: number; oy: number; sl: number; st: number; node: HTMLElement;
    } = null;
    let frame = 0;
    let latest: TouchList | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    let tapStart: { x: number; y: number; t: number } | null = null;
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const begin = (t: TouchList) => {
      const node = content();
      const m = mid(t);
      const anchor = anchorAt(m.x, m.y);
      if (!node || !anchor) { pinch = null; return; }
      // the untransformed position of the pages (a previous pinch may still be on screen)
      const wr = el.getBoundingClientRect();
      const left = wr.left + el.clientLeft + node.offsetLeft - el.scrollLeft;
      const top = wr.top + el.clientTop + node.offsetTop - el.scrollTop;
      pinch = { d0: dist(t), z0: zoomRef.current, m0: m, m, k: 1, anchor, ox: m.x - left, oy: m.y - top, sl: el.scrollLeft, st: el.scrollTop, node };
      node.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
      node.style.willChange = 'transform';
    };
    const paint = () => {
      if (!pinch) return;
      // follow any native scrolling that happened meanwhile
      const dx = pinch.m.x - pinch.m0.x + (el.scrollLeft - pinch.sl);
      const dy = pinch.m.y - pinch.m0.y + (el.scrollTop - pinch.st);
      pinch.node.style.transform = `translate(${dx}px, ${dy}px) scale(${pinch.k})`;
    };
    const finish = () => {
      if (!pinch) return;
      const p = pinch;
      pinch = null;
      const z = clampZ(p.z0 * p.k);
      const clear = () => { p.node.style.transform = ''; p.node.style.transformOrigin = ''; p.node.style.willChange = ''; };
      const a = { ...p.anchor, cx: p.m.x, cy: p.m.y };
      if (Math.abs(z - zoomRef.current) < 1e-4) { clear(); applyAnchor(a); return; }
      beforeAnchor.current = clear;
      pendingAnchor.current = a;
      setZoom(z);
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        gesture.multi = true;
        tapStart = null;
        (document.activeElement as HTMLElement | null)?.blur?.();
        finish();
        begin(e.touches);
        if (e.cancelable) e.preventDefault();
      } else if (e.touches.length === 1) {
        tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
      }
    };
    const onMove = (e: TouchEvent) => {
      if (tapStart && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tapStart.x, e.touches[0].clientY - tapStart.y) > 10) tapStart = null;
      if (e.touches.length < 2 || !pinch) return;
      if (e.cancelable) e.preventDefault();
      latest = e.touches;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!latest || latest.length < 2 || !pinch) return;
        pinch.m = mid(latest);
        pinch.k = clampZ(pinch.z0 * (dist(latest) / pinch.d0)) / pinch.z0;
        paint();
      });
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        finish();
        if (e.touches.length >= 2) { begin(e.touches); return; }
      }
      latest = null;
      if (e.touches.length === 0) setTimeout(() => { gesture.multi = false; }, 0);
      // double tap on paper or desk (not on text, objects or fields)
      if (tapStart && e.touches.length === 0 && Date.now() - tapStart.t < 300) {
        const tgt = e.target as HTMLElement;
        const free = !tgt.closest('.run, .obj, .ff, .ffbox, .ffsig, .objbar') && live.current.tool !== 'draw';
        const now = Date.now();
        if (free && lastTap && now - lastTap.t < 320 && Math.hypot(tapStart.x - lastTap.x, tapStart.y - lastTap.y) < 30) {
          const fit = live.current.fitZoom();
          live.current.zoomTo(Math.abs(zoomRef.current - fit) < 0.05 ? 2 : fit, tapStart.x, tapStart.y);
          lastTap = null;
          if (e.cancelable) e.preventDefault();
        } else lastTap = free ? { t: now, x: tapStart.x, y: tapStart.y } : null;
      }
      tapStart = null;
    };
    const onScroll = () => { if (pinch) paint(); };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    el.addEventListener('touchcancel', onEnd);
    el.addEventListener('scroll', onScroll, { passive: true });
    // trackpad pinch (ctrl + wheel): many small events, so batch them into one zoom per frame
    let wheelK = 1, wheelAt = { x: 0, y: 0 }, wheelFrame = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // a mouse wheel notch (±100) is one gentle step (about ×1.35); a pinch sends small deltas
      wheelK *= Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.01);
      wheelAt = { x: e.clientX, y: e.clientY };
      if (wheelFrame) return;
      wheelFrame = requestAnimationFrame(() => {
        wheelFrame = 0;
        const k = wheelK;
        wheelK = 1;
        live.current.zoomTo(zoomRef.current * k, wheelAt.x, wheelAt.y);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(wheelFrame);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- moving the view with the mouse: hold Space or Ctrl (⌘) and drag, or drag with the middle button
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let space = false, held = false, pan: { x: number; y: number; sl: number; st: number; id: number } | null = null;
    const typing = (t: EventTarget | null) => { const h = t as HTMLElement | null; return !!h && (h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT' || h.isContentEditable); };
    const ready = () => setPanReady(space || held);
    const kd = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.code === 'Space') { if (!space) { space = true; ready(); } e.preventDefault(); }
      if (e.key === 'Control' || e.key === 'Meta') { held = true; ready(); }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space') { space = false; ready(); }
      if (e.key === 'Control' || e.key === 'Meta') { held = false; ready(); }
    };
    const blur = () => { space = false; held = false; ready(); };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const want = e.button === 1 || (e.button === 0 && (space || e.ctrlKey || e.metaKey));
      if (!want) return;
      e.preventDefault(); e.stopPropagation();
      pan = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, id: e.pointerId };
      try { el.setPointerCapture(e.pointerId); } catch { /* fine */ }
      setPanning(true);
    };
    const move = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      e.preventDefault(); e.stopPropagation();
      el.scrollLeft = pan.sl - (e.clientX - pan.x);
      el.scrollTop = pan.st - (e.clientY - pan.y);
    };
    const up = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      e.stopPropagation();
      pan = null; setPanning(false);
    };
    // the middle button's own autoscroll and Ctrl+click menus stay out of the way
    const aux = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    const click = (e: MouseEvent) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); e.preventDefault(); } };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true);
    el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    el.addEventListener('mousedown', aux, true); el.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true);
      el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true);
      el.removeEventListener('mousedown', aux, true); el.removeEventListener('click', click, true);
    };
  }, []);

  // ----- object helpers -----
  // a new box is kept inside its page (a signature placed across two pages would be cut off by both)
  const inPage = (o: EditorObject): EditorObject => {
    const pg = infos[o.page];
    if (!pg || o.type === 'line') return o;
    const x = Math.max(0, Math.min(o.x, pg.w - o.w)), y = Math.max(0, Math.min(o.y, pg.h - o.h));
    return x === o.x && y === o.y ? o : ({ ...o, x, y } as EditorObject);
  };
  const addObject = (o: EditorObject | EditorObject[]) => commit((s) => ({ ...s, objects: [...s.objects, ...(Array.isArray(o) ? o : [o]).map(inPage)] }));
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
    // the page under the upper middle of the view
    const wrap = wrapRef.current;
    if (wrap) {
      const r = wrap.getBoundingClientRect(), y = r.top + r.height * 0.4;
      let src = -1, bd = Infinity;
      wrap.querySelectorAll<HTMLElement>('.pageOuter').forEach((el) => {
        const b = el.getBoundingClientRect();
        const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
        if (d < bd) { bd = d; src = +(el.dataset.src ?? -1); }
      });
      if (src >= 0) return src;
    }
    let best = snap.pages[0]?.src ?? 0;
    let r = -1;
    for (const p of snap.pages) if ((ratios.current[p.src] ?? 0) > r) { r = ratios.current[p.src] ?? 0; best = p.src; }
    return best;
  };
  const curRef = useRef(curPage);
  curRef.current = curPage;
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let raf = 0;
    const fn = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const c = currentPage(); if (c !== curRef.current) setCurPage(c); }); };
    wrap.addEventListener('scroll', fn, { passive: true });
    fn();
    return () => { wrap.removeEventListener('scroll', fn); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.pages, zoom]);

  const placeStamp = (st: Stamp, type: 'signature' | 'image', field?: FormField, at?: { page: number; x: number; y: number }) => {
    const page = field ? field.page : at ? at.page : currentPage();
    const info = infos[page];
    let w: number, h: number, x: number, y: number;
    if (at && !field) {
      // centred where it was dropped
      const maxW = Math.min(260, info.w * 0.6);
      w = Math.min(maxW, st.w); h = (w * st.h) / st.w;
      x = Math.max(0, Math.min(info.w - w, at.x - w / 2)); y = Math.max(0, Math.min(info.h - h, at.y - h / 2));
    } else if (field) {
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

  // files dragged in from the computer: pictures go on the page under the pointer (in the page list or
  // the pages view they become pages, like PDFs, which are added after the current page)
  const fileDrop = useFileDrop((files, e) => {
    const pdfs = files.filter(isPdf), imgs = files.filter((f) => !isPdf(f));
    const target = e.target as Element;
    const asPages = view === 'pages' || !!target.closest?.('.pstrip, .addpg');
    const after = Math.max(0, snap.pages.findIndex((p) => p.src === curPage)) + 1;
    if ((pdfs.length || (asPages && imgs.length)) && !onAddPages) { toast({ msg: 'Pages can’t be added to this document here', kind: 'err' }); return; }
    (async () => {
      // the last one first, so they end up in the order they were dropped
      if (asPages && imgs.length) await onAddPages!(after, { kind: 'images', files: imgs });
      for (const f of [...pdfs].reverse()) await onAddPages!(after, { kind: 'pdf', file: f });
      if (pdfs.length || (asPages && imgs.length)) toast({ msg: 'Pages added after page ' + after, kind: 'ok' });
      if (!asPages && imgs.length) {
        const el = target.closest?.('.pageOuter') as HTMLElement | null;
        const pg = el?.querySelector<HTMLElement>('.page');
        const src = el ? +(el.dataset.src ?? NaN) : NaN;
        const rot = snap.pages.find((p) => p.src === src)?.rotation ?? 0;
        let at: { page: number; x: number; y: number } | undefined;
        if (pg && !Number.isNaN(src) && rot % 360 === 0) {
          const r = pg.getBoundingClientRect();
          at = { page: src, x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
        }
        imgs.forEach((f, k) => onImage(f, at && { ...at, x: at.x + k * 16, y: at.y + k * 16 }));
      }
    })().catch(() => toast({ msg: 'Those files couldn’t be added', kind: 'err' }));
  }, { accept: (f) => isPdf(f) || isImage(f), onReject: () => toast({ msg: 'Drop PDFs or images here. Other files can be turned into PDFs with Convert.', kind: 'err' }), disabled: !!showSig });

  const onImage = (f?: File, at?: { page: number; x: number; y: number }) => {
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
        placeStamp({ src, w: im.naturalWidth, h: im.naturalHeight }, 'image', undefined, at);
      };
      im.onerror = () => toast({ msg: 'Couldn’t place image', kind: 'err' });
      im.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const textEdits = (editsObj: Record<string, RunEdit>): TextEdit[] => {
    const out: TextEdit[] = [];
    const rooms: Record<number, Record<string, { up: number; down: number }>> = {};
    for (const [key, e] of Object.entries(editsObj)) {
      const page = +key.split(':')[0];
      const run = pageData[page]?.runs.find((r) => r.key === key);
      if (!run) continue;
      const font = fonts[run.fontName];
      out.push({
        page, key, region: run.region, text: e.text, sizeScale: e.sizeScale, color: e.color,
        charMap: font?.charMap ?? {}, fallback: font?.fallback ?? { family: 'Helvetica', bold: false, italic: false },
        bgColor: pageData[page]?.colors[key]?.bg ?? '#ffffff',
        fgColor: pageData[page]?.colors[key]?.fg,
        room: (rooms[page] ??= lineRooms(pageData[page].runs))[key],
        scan: scanStyles.get(key),
        ocr: run.fontName === 'ocr' || undefined,
        scales: e.scales,
        looks: e.looks,
        offset: (e.dx || e.dy) && infos[page] ? userDelta(infos[page].vm, e.dx ?? 0, e.dy ?? 0) : undefined,
      });
    }
    return out;
  };

  // edits on scans / picture pages: built from the page's own letters (other pages lend missing ones)
  const scanImage = (e: TextEdit) => {
    const ctxOf = (src: number): PageCtx | null => {
      const d = pageData[src];
      return d && infos[src] ? { pdf, src, info: infos[src], runs: d.runs, colors: d.colors } : null;
    };
    const c = ctxOf(e.page);
    if (!c) return Promise.resolve(null);
    return cloneLineText(c, e.key, e.text, {
      sizeScale: e.sizeScale, color: e.color, family: e.scan?.family, stretch: e.scan?.stretch,
      more: () => Promise.all([e.page - 1, e.page + 1, e.page - 2, e.page + 2].map(ctxOf).filter((x): x is PageCtx => !!x).map((c) => pageGlyphs(c))),
    });
  };

  // table borders etc. that covers over edited lines keep
  const rulesOf = (src: number) => pageRules(pdf, src, infos[src], pageData[src]?.runs ?? []);
  // the page under a cover with the old letters filled in (patterns and tints stay)
  const coverOf = (src: number, rect: { x: number; y: number; w: number; h: number }, lineH: number, bg: string, fg: string) =>
    infos[src] ? pageCover(pdf, src, infos[src], rect, lineH, bg, fg) : Promise.resolve(null);

  // ----- edits on scans: shown straight away as the new letters over the page (no re-written PDF) -----
  // pages whose text is an invisible layer over a picture (an OCR'd scan)
  const [hiddenPages, setHiddenPages] = useState<Set<number>>(() => new Set());
  const checkedPages = useRef(new Set<number>());
  const checkHidden = (src: number) => {
    if (checkedPages.current.has(src)) return;
    checkedPages.current.add(src);
    (async () => {
      try {
        const OPS = (window as any).pdfjsLib?.OPS ?? {};
        const ol = await (await pdf.getPage(src + 1)).getOperatorList();
        // letters drawn while the rendering mode is invisible vs visible (q/Q keep their own mode)
        let hidden = 0, shown = 0, img = false, mode = 0;
        const stack: number[] = [];
        const shows = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
        ol.fnArray.forEach((fn: number, i: number) => {
          if (fn === OPS.setTextRenderingMode) mode = ol.argsArray[i]?.[0] ?? 0;
          else if (fn === OPS.save) stack.push(mode);
          else if (fn === OPS.restore) mode = stack.pop() ?? 0;
          else if (shows.has(fn)) { if (mode === 3 || mode === 7) hidden++; else shown++; }
          else if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject) img = true;
        });
        if (img && hidden > 0 && hidden >= shown) setHiddenPages((s) => new Set(s).add(src));
      } catch { /* not a scan */ }
    })();
  };
  useEffect(() => { checkHidden(curPage); if (curPage + 1 < pdf.numPages) checkHidden(curPage + 1); }, [curPage]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing?.includes(':')) checkHidden(+editing.split(':')[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const isScanKey = (key: string) => {
    const page = +key.split(':')[0];
    if (hiddenPages.has(page)) return true;
    return pageData[page]?.runs.find((r) => r.key === key)?.fontName === 'ocr';
  };
  const [clones, setClones] = useState<Record<string, { sig: string; url: string; img: ClonedText }>>({});
  const cloneSeq = useRef<Record<string, number>>({});
  useEffect(() => {
    const scanEdits = textEdits(snap.edits).filter((e) => isScanKey(e.key));
    const want = new Set(scanEdits.map((e) => e.key));
    setClones((c) => {
      const gone = Object.keys(c).filter((k) => !want.has(k));
      if (!gone.length) return c;
      const n = { ...c };
      for (const k of gone) { URL.revokeObjectURL(n[k].url); delete n[k]; }
      return n;
    });
    for (const e of scanEdits) {
      const sig = JSON.stringify([e.text, e.sizeScale, e.color]);
      if (clones[e.key]?.sig === sig) continue;
      const seq = (cloneSeq.current[e.key] = (cloneSeq.current[e.key] ?? 0) + 1);
      scanImage({ ...e, ocr: true }).then((img) => {
        if (cloneSeq.current[e.key] !== seq) return;
        setClones((c) => {
          const n = { ...c };
          if (n[e.key]) URL.revokeObjectURL(n[e.key].url);
          if (img) n[e.key] = { sig, url: URL.createObjectURL(new Blob([img.png as BlobPart], { type: 'image/png' })), img };
          else delete n[e.key];
          return n;
        });
      }).catch(() => null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.edits, hiddenPages, pageData]);
  useEffect(() => () => { for (const c of Object.values(clonesRef.current)) URL.revokeObjectURL(c.url); }, []);
  const clonesRef = useRef(clones);
  clonesRef.current = clones;
  /** a scan line shows its picture only once it matches the current text */
  const cloneFor = (key: string) => {
    const c = clones[key], e = snap.edits[key];
    return c && e && c.sig === JSON.stringify([e.text, e.sizeScale, e.color]) && isScanKey(key) ? c : undefined;
  };

  // ----- live preview: re-write edited pages with the real fonts and show that -----
  // (scan lines are drawn over the page instead, see above)
  const erases = snap.objects.filter((o) => o.type === 'erase');
  const eraseSig = JSON.stringify(erases.map((o) => [o.id, o.page]));
  const editKeyOf = (src: number) => {
    const list = Object.entries(snap.edits).filter(([k]) => k.startsWith(src + ':') && !isScanKey(k)).sort(([a], [b]) => (a < b ? -1 : 1));
    const cuts = erases.filter((o) => o.page === src).map((o) => o.id);
    return list.length || cuts.length ? JSON.stringify([list, cuts]) : '';
  };
  const [preview, setPreview] = useState<{ pdf: any; keys: Record<number, string> } | null>(null);
  const previewSeq = useRef(0);
  // One preview is made at a time; a newer change waits for it and then the latest state is made. A
  // finished preview is always shown (it is newer than what's on screen), so painting several strokes
  // in a row takes each one out as soon as it's ready instead of waiting for the hand to stop.
  const lastCutCount = useRef(0);
  const previewJob = useRef<{ running: boolean; next: null | (() => Promise<void>); shown: number }>({ running: false, next: null, shown: 0 });
  useEffect(() => {
    const seq = ++previewSeq.current;
    const edits = textEdits(snap.edits).filter((e) => !isScanKey(e.key));
    // Remove: what was painted over is taken out of these pages
    const cuts = snap.objects.filter((o) => o.type === 'erase');
    if (!edits.length && !cuts.length) { previewJob.current.next = null; previewJob.current.shown = seq; setPreview(null); return; }
    const keys: Record<number, string> = {};
    for (const e of edits) keys[e.page] = editKeyOf(e.page);
    for (const o of cuts) keys[o.page] = editKeyOf(o.page);
    const job = previewJob.current;
    const make = async () => {
      try {
        const bytes = await exportPdf({
          bytes: file.bytes, pages: infos.map((_, i) => ({ src: i, rotation: 0 })), objects: cuts, edits, scanImage, rules: rulesOf, coverImage: coverOf, matchFont: matchFontBytes,
          viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])),
        });
        if (seq <= job.shown) return;
        const doc = await openPdf(bytes);
        if (seq <= job.shown) { doc.destroy?.(); return; }
        job.shown = seq;
        setPreview((old) => { if (old?.pdf && old.pdf !== pdf) setTimeout(() => old.pdf.destroy?.(), 2000); return { pdf: doc, keys }; });
      } catch (err) {
        console.warn('preview failed', err);
      }
    };
    const pump = async () => {
      if (job.running) return;
      job.running = true;
      while (job.next) { const run = job.next; job.next = null; await run(); }
      job.running = false;
    };
    // text edits wait a moment for the typing to settle; Remove strokes go at once
    const onlyCuts = !edits.length || erases.length !== lastCutCount.current;
    lastCutCount.current = erases.length;
    const t = setTimeout(() => { job.next = make; pump(); }, onlyCuts ? 0 : 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.edits, hiddenPages, eraseSig]);

  // ----- Remove: paint over what should go -----
  const readContent = useMemo(() => contentReader(file.bytes), [file.bytes]);
  const [pendingCuts, setPendingCuts] = useState<Record<number, CutStroke[]>>({});
  /** strokes painted on a page that the page on screen doesn't show taken out yet */
  const erasingOn = (src: number): CutStroke[] => {
    // only strokes the page on screen doesn't show taken out yet (not every earlier one again)
    let done: string[] = [];
    try { done = (JSON.parse(preview?.keys[src] || '[]') as [unknown, string[]])[1] ?? []; } catch { /* none */ }
    return [...erases.filter((o) => o.page === src && !done.includes(o.id)).flatMap((o) => o.strokes), ...(pendingCuts[src] ?? [])];
  };
  /** lines of the file wholly painted over by Remove: no longer offered for editing */
  const erasedRuns = useMemo(() => {
    const out = new Set<string>();
    for (const [src, d] of Object.entries(pageData)) {
      const strokes = erases.filter((o) => o.page === +src).flatMap((o) => o.strokes);
      if (!strokes.length) continue;
      const vm = infos[+src]?.vm;
      if (!vm) continue;
      for (const r of d.runs) {
        if (snap.edits[r.key]) continue;
        const b = runBox(r, vm), c = Math.cos(b.angle), sn = Math.sin(b.angle), up = b.h * 0.3;
        if ([0.1, 0.5, 0.9].every((t) => underStrokes(strokes, b.x + c * b.w * t + sn * up, b.y + sn * b.w * t - c * up))) out.add(r.key);
      }
    }
    return out;
  }, [eraseSig, pageData, snap.edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const removeStroke = async (src: number, stroke: CutStroke) => {
    const vm = infos[src].vm;
    setPendingCuts((m) => ({ ...m, [src]: [...(m[src] ?? []), stroke] }));
    setRemovingBusy((n) => n + 1);
    try {
      const content = await readContent(src);
      const inFile = await cutsSomething(content, stroke, vm);
      // lines under the paint: changed ones lose their new text, untouched ones are taken out with the cut
      const gone = (pageData[src]?.runs ?? []).filter((r) => {
        // only lines changed in the editor: their new text isn't in the file, so the cut can't reach it
        if (isScanKey(r.key)) return false;
        const e = snap.edits[r.key];
        if (!e || !e.text) return false;
        const b = runBox(r, vm), c = Math.cos(b.angle), sn = Math.sin(b.angle), up = b.h * 0.3;
        return [0.2, 0.5, 0.8].filter((t) => underStrokes([stroke], b.x + c * b.w * t + sn * up + (e?.dx ?? 0), b.y + sn * b.w * t - c * up + (e?.dy ?? 0))).length >= 2;
      });
      if (inFile || gone.length) {
        const P = stroke.pts;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i + 1 < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
        commit((s) => {
          const edits = { ...s.edits };
          for (const r of gone) edits[r.key] = { ...(edits[r.key] ?? { sizeScale: 1, color: null }), text: '' };
          const o: EditorObject = { id: uid(), page: src, type: 'erase', strokes: [stroke], x: x0 - stroke.r, y: y0 - stroke.r, w: x1 - x0 + stroke.r * 2, h: y1 - y0 + stroke.r * 2 };
          return { ...s, edits, objects: inFile ? [...s.objects, o] : s.objects };
        });
        return;
      }
      // a page with real text: the stroke missed it
      if (content && content.it.glyphs.length) { toast({ msg: 'Nothing to remove there' }); return; }
      // a picture page whose picture the file holds in a way that can't be cut (inline), or content that
      // couldn't be read: the page's own texture is copied over what shows there instead
      const src0 = preview && preview.keys[src] !== undefined ? preview.pdf : pdf;
      const patch = await textureFill(await src0.getPage(src + 1), stroke, infos[src]);
      if (!patch) { toast({ msg: 'Nothing to remove there' }); return; }
      addObject({ id: uid(), page: src, type: 'image', ...patch });
    } catch (err) {
      console.warn('remove failed', err);
      toast({ msg: 'That couldn’t be removed', kind: 'err' });
    } finally {
      setPendingCuts((m) => ({ ...m, [src]: (m[src] ?? []).filter((k) => k !== stroke) }));
      setRemovingBusy((n) => n - 1);
    }
  };

  // ----- export -----
  const editCount = Object.keys(snap.edits).length + snap.objects.length + Object.keys(snap.forms).length;
  // lines recognised on picture pages (with their edits) for the saved file's text layer
  const ocrLayer = () => {
    const out: Record<number, LayerLine[]> = {};
    for (const [src, d] of Object.entries(pageData)) {
      const lines: LayerLine[] = [];
      for (const r of d.runs) {
        if (r.fontName !== 'ocr') continue;
        let text = (snap.edits[r.key]?.text ?? r.str).replace(/\s+/g, ' ').trim();
        // letters under a redaction are left out of the searchable text too
        const reds = snap.objects.filter((o) => o.type === 'redact' && o.page === +src);
        if (reds.length && infos[+src]) {
          const b = runBox(r, infos[+src].vm);
          const n = text.length;
          text = [...text].map((ch, i) => {
            const cx = b.x + ((i + 0.5) / n) * b.w, cy = b.y - b.h * 0.35;
            return reds.some((o) => cx >= o.x && cx <= o.x + o.w && cy >= o.y && cy <= o.y + o.h) ? ' ' : ch;
          }).join('').replace(/\s+/g, ' ').trim();
        }
        if (!text) continue;
        const [ox, oy] = r.region.o, [ux, uy] = r.region.u;
        lines.push({ text, x0: ox, y0: oy, x1: ox + ux * r.region.width, y1: oy + uy * r.region.width, size: r.region.height * (snap.edits[r.key]?.sizeScale ?? 1) });
      }
      if (lines.length) out[+src] = lines;
    }
    return out;
  };
  const droppedText = () => Object.fromEntries(Object.entries(dropped).map(([k, rs]) => [k, rs.map((r) => r.region)]));
  // the file's name: renamed by you, or the original with "-edited"
  const [docName, setDocName] = useState<string | null>(null);
  const outName = (n = docName) => ((n ?? file.name.replace(/\.pdf$/i, '') + '-edited').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document') + '.pdf';
  const [fileMenu, setFileMenu] = useState(false);
  const download = (how: 'save' | 'share' | 'print' = 'save', name?: string) => deliver(how, name);
  const deliver = async (how: 'save' | 'share' | 'print', rename?: string): Promise<boolean> => {
    setEditing(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    setBusy({ title: how === 'print' ? 'Preparing to print' : 'Preparing your PDF', detail: `Writing ${editCount || 'your'} ${editCount === 1 ? 'change' : 'changes'} into ${snap.pages.length} ${snap.pages.length === 1 ? 'page' : 'pages'}. Nothing is uploaded.` });
    try {
      const bytes = await exportPdf({
        bytes: file.bytes, pages: snap.pages, objects: snap.objects, edits: textEdits(snap.edits),
        viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])), forms: snap.forms, flatten, scanImage, rules: rulesOf, coverImage: coverOf,
        ocrLayer: ocrLayer(), dropText: droppedText(), matchFont: matchFontBytes,
      });
      const name = outName(rename ?? docName);
      setBusy(null);
      if (how === 'print') { printPdf(bytes); return true; }
      if (how === 'share') await shareFile(host, bytes, name, 'application/pdf', toast);
      else await saveFile(host, bytes, name, 'application/pdf', toast);
      savedSnap.current = snap;
      onSaved?.(bytes, name);
      return true;
    } catch (e: any) {
      console.error(e);
      toast({ msg: 'The PDF could not be saved: ' + (e?.message || 'unknown error'), kind: 'err', action: { label: 'Retry', run: () => { deliver(how); } } });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // fonts of the document that new text can use (one per typeface and cut, the one with most letters)
  const docFonts = useMemo(() => {
    const by = new Map<string, { f: DocFont; n: number }>();
    for (const [src, d] of Object.entries(pageData)) {
      for (const r of d.runs) {
        if (!r.str.trim()) continue;
        // also the fonts of a few words inside a line (a bold amount)
        for (const fn of [r.fontName, ...Object.keys(r.fontChars ?? {})]) {
          const info = fonts[fn];
          if (!info?.editFamily) continue;
          const n = Object.keys(info.charMap).length;
          const label = plainFontName(info.name);
          const had = by.get(label);
          if (had && had.n >= n) continue;
          const f = docFontOf(r, fonts, pageData[+src].runs, fn);
          if (f) by.set(label, { f, n });
        }
      }
    }
    return [...by.values()].map((v) => v.f).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 12);
  }, [pageData, fonts]);

  const findRun = (key: string) => pageData[+key.split(':')[0]]?.runs.find((r) => r.key === key);
  const selRun = selected?.includes(':') ? findRun(selected) : undefined;
  const selObj = selected && !selected.includes(':') ? snap.objects.find((o) => o.id === selected) : undefined;

  // ----- copy, cut, move and paste lines of the document's text -----
  const [moving, setMoving] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [pasting, setPasting] = useState(false);
  useEffect(() => { if (moving && selected !== moving) setMoving(null); }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  const runText = (r: TextRun) => snap.edits[r.key]?.text ?? r.str;
  /** what a line looks like, for pasting it as a text box */
  const clipOf = (r: TextRun): Clip => {
    const e = snap.edits[r.key];
    const info = fonts[r.fontName];
    const b = runBox(r, infos[r.page].vm);
    let color = e?.color ?? pageData[r.page]?.colors[r.key]?.fg ?? '#000000';
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    if (Math.max(cr, cg, cb) < 40 && Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 12) color = '#000000';
    const fb = info?.fallback ?? { family: 'Helvetica' as const, bold: false, italic: false };
    return { text: runText(r), size: Math.round(b.h * (e?.sizeScale ?? 1) * 10) / 10, color, font: docFontOf(r, fonts, pageData[r.page]?.runs ?? []), family: fb.family, bold: fb.bold, italic: fb.italic };
  };
  const toClipboard = (text: string) => {
    const legacy = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* not allowed */ }
      ta.remove();
    };
    try { navigator.clipboard?.writeText(text).catch(legacy) ?? legacy(); } catch { legacy(); }
  };
  const copyRun = (r: TextRun, cut = false) => afterBlur(() => {
    lastCopy.current = 'run';
    const c = clipOf(r);
    toClipboard(c.text);
    setClip(c);
    setPasting(true);
    if (cut) {
      const cur = snap.edits[r.key] ?? { text: r.str, sizeScale: 1, color: null };
      setRunEdit(r.key, { ...cur, text: '' });
    }
    setSelected(null);
    setMoving(null);
  });
  const startMove = (r: TextRun) => afterBlur(() => { setEditing(null); setSelected(r.key); setMoving(r.key); setPasting(false); });
  const moveRun = (key: string, dx: number, dy: number) => {
    const r = findRun(key);
    if (!r) return;
    const cur = snap.edits[key] ?? { text: r.str, sizeScale: 1, color: null };
    const near0 = Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05;
    const next: RunEdit = { ...cur, dx: near0 ? undefined : dx, dy: near0 ? undefined : dy };
    if (near0) { delete next.dx; delete next.dy; }
    const plain = next.text === r.str && next.sizeScale === 1 && next.color === null && !next.scales && !next.looks && near0;
    setRunEdit(key, plain ? null : next);
  };
  /** the copied line as a text box at a point of a page (its top-left there) */
  const pasteAt = (src: number, x: number, y: number) => {
    if (!clip) { setPasting(false); return; }
    const id = uid();
    addObject({ id, page: src, type: 'text', x, y: y - clip.size * 0.6, w: 20, h: clip.size * 1.2, text: clip.text, family: clip.family,
      size: clip.size, color: clip.color, bold: clip.bold, italic: clip.italic, ...(clip.font ? { font: clip.font } : {}) });
    setPasting(false);
    setSelected(id);
  };
  /** paste without a tap (keyboard): in the middle of the page in view */
  const pasteHere = () => {
    const info = infos[curPage];
    if (!clip || !info) return;
    pasteAt(curPage, info.w * 0.3, info.h * 0.4);
  };

  const nextRun = (key: string) => {
    const page = +key.split(':')[0];
    const order = snap.pages.map((p) => p.src);
    for (let pi = order.indexOf(page); pi < order.length; pi++) {
      const runs = pageData[order[pi]]?.runs ?? [];
      const i = order[pi] === page ? runs.findIndex((r) => r.key === key) + 1 : 0;
      if (runs[i]) { setSelected(runs[i].key); setEditing(runs[i].key); return; }
    }
  };

  // ----- pages that are only a picture (scans, image-only exports): offer text recognition -----
  const [pictureOnly, setPictureOnly] = useState<number[]>([]);
  const [ocrHidden, setOcrHidden] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const OPS = (window as any).pdfjsLib?.OPS ?? {};
      const imgOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintJpegXObject].filter((x) => x !== undefined));
      const noText: number[] = [];
      for (let i = 0; i < pdf.numPages && alive; i++) {
        try {
          const tc = await (await pdf.getPage(i + 1)).getTextContent();
          if (pageNeedsText(tc.items)) noText.push(i);
        } catch { /* skip */ }
      }
      // a few text-less pages may just be blank: check those for a picture (decoding is slow, so only then)
      let found = noText;
      if (noText.length && noText.length <= 3) {
        found = [];
        for (const i of noText) {
          try {
            const ol = await (await pdf.getPage(i + 1)).getOperatorList();
            if (ol.fnArray.some((fn: number) => imgOps.has(fn))) found.push(i);
          } catch { /* skip */ }
        }
      }
      if (alive) setPictureOnly(found);
    })();
    return () => { alive = false; };
  }, [pdf]);
  // Their text is read on this device when needed: a tap reads the line under the finger at once,
  // and the page on screen is read in the background. Lines stay in memory as editable runs and
  // become an invisible (searchable) text layer when the PDF is saved.
  const reader = useRef<import('./ocrReader').PageReader | null>(null);
  const [ocr, setOcr] = useState<import('./ocrReader').ReaderState | null>(null);
  const [ocrAll, setOcrAll] = useState(false);
  const pictureSet = useMemo(() => new Set(pictureOnly), [pictureOnly]);
  const getReader = async () => {
    if (reader.current) return reader.current;
    const { PageReader, OCR_FONT, OCR_FONT_INFO } = await import('./ocrReader');
    if (reader.current) return reader.current;
    setFonts((m) => ({ ...m, [OCR_FONT]: OCR_FONT_INFO }));
    reader.current = new PageReader(pdf, (src) => infos[src].vm,
      (src, runs, colors) => setPageData((m) => ({ ...m, [src]: { runs: [...(m[src]?.runs ?? []), ...runs], colors: { ...m[src]?.colors, ...colors } } })),
      setOcr);
    return reader.current;
  };
  useEffect(() => () => { reader.current?.dispose(); reader.current = null; }, [pdf]);
  // the page on screen is read in the background (after a moment, so scrolling past costs nothing)
  useEffect(() => {
    if (!pictureSet.has(curPage) || view !== 'doc') return;
    const t = setTimeout(() => {
      getReader().then((r) => {
        r.demote(1, ocrAll ? 3 : 2);
        r.want(curPage, 1);
      }).catch(() => null);
    }, reader.current ? 500 : 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curPage, pictureSet, view]);
  const readAll = async () => {
    const r = await getReader();
    setOcrAll(true);
    const order = [...pictureOnly].sort((a, b) => Math.abs(a - curPage) - Math.abs(b - curPage) || a - b);
    order.forEach((src, i) => r.want(src, src === curPage ? 1 : 3 + i / 1000));
  };
  const stopAll = () => { reader.current?.stop(curPage); setOcrAll(false); };
  const [tapAt, setTapAt] = useState<{ src: number; x: number; y: number } | null>(null);
  const readTap = async (src: number, x: number, y: number) => {
    setTapAt({ src, x, y });
    try {
      const r = await getReader();
      const key = await r.tap(src, x, y, pictureSet.has(src) ? [] : (pageData[src]?.runs ?? []).filter((q) => q.fontName !== 'ocr'));
      if (key) {
        setTool('edit'); setSelected(key); setEditing(key);
        // on a phone the hint has done its job once a line opens: give the page the room
        if (mobile && !ocrAll) setOcrHidden(true);
      }
      else toast({ msg: 'No text found there. Tap right on a line of text.' });
    } catch (e) {
      console.warn('ocr failed', e);
      toast({ msg: 'Text recognition is not available on this device.', kind: 'err' });
    } finally {
      setTapAt((t) => (t && t.src === src && t.x === x && t.y === y ? null : t));
    }
  };
  // An invisible text layer (saved by an older version, or another app) can hold a whole table row
  // as one line: a tap on such a line reads the cells from the picture and opens the one tapped.
  // The old line is then left out of the page and removed from the saved file.
  const [dropped, setDropped] = useState<Record<number, TextRun[]>>({});
  const droppedRef = useRef(dropped);
  droppedRef.current = dropped;
  const relineTap = (run: TextRun, x: number, y: number) => {
    const src = run.page;
    if (!hiddenPages.has(src) || run.fontName === 'ocr' || snap.edits[run.key] || pictureSet.has(src)) return false;
    setTapAt({ src, x, y });
    (async () => {
      let res: { keys: string[]; at: string | null } | null = null;
      // a line whose width does not fit its text (or with "|" for borders) is always read again
      const n = run.str.replace(/\s/g, '').length, k = run.region.width / Math.max(1, n * run.region.height);
      const force = /\s\|\s|^\|\s|\s\|$/.test(run.str) || (n > 0 && (k > 1.1 || k < 0.22));
      try { res = await (await getReader()).reline(src, run, x, y, force); } catch (e) { console.warn('reline failed', e); }
      setTapAt((t) => (t && t.src === src && t.x === x && t.y === y ? null : t));
      if (res) {
        setDropped((d) => ({ ...d, [src]: [...(d[src] ?? []), run] }));
        setPageData((m) => m[src] ? { ...m, [src]: { ...m[src], runs: m[src].runs.filter((r) => r.key !== run.key) } } : m);
      }
      const key = res?.at ?? (res ? res.keys[0] : run.key);
      setTool('edit'); setSelected(key); setEditing(key);
    })();
    return true;
  };

  const ocrDone = ocr?.done.filter((s) => pictureSet.has(s)).length ?? 0;
  useEffect(() => {
    if (ocrAll && pictureOnly.length && ocrDone >= pictureOnly.length) {
      toast({ msg: 'Text recognised on all pages. Tap a line to edit it.' });
      setOcrAll(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocrDone]);

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); hist.redo(); }
      else if (mod && k === '0') { e.preventDefault(); zoomTo(fitZoom()); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomStep(1); }
      else if (mod && k === '-') { e.preventDefault(); zoomStep(-1); }
      else if (mod && k === 'd' && selObj) { e.preventDefault(); duplicateObject(selObj.id); }
      else if (mod && k === 's') { e.preventDefault(); download('save'); }
      else if (mod && k === 'p') { e.preventDefault(); download('print'); }
      else if (mod && (k === 'c' || k === 'x') && selRun) { e.preventDefault(); copyRun(selRun, k === 'x'); }
      else if (mod && (k === 'c' || k === 'x') && selObj && selObj.type !== 'erase') {
        // an added object: copied (or cut) to paste on any page
        e.preventDefault(); objClip.current = selObj; lastCopy.current = 'obj';
        if (k === 'x') { removeObject(selObj.id); setSelected(null); }
        toast({ msg: k === 'x' ? 'Cut. Ctrl+V pastes it' : 'Copied. Ctrl+V pastes it' });
      }
      else if (mod && k === 'v' && objClip.current && !(clip && !selObj && lastCopy.current === 'run')) {
        e.preventDefault();
        const o = objClip.current, page = curRef.current, info = infos[page];
        const same = o.page === page;
        const nid = uid();
        const dx = same ? 12 : 0, dy = same ? 12 : 0;
        addObject({ ...o, id: nid, page, x: Math.min(o.x + dx, Math.max(0, info.w - o.w)), y: Math.min(o.y + dy, Math.max(0, info.h - o.h)), ...(o.type === 'line' ? { x2: o.x2 + dx, y2: o.y2 + dy } : {}) } as EditorObject);
        objClip.current = { ...o, page, x: o.x + dx, y: o.y + dy } as EditorObject;
        setSelected(nid);
      }
      else if (mod && k === 'v' && clip && !selObj) { e.preventDefault(); pasteHere(); }
      else if (!mod && !selected && (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'Home' || e.key === 'End')) {
        // pages: next / previous / first / last
        e.preventDefault();
        const i = snap.pages.findIndex((q) => q.src === curRef.current);
        const n = e.key === 'Home' ? 0 : e.key === 'End' ? snap.pages.length - 1 : Math.max(0, Math.min(snap.pages.length - 1, i + (e.key === 'PageDown' ? 1 : -1)));
        if (snap.pages[n]) goToPage(snap.pages[n].src);
      }
      else if (!mod && (e.key === '[' || e.key === ']') && tool === 'remove') {
        const sizes = [4, 9, 18], i = Math.max(0, sizes.indexOf(style.removeSize));
        setStyle((st) => ({ ...st, removeSize: sizes[Math.max(0, Math.min(2, i + (e.key === ']' ? 1 : -1)))] }));
      }
      else if (!mod && e.key === '?') { e.preventDefault(); setSelected(null); setKeysOpen((v) => !v); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        if (selRun) setRunEdit(selRun.key, { text: '', sizeScale: 1, color: null });
        else if (selObj) removeObject(selObj.id);
        setSelected(null);
      } else if (e.key.startsWith('Arrow') && selRun && moving === selRun.key) {
        // nudge the line being moved
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const cur = snap.edits[selRun.key];
        moveRun(selRun.key, (cur?.dx ?? 0) + (e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0), (cur?.dy ?? 0) + (e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0));
      } else if (e.key.startsWith('Arrow') && selObj) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        changeObject(selObj.id, { x: selObj.x + dx, y: selObj.y + dy, ...(selObj.type === 'line' ? { x2: selObj.x2 + dx, y2: selObj.y2 + dy } : {}) } as any, false);
      } else if (!mod && !e.altKey && e.key.length === 1 && RAIL.some((r) => r.key === e.key.toUpperCase())) {
        railClick(RAIL.find((r) => r.key === e.key.toUpperCase())!);
      } else if (e.key === 'Escape') {
        if (view === 'pages') setView('doc');
        setSelected(null); setFlyout(null); setMoreOpen(false); setSheetFor(null); setPasting(false); setMoving(null);
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
    setFlyout(null);
    setSelected(null);
    setEditing(null);
    setSheetFor(null);
    setView('doc');
    if (t === 'sign') { setShowSig({}); return; }
    if (t === 'image') { imgInput.current?.click(); return; }
    if (t === 'fill') setFillMark(fields.length ? null : 'check');
    setTool(t);
  };
  // started from a tools card (Fill a form, Sign): switch to that tool once the form fields are known
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !fieldsReady) return;
    started.current = true;
    if (start === 'fill' || start === 'sign') { pickTool(start); return; }
    // a form (fields that can be filled in): open in fill mode, unless something else was started already
    const formFields = fields.filter((f) => !f.readOnly);
    if (formFields.length && tool === 'edit' && !editing && !selected && !hist.canUndo) {
      pickTool('fill');
      toast({ msg: `A form: tap a field to fill it in`, action: { label: 'Edit text', run: () => pickTool('edit') } });
    }
  }, [fieldsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFlyout = (t: RailT) => {
    const btn = railBtns.current[t];
    const body = btn?.closest('.body');
    setFlyout({ t, top: btn && body ? btn.getBoundingClientRect().top - body.getBoundingClientRect().top - 6 : 120 });
  };
  const railClick = (r: RailItem) => {
    setMoreOpen(false);
    if (mobile) setRecent((v) => useRecent(v, r.t));
    if (r.t === 'pages') { setFlyout(null); setSelected(null); setEditing(null); setView((v) => (v === 'pages' ? 'doc' : 'pages')); return; }
    const same = railActive(r);
    if (r.t === 'shapes' || r.t === 'markup') {
      const group = r.t === 'shapes' ? SHAPE_TOOLS : MARK_TOOLS;
      if (!group.includes(tool) || view === 'pages') pickTool(r.t === 'shapes' ? lastShape.current : lastMark.current);
      if (same && flyout?.t === r.t) setFlyout(null); else openFlyout(r.t);
      return;
    }
    // phone: Remove (brush size) and Draw (colour, width) show their options too; nothing can be edited after
    const phoneOpts = mobile && (r.t === 'remove' || r.t === 'draw');
    if (same && r.opts && (!mobile || phoneOpts)) { if (flyout?.t === r.t) setFlyout(null); else openFlyout(r.t); return; }
    pickTool(r.t);
    if (r.opts && (!mobile || phoneOpts)) openFlyout(r.t);
  };
  const railActive = (r: RailItem) => r.t === 'pages' ? view === 'pages'
    : view === 'pages' ? false
    : r.t === 'shapes' ? SHAPE_TOOLS.includes(tool)
    : r.t === 'markup' ? MARK_TOOLS.includes(tool)
    : r.t === 'sign' ? !!showSig || selObj?.type === 'signature'
    : r.t === tool;
  useEffect(() => { if (SHAPE_TOOLS.includes(tool)) lastShape.current = tool; if (MARK_TOOLS.includes(tool)) lastMark.current = tool; }, [tool]);
  // the flyout closes on a click outside it (and outside the rail / dock)
  useEffect(() => {
    if (!flyout) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.('.flyout2, .rail, .dock3, .cp-scrim')) setFlyout(null);
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [flyout]);

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
    if (el && wrapRef.current) wrapRef.current.scrollTo({ top: el.offsetTop - 100 - safeTop(), behavior: 'smooth' });
  };
  // ----- find / privacy check -----
  const docRef = (): DocRef => ({
    pdf, pages: snap.pages.map((p) => p.src), vm: (src) => infos[src].vm,
    ocrRuns: (src) => pageData[src]?.runs.filter((r) => r.fontName === 'ocr') ?? [],
  });
  const goHit = (h: Hit) => {
    const el = wrapRef.current?.querySelector<HTMLElement>(`.pageOuter[data-src="${h.page}"]`);
    const r = h.rects[0];
    if (!el || !wrapRef.current) return;
    const y = el.offsetTop + (r ? r.y * zoom : 0);
    wrapRef.current.scrollTo({ top: Math.max(0, y - wrapRef.current.clientHeight * 0.35), behavior: 'smooth' });
    if (r && el.offsetWidth > wrapRef.current.clientWidth) wrapRef.current.scrollTo({ left: Math.max(0, el.offsetLeft + r.x * zoom - 40), behavior: 'smooth' });
  };
  const redactHits = (list: Hit[]) => {
    const add: EditorObject[] = [];
    for (const h of list) for (const r of h.rects) {
      if (r.w <= 0 || r.h <= 0) continue;
      add.push({ id: uid(), page: h.page, type: 'redact', x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 });
    }
    if (!add.length) return;
    commit((s) => ({ ...s, objects: [...s.objects, ...add] }));
    setFound({ list: [], cur: -1, priv: false });
    toast({ msg: `${add.length} ${add.length === 1 ? 'part' : 'parts'} blacked out. They are deleted from the file when you download.`, action: { label: 'Undo', run: hist.undo } });
  };
  const hitsByPage = useMemo(() => {
    const m: Record<number, { x: number; y: number; w: number; h: number; cur: boolean; priv: boolean }[]> = {};
    found.list.forEach((h, i) => { for (const r of h.rects) (m[h.page] ??= []).push({ ...r, cur: i === found.cur, priv: found.priv }); });
    return m;
  }, [found]);
  const scannedLeft = pictureOnly.filter((src) => !pageData[src]?.runs.some((r) => r.fontName === 'ocr')).length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setPrivOpen(false); setFindOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Bring a form field into view below the floating top bar, with room above it for its label (forms
   * put the label over the box), and above the field bar and the keyboard.
   */
  const revealField = (el: HTMLElement, smooth = false) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const top = Math.max(wr.top, document.querySelector('.topbar.float')?.getBoundingClientRect().bottom ?? wr.top);
    const vv = window.visualViewport;
    let bottom = Math.min(wr.bottom, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const bar = document.querySelector('.fieldnav')?.getBoundingClientRect();
    if (bar && bar.top > top) bottom = Math.min(bottom, bar.top);
    const r = el.getBoundingClientRect();
    // room above the field for its label: the page's own text just above it (forms print the label at
    // the top of the field's box), else about two lines
    const f = fields.find((x) => x.id === el.dataset.field);
    const lt = f ? labelTop(f) : null;
    const room = lt !== null ? Math.max(24, Math.min(240, (f!.y - lt) * zoom + 10)) : Math.max(56, Math.min(140, r.height * 2.2));
    let delta = r.top - (top + room);
    // a tall field that wouldn't fit with its label: as much of the field as possible, label first
    if (r.bottom - delta > bottom - 8) delta = Math.max(r.top - (top + 8), Math.min(delta, r.bottom - (bottom - 8)));
    if (Math.abs(delta) > 2) wrap.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'auto' });
  };
  /** where the label printed above a field starts (viewport units at zoom 1), null: none found */
  const labelTop = (f: FormField): number | null => {
    const info = infos[f.page], runs = pageData[f.page]?.runs;
    if (!info || !runs) return null;
    let best: number | null = null;
    for (const r of runs) {
      if (!r.str.trim()) continue;
      const b = runBox(r, info.vm);
      if (Math.abs(b.angle) > 0.02) continue;
      const bottom = b.top + b.height;
      // above the field (or beside its upper part), not far, and over it or starting just left of it
      if (bottom > f.y + f.h * 0.4 || b.top < f.y - Math.max(60, f.h * 5)) continue;
      if (b.x + b.w < f.x - 30 || b.x > f.x + f.w) continue;
      if (best === null || b.top > best) best = b.top;
    }
    return best;
  };
  /**
   * Keep doing so for a moment: the phone keyboard opening and the browser's own scrolling to the
   * focused field come later and would undo it. A touch on the page stops it.
   */
  const revealGen = useRef(0);
  const revealFieldSoon = (el: HTMLElement) => {
    const gen = ++revealGen.current;
    const stop = () => { revealGen.current++; off(); };
    const off = () => { wrapRef.current?.removeEventListener('touchstart', stop); wrapRef.current?.removeEventListener('wheel', stop); };
    wrapRef.current?.addEventListener('touchstart', stop, { passive: true });
    wrapRef.current?.addEventListener('wheel', stop, { passive: true });
    const run = () => { if (revealGen.current === gen && document.activeElement === el) revealField(el); };
    run();
    requestAnimationFrame(run);
    for (const t of [120, 300, 600, 900, 1300]) setTimeout(run, t);
    setTimeout(() => { if (revealGen.current === gen) off(); }, 1400);
    const vv = window.visualViewport;
    const onVv = () => run();
    vv?.addEventListener('resize', onVv);
    setTimeout(() => vv?.removeEventListener('resize', onVv), 1400);
  };
  const focusField = (f?: FormField) => {
    if (!f) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(f.id)}"]`);
    if (el) {
      // (focusing it scrolls it into view, see onFieldFocus; a field already focused is scrolled here)
      const had = document.activeElement === el;
      el.focus({ preventScroll: true });
      if (desk) scrollToEl(el, 'center'); else if (had) revealFieldSoon(el);
    }
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
      const top = wr.top + 76 + safeTop(); // below the floating top bar
      const h = wr.bottom - top;
      const target = top + h * 0.28;
      if (r.top > top + h * 0.45 || r.top < top + 8) wrap.scrollBy({ top: r.top - target, behavior: 'smooth' });
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
      const ic: Record<string, string> = { text: 'text', image: 'image', signature: 'sign', rect: 'rect', ellipse: 'ellipse', whiteout: 'whiteout', redact: 'redact', highlight: 'highlight', line: 'line', draw: 'draw', mark: 'check', link: 'link', erase: 'bandaids' };
      out.push({ id: o.id, icon: ic[o.type], label: o.type === 'text' ? `Text “${o.text.trim().slice(0, 24) || '…'}”` : objTitle(o), page: pageNo(o.page) });
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
  const runProps = (compact: boolean, hideTools = false) => selRun && (
    <RunProps run={selRun} hideTools={hideTools} font={fonts[selRun.fontName]} edit={snap.edits[selRun.key]} line={lineLabel(selRun.key)} compact={compact}
      known={(c) => [selRun.fontName, ...Object.keys(selRun.fontChars ?? {})].some((n) => fonts[n]?.charMap[c] !== undefined)}
      origColor={pageData[+selRun.key.split(':')[0]]?.colors[selRun.key]?.fg ?? '#000000'}
      onEdit={(e) => (e.text === '' ? afterBlur(() => { setRunEdit(selRun.key, e); if (mobile) setSelected(null); }) : setRunEdit(selRun.key, e))}
      onReset={() => afterBlur(() => setRunEdit(selRun.key, null))} onClose={() => setSelected(null)}
      onCopy={() => copyRun(selRun)} onCut={() => copyRun(selRun, true)} onMove={() => startMove(selRun)} />
  );
  const objProps = (compact: boolean, hideTools = false) => selObj && (
    <ObjProps o={selObj} hideTools={hideTools} compact={compact} docFonts={docFonts} order={snap.pages.map((p) => p.src)} onChange={(p) => changeObject(selObj.id, p, false)} onDelete={() => removeObject(selObj.id)}
      onDuplicate={() => duplicateObject(selObj.id)} onClose={() => { setSelected(null); setSheetFor(null); }} />
  );
  const fillPanel = (
    <FillPanel fields={fillable} values={snap.forms} index={fieldIndex} filled={filledCount} mark={fillMark} flatten={flatten}
      onPick={(f) => focusField(f)} onMark={(m) => setFillMark((cur) => (cur === m ? null : m))} onFlatten={setFlatten} onDownload={download}
      onPrev={() => focusField(fillable[Math.max(0, fieldIndex - 1)])} onNext={() => focusField(fillable[Math.min(fillable.length - 1, fieldIndex + 1)])} />
  );
  const panel = selRun ? runProps(false) : selObj ? objProps(false) : tool === 'fill' ? fillPanel
    : null; // tool options live in the rail flyout

  const mobileEditing = mobile && editing && (editing.includes(':') || snap.objects.find((o) => o.id === editing)?.type === 'text');
  const fieldNav = !desk && tool === 'fill' && activeField && fillable.length > 0;
  useEffect(() => {
    const el = dockRef.current?.querySelector<HTMLElement>('.dk3.on');
    const box = dockRef.current;
    if (!el || !box) return;
    const l = el.offsetLeft, r = l + el.offsetWidth;
    if (l < box.scrollLeft + 8 || r > box.scrollLeft + box.clientWidth - 8) box.scrollTo({ left: l - (box.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
  }, [tool, view, mobile]);
  const sheetObj = sheetFor ? snap.objects.find((o) => o.id === sheetFor) : undefined;

  // phone / browser back: finish typing, then close what's open, then leave the document
  const requestClose = () => (editCount && savedSnap.current !== snap ? setAskClose(true) : onClose());
  useBack(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) { el.blur(); return; }
    if (view === 'pages' || selected || flyout || moreOpen || sheetFor || slimOpen) {
      if (view === 'pages') setView('doc');
      setSelected(null); setFlyout(null); setMoreOpen(false); setSheetFor(null); setSlimOpen(false);
      return;
    }
    requestClose();
  });

  return (
    <div className={`app bp-${bp}`}>
      {askClose && <ConfirmClose changes={editCount} sheet={mobile} onCancel={() => setAskClose(false)}
        onDiscard={() => { setAskClose(false); onClose(); }}
        onDownload={async () => { setAskClose(false); if (await download()) onClose(); }} />}
      <header className="topbar float">
        <button className="ibtn" onClick={requestClose} aria-label="Close document" title="Close"><Icon name="back" /></button>
        <div className="doc">
          <div className="names">
            <button className="fname fbtn" title="Rename, share, print" onClick={() => setFileMenu(true)} aria-haspopup="dialog">
              <span>{docName ? docName + '.pdf' : file.name}</span><Icon name="caret-down:bold" size={13} />
            </button>
            <div className="fmeta"><span>{snap.pages.length} {snap.pages.length === 1 ? 'page' : 'pages'}</span>
              {editCount > 0 && <span className="chg">{editCount} {editCount === 1 ? 'change' : 'changes'}</span>}</div>
          </div>
        </div>
        <div className="group">
          {desk && <button className={`ibtn${keysOpen ? ' on' : ''}`} onClick={() => { setSelected(null); setKeysOpen((v) => !v); }} aria-label="Keyboard shortcuts" title="Keyboard and mouse shortcuts (?)"><Icon name="keyboard" size={19} /></button>}
          {!mobile && view === 'doc' && <button className={`ibtn${findOpen ? ' on' : ''}`} onClick={() => { setPrivOpen(false); setFindOpen((v) => !v); }} aria-label="Find in document" title="Find (Ctrl+F)"><Icon name="magnifying-glass" size={19} /></button>}
          {!mobile && view === 'doc' && <button className={`ibtn${privOpen ? ' on' : ''}`} onClick={() => { setFindOpen(false); setPrivOpen((v) => !v); }} aria-label="Privacy check" title="Privacy check: find and black out personal data"><Icon name="shield-check" size={20} /></button>}
          <button className="ibtn" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
          <button className="ibtn" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        </div>
        {!mobile && view === 'doc' && (
          <div className="zoompill">
            <button className="ibtn" onClick={() => zoomStep(-1)} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={16} /></button>
            <button className="pct" onClick={() => zoomTo(fitZoom())} title="Fit width (Ctrl+0)" aria-label={`Zoom ${Math.round(zoom * 100)}%, fit width`}>{Math.round(zoom * 100)}%</button>
            <button className="ibtn" onClick={() => zoomStep(1)} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={16} /></button>
            {desk && <button className="ibtn" onClick={() => zoomTo(fitZoom())} aria-label="Fit width" title="Fit width"><Icon name="fit" size={16} /></button>}
          </div>
        )}
        {!mobile && <button className={`ibtn${strip ? ' on' : ''}`} onClick={() => setStrip((v) => !v)} aria-pressed={strip} aria-label="Pages panel" title="Pages panel"><Icon name="sidebar-simple" size={20} weight={strip ? 'fill' : 'regular'} /></button>}
        {!mobile && <button className="ibtn" onClick={onTools} aria-label="All tools" title="All tools: combine, extract, convert"><Icon name="dots-nine" size={20} /></button>}
        {!mobile && <ThemeButton theme={theme} onToggle={onTheme} />}
        <button className="ibtn" onClick={() => download('share')} aria-label="Share PDF" title="Share"><Icon name="share-network" size={20} /></button>
        {mobile
          ? <button className="ibtn primary" onClick={() => download()} aria-label={host.isNative ? 'Save PDF' : 'Download PDF'}><Icon name="download" size={20} /></button>
          : <button className="btn primary dl" onClick={() => download()}><Icon name="download" size={18} />Download</button>}
      </header>
      {fileMenu && (
        <FileSheet name={docName ?? file.name.replace(/\.pdf$/i, '') + '-edited'} original={file.name} mobile={mobile} native={!!host.isNative}
          pages={snap.pages.length} changes={editCount}
          onRename={(n) => setDocName(n)} onClose={() => setFileMenu(false)}
          onAct={(a, n) => { setFileMenu(false); if (a === 'find') { setPrivOpen(false); setView('doc'); setFindOpen(true); } else download(a, n); }} />
      )}

      <div className="body" {...fileDrop.bind}>
        <DropOverlay show={fileDrop.over} title={view === 'pages' ? 'Drop to add pages' : 'Drop to add'}
          sub={view === 'pages' ? 'PDFs and images become new pages after the current page' : 'Images go on the page where you drop them; PDFs are added as pages after the current page'} />
        {!mobile && (
          <nav className="rail" aria-label="Tools">
            {GROUPS.map((g) => (
              <div key={g.name} className="rgroup" role="group" aria-label={g.name}>
                {g.items.map((r) => {
                  const on = railActive(r);
                  return (
                    <button key={r.t} ref={(el) => { railBtns.current[r.t] = el; }} className={`tool${on ? ' active' : ''}${r.opts ? ' opts' : ''}`}
                      aria-pressed={on} aria-haspopup={r.opts ? 'true' : undefined} aria-expanded={r.opts ? flyout?.t === r.t : undefined}
                      title={`${r.label} (${r.key})`} onClick={() => railClick(r)}>
                      <Icon name={r.icon} size={22} weight={on ? 'fill' : 'duotone'} /><span>{r.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        )}
        <div className="deskWrap">
          <div className={`canvasWrap${panReady ? ' pan-ready' : ''}${panning ? ' panning' : ''}`} ref={wrapRef}>
            <div className="pages">
              {snap.pages.map((p, i) => (
                <PageView key={p.src} src={p.src} index={i} rotation={p.rotation} info={infos[p.src]} zoom={zoom} pdf={pdf}
                  tool={tool} style={style} data={pageData[p.src]} fonts={fonts} edits={snap.edits}
                  objects={objectsByPage[p.src] ?? []} selected={selected} editing={editing}
                  onData={(src, d, f) => {
                    // keep lines already recognised on a picture page
                    setPageData((m) => {
                      const read = m[src]?.runs.filter((r) => r.fontName === 'ocr') ?? [];
                      const gone = new Set((droppedRef.current[src] ?? []).map((r) => r.key));
                      const own = gone.size ? d.runs.filter((r) => !gone.has(r.key)) : d.runs;
                      return { ...m, [src]: read.length ? { runs: [...own, ...read], colors: { ...m[src].colors, ...d.colors } } : { ...d, runs: own } };
                    });
                    setFonts((m) => ({ ...m, ...f }));
                  }}
                  onSelect={(id) => { setSelected(id); if (id === null) setSheetFor(null); }} onEditing={setEditing} onStopEditing={stopEditing}
                  hits={hitsByPage[p.src]}
                  onRunEdit={setRunEdit} onAdd={addObject} onChange={changeObject}
                  onRemove={removeStroke} erasing={erasingOn(p.src)} skipRuns={erasedRuns}
                  onPlace={() => false}
                  onDelete={removeObject} onDuplicate={duplicateObject}
                  onTextPlaced={() => setTool('edit')}
                  onPictureTap={pictureSet.has(p.src) || hiddenPages.has(p.src) ? (x, y) => readTap(p.src, x, y) : undefined}
                  onRunTap={hiddenPages.has(p.src) ? relineTap : undefined}
                  reading={pictureSet.has(p.src) || hiddenPages.has(p.src) ? {
                    page: !!ocr?.reading.includes(p.src),
                    band: ocr?.tap?.src === p.src ? ocr.tap : null,
                    at: tapAt?.src === p.src ? tapAt : null,
                  } : undefined}
                  onVisible={(src, r) => { ratios.current[src] = r; const c = currentPage(); if (c !== curPage) setCurPage(c); }}
                  editKey={editKeyOf(p.src)} cloneFor={cloneFor}
                  onDragInfo={setDragInfo}
                  preview={preview && preview.keys[p.src] !== undefined ? { pdf: preview.pdf, key: preview.keys[p.src] } : undefined}
                  fields={fieldsByPage[p.src] ?? []} forms={snap.forms} activeField={activeField} fillMark={tool === 'fill' ? fillMark : null}
                  mobile={mobile} onFieldValue={setFieldValue} onFieldFocus={(id) => {
                    setActiveField(id); setSelected(null);
                    // a tapped field: also clear of the top bar, with its label in view
                    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(id)}"]`);
                    if (el && !desk) requestAnimationFrame(() => revealFieldSoon(el));
                  }}
                  onFieldSign={(f) => setShowSig({ field: f })}
                  onNextRun={nextRun} onMore={(id) => setSheetFor(id)}
                  moving={moving} onRunMove={moveRun} pasting={pasting && !!clip} onPasteAt={pasteAt} sheetOpen={mobile && !!sheetObj} />
              ))}
            </div>
          </div>
          {view === 'pages' && (
            <Organizer pdf={pdf} pages={snap.pages} mobile={mobile} onDone={() => setView('doc')} onAdd={(n) => setAddAfter(n)}
              onChange={(pages) => commit((s) => ({ ...s, pages }))} />
          )}
          {pictureOnly.length > 0 && !ocrHidden && view === 'doc' && (
            <div className="ocrbar" role="region" aria-label="Text recognition">
              <span className="oi"><Icon name="text-t:duotone" size={22} /></span>
              <div className="ot">
                <b>{pictureOnly.length === snap.pages.length ? (pictureOnly.length === 1 ? 'This page is a picture' : 'These pages are pictures') : `${pictureOnly.length} ${pictureOnly.length === 1 ? 'page is a picture' : 'pages are pictures'}`}</b>
                <span>{ocr?.failed ? 'Text recognition is not available on this device.'
                  : ocrAll ? `Reading text · ${ocrDone} of ${pictureOnly.length} pages done. You can edit meanwhile.`
                  : 'Tap any text to edit it. It is read on this device; nothing is uploaded.'}</span>
              </div>
              {pictureOnly.length > 1 && !ocr?.failed && ocrDone < pictureOnly.length && (
                <div className="oa">
                  {ocrAll
                    ? <button className="btn outline" onClick={stopAll}>Stop</button>
                    : <button className="btn outline" onClick={readAll}>Read all {pictureOnly.length} pages</button>}
                </div>
              )}
              {ocrAll && <div className="op" aria-hidden><i style={{ width: `${Math.round((ocrDone / pictureOnly.length) * 100)}%` }} /></div>}
              <button className="ibtn muted x" aria-label="Hide" onClick={() => setOcrHidden(true)}><Icon name="close" size={18} /></button>
            </div>
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
        {strip && view === 'doc' && (
          <PageStrip pages={snap.pages} cur={curPage} overlay={!desk}
            pdfFor={(src) => (preview && preview.keys[src] !== undefined ? preview.pdf : pdf)}
            onGo={(src) => { goToPage(src); if (mobile) setStrip(false); }} onClose={() => setStrip(false)}
            onOrganize={() => { setStrip(false); railClick(RAIL.find((r) => r.t === 'pages')!); }}
            onAdd={onAddPages ? () => setAddAfter(Math.max(0, snap.pages.findIndex((p) => p.src === curPage)) + 1) : undefined} />
        )}
        {!desk && !strip && view === 'doc' && !mobileEditing && !fieldNav && (
          <button className="pgtab" onClick={() => setStrip(true)} aria-label="Show all pages">
            <Icon name="sidebar-simple" size={17} /><b>{Math.max(1, snap.pages.findIndex((p) => p.src === curPage) + 1)}</b>/{snap.pages.length}
          </button>
        )}
        {desk && view === 'doc' && (
          <aside className="side" aria-label="Properties">
            {panel ?? <IdleProps changes={changes} onPick={pickChange} />}
          </aside>
        )}
        {tablet && view === 'doc' && panel && !(tool === 'fill' && activeField) && (
          <aside ref={cardRef} className={`floatcard ${cardLeft ? 'l' : 'r'}`} aria-label="Properties">{panel}</aside>
        )}
        {flyout && (() => {
          const item = RAIL.find((r) => r.t === flyout.t)!;
          const t: Tool = flyout.t === 'shapes' ? (SHAPE_TOOLS.includes(tool) ? tool : lastShape.current)
            : flyout.t === 'markup' ? (MARK_TOOLS.includes(tool) ? tool : lastMark.current) : flyout.t as Tool;
          const tiles = flyout.t === 'shapes' ? SHAPES : flyout.t === 'markup' ? MARK_TILES : null;
          return (
            <div className={`flyout2${mobile ? ' m' : ''}`} role="dialog" aria-label={`${item.label} options`}
              style={mobile ? undefined : { top: Math.max(8, flyout.top) }}>
              <div className="fh"><b>{item.label}</b>{!mobile && <kbd>{item.key}</kbd>}</div>
              {tiles && (
                <div className="ftiles" role="radiogroup" aria-label={flyout.t === 'shapes' ? 'Shape' : 'Mark'}>
                  {tiles.map(([st, label, ic]) => (
                    <button key={st} role="radio" aria-checked={tool === st} className={tool === st ? 'on' : ''} onClick={() => { const ft = flyout.t; pickTool(st); if (!mobile) openFlyout(ft); }}>
                      <Icon name={ic} size={20} weight={tool === st ? 'fill' : 'regular'} />{label}
                    </button>
                  ))}
                </div>
              )}
              {(!mobile || flyout.t === 'remove' || flyout.t === 'draw') && toolHasProps(t) && <ToolProps tool={t} style={style} compact onChange={(v) => setStyle((x) => ({ ...x, ...v }))} />}
            </div>
          );
        })()}
      </div>

      {pasting && clip && (
        <div className={`pastepill${mobile ? '' : ' desk'}`} role="status">
          <Icon name="clipboard-text" size={18} />
          <span className="pp-t">Tap where to paste “{clip.text.length > 24 ? clip.text.slice(0, 23) + '…' : clip.text}”</span>
          <button onClick={() => setPasting(false)}>Cancel</button>
        </div>
      )}
      {moving && !pasting && (
        <div className={`pastepill${mobile ? '' : ' desk'}`} role="status">
          <Icon name="move" size={18} />
          <span className="pp-t">{mobile ? 'Drag the line to move it' : 'Drag the line, or use the arrow keys'}</span>
          <button onClick={() => { setMoving(null); setSelected(null); }}>Done</button>
        </div>
      )}
      {mobile && mobileEditing && (
        <SlimBar open={slimOpen} onOpen={setSlimOpen} onDone={() => (document.activeElement as HTMLElement | null)?.blur?.()}
          run={selRun && editing === selRun.key ? { label: fontLabel(fonts[selRun.fontName]), css: fonts[selRun.fontName]?.cssFallback,
            size: selRun.region.height * (snap.edits[selRun.key]?.sizeScale ?? 1), key: selRun.key,
            color: snap.edits[selRun.key]?.color ?? pageData[+selRun.key.split(':')[0]]?.colors[selRun.key]?.fg ?? '#000',
            onSize: (v) => { const cur = snap.edits[selRun.key] ?? { text: selRun.str, sizeScale: 1, color: null }; setRunEdit(selRun.key, { ...cur, sizeScale: v / selRun.region.height }); } } : undefined}
          obj={selObj?.type === 'text' ? selObj : undefined} docFonts={docFonts.length > 0}
          onObj={(p) => selObj && changeObject(selObj.id, p, false)}
          tools={selRun && editing === selRun.key
            ? <RunTextTools run={selRun} edit={snap.edits[selRun.key]} onEdit={(e) => setRunEdit(selRun.key, e)} />
            : selObj?.type === 'text' ? <ObjTextTools o={selObj} docFonts={docFonts} onChange={(p) => changeObject(selObj.id, p, false)} /> : null}>
          {selRun ? runProps(true, true) : objProps(true, true)}
        </SlimBar>
      )}
      {mobile && !mobileEditing && !(fieldNav) && (
        <nav className="dock3" aria-label="Tools">
          <div className="dk-scroll" ref={dockRef}>
            {DOCK.map((t) => {
              const r = RAIL.find((x) => x.t === t)!;
              const on = railActive(r);
              return (
                <button key={r.t} className={`dk3${on ? ' on' : ''}`} aria-pressed={on} onClick={() => railClick(r)} data-t={r.t}>
                  <span className="ic"><Icon name={r.icon} size={22} weight={on ? 'fill' : 'regular'} /></span>{r.label}
                </button>
              );
            })}
          </div>
          <span className="sep" aria-hidden />
          <button className={`dk3 more${moreOpen ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => { setFlyout(null); setSelected(null); setMoreOpen(true); }}>
            <span className="ic"><Icon name="dots-nine:bold" size={22} /></span>More
          </button>
        </nav>
      )}
      {mobile && moreOpen && (
        <>
          <div className="sheet-scrim" onClick={() => setMoreOpen(false)} />
          <div className="toolsheet" role="dialog" aria-label="All tools">
            <div className="grab" />
            <div className="tsh"><h2>All tools</h2>
              <ThemeButton theme={theme} onToggle={onTheme} />
              <button className="ibtn round" onClick={() => setMoreOpen(false)} aria-label="Close"><Icon name="x:bold" size={18} /></button></div>
            {GROUPS.map((g) => (
              <div key={g.name} className="tsg">
                <span className="kicker">{g.name}</span>
                <div className="tiles">
                  {g.items.map((r) => {
                    const on = railActive(r);
                    return (
                      <button key={r.t} className={`tile${on ? ' on' : ''}`} aria-pressed={on} onClick={() => railClick(r)}>
                        <span className="chip" style={{ background: on ? 'var(--marker)' : g.tint }}><Icon name={r.icon} size={21} weight={on ? 'fill' : 'duotone'} /></span>
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="tsg">
              <span className="kicker">Check</span>
              <div className="tiles">
                <button className="tile" onClick={() => { setMoreOpen(false); setFindOpen(true); }}><span className="chip" style={{ background: 'var(--tint-change)' }}><Icon name="magnifying-glass" size={21} weight="duotone" /></span>Find</button>
                <button className="tile" onClick={() => { setMoreOpen(false); setPrivOpen(true); }}><span className="chip" style={{ background: 'var(--tint-change)' }}><Icon name="shield-check" size={21} weight="duotone" /></span>Privacy</button>
              </div>
            </div>
            <button className="more-tools" onClick={() => { setMoreOpen(false); onTools(); }}>More tools: compress, password, split…<Icon name="right" size={16} /></button>
          </div>
        </>
      )}
      {mobile && sheetObj && (
        <>
          <div className="sheet-scrim" onClick={() => setSheetFor(null)} />
          <div className="bsheet" role="dialog" aria-label="Object properties">
            <div className="grab" />
            <ObjProps o={sheetObj} docFonts={docFonts} order={snap.pages.map((p) => p.src)} onChange={(p) => changeObject(sheetObj.id, p, false)} onDelete={() => removeObject(sheetObj.id)}
              onDuplicate={() => { duplicateObject(sheetObj.id); setSheetFor(null); }} onClose={() => setSheetFor(null)} />
          </div>
        </>
      )}
      {mobile && tool === 'fill' && !activeField && !mobileEditing && (
        <MobileFillBar fields={fillable.length} filled={filledCount} mark={fillMark} onMark={(m) => setFillMark((cur) => (cur === m ? null : m))}
          onStart={() => focusField(fillable[0])} />
      )}

      <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
      {findOpen && view === 'doc' && (
        <FindBar doc={docRef} mobile={mobile} onClose={() => { setFindOpen(false); setFound({ list: [], cur: -1, priv: false }); }}
          onHits={(list, cur) => setFound({ list, cur, priv: false })} onGo={goHit} onRedact={redactHits} />
      )}
      {privOpen && view === 'doc' && (
        <PrivacyCheck doc={docRef} mobile={mobile} scannedLeft={scannedLeft}
          onReadScans={pictureOnly.length > 1 ? () => readAll() : undefined}
          onClose={() => { setPrivOpen(false); setFound({ list: [], cur: -1, priv: false }); }}
          onHits={(list) => setFound({ list, cur: -1, priv: true })} onGo={(h) => { goHit(h); if (mobile) setPrivOpen(false); }}
          onRedact={(h) => { redactHits(h); setPrivOpen(false); }} />
      )}
      {addAfter !== null && onAddPages && (
        <AddPagesSheet after={addAfter} total={snap.pages.length} mobile={mobile} onClose={() => setAddAfter(null)}
          onAdd={(w) => { const at = addAfter; setAddAfter(null); onAddPages(at, w).then((first) => { if (first !== null && view === 'doc') setTimeout(() => goToPage(first), 400); }); }} />
      )}
      {keysOpen && <ShortcutsSheet onClose={() => setKeysOpen(false)} />}
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

// ---------------- the file: rename, share, print, save ----------------
function FileSheet({ name, original, mobile, native, pages, changes, onRename, onClose, onAct }: {
  name: string; original: string; mobile: boolean; native: boolean; pages: number; changes: number;
  onRename: (n: string) => void; onClose: () => void; onAct: (a: 'save' | 'share' | 'print' | 'find', name?: string) => void;
}) {
  const [v, setV] = useState(name);
  const commit = () => { const t = v.replace(/\.pdf$/i, '').trim(); if (t && t !== name) { onRename(t); return t; } return undefined; };
  const close = () => { commit(); onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const act = (a: 'save' | 'share' | 'print' | 'find') => onAct(a, commit());
  return (
    <>
      <div className="sheet-scrim filescrim" onClick={close} />
      <div className={`bsheet filesheet${mobile ? '' : ' center'}`} role="dialog" aria-label="File">
        {mobile && <div className="grab" />}
        <div className="fs-h"><span className="fs-ic"><Icon name="file-pdf:duotone" size={26} /></span>
          <div><b>File</b><span>{pages} {pages === 1 ? 'page' : 'pages'}{changes ? ` · ${changes} ${changes === 1 ? 'change' : 'changes'}` : ''}</span></div>
          <button className="ibtn round" onClick={close} aria-label="Close"><Icon name="x:bold" size={18} /></button>
        </div>
        <label className="fs-name">
          <span className="kicker">Name</span>
          <span className="sc-name"><input className="input" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { commit(); onClose(); } }}
            aria-label="File name" autoComplete="off" spellCheck={false} onFocus={(e) => e.currentTarget.select()} /><em>.pdf</em></span>
          <small>Opened as {original}</small>
        </label>
        <div className="fs-acts">
          <button onClick={() => act('share')}><span className="ic"><Icon name="share-network:duotone" size={22} /></span><b>Share</b><span>Send to an app, mail or chat</span></button>
          {!native && <button onClick={() => act('print')}><span className="ic"><Icon name="printer:duotone" size={22} /></span><b>Print</b><span>Opens the print dialog</span></button>}
          <button onClick={() => act('save')}><span className="ic"><Icon name="file-arrow-down:duotone" size={22} /></span><b>{native ? 'Save' : 'Download'}</b><span>{native ? 'To Files, Drive or another app' : 'To your downloads'}</span></button>
          {mobile && <button onClick={() => act('find')}><span className="ic"><Icon name="magnifying-glass:duotone" size={22} /></span><b>Find</b><span>Search the text</span></button>}
        </div>
      </div>
    </>
  );
}

// ---------------- the list of pages on the right ----------------
function PageStrip({ pages, cur, overlay, pdfFor, onGo, onClose, onOrganize, onAdd }: {
  pages: { src: number; rotation: number }[]; cur: number; overlay: boolean; pdfFor: (src: number) => any;
  onGo: (src: number) => void; onClose: () => void; onOrganize: () => void; onAdd?: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = list.current, el = box?.querySelector<HTMLElement>('.ps-it.on');
    if (!box || !el) return;
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: 'smooth' });
  }, [cur]);
  return (
    <>
      {overlay && <div className="ps-scrim" onClick={onClose} />}
      <aside className={`pstrip${overlay ? ' ov' : ''}`} aria-label="Pages">
        <div className="ps-h">
          <b>Pages</b><span className="ps-c">{pages.length}</span>
          <span style={{ flex: 1 }} />
          <button className="ibtn" onClick={onOrganize} aria-label="Organize pages" title="Organize: reorder, rotate, delete"><Icon name="squares-four" size={18} /></button>
          <button className="ibtn" onClick={onClose} aria-label="Hide pages" title="Hide"><Icon name="close" size={18} /></button>
        </div>
        <div className="ps-list" ref={list}>
          {pages.map((p, i) => (
            <button key={p.src} className={`ps-it${p.src === cur ? ' on' : ''}`} onClick={() => onGo(p.src)} aria-label={`Page ${i + 1}`} aria-current={p.src === cur ? 'page' : undefined}>
              <span className="ps-th"><Thumb pdf={pdfFor(p.src)} src={p.src} rotation={p.rotation} size={130} /></span>
              <span className="ps-n">{i + 1}</span>
            </button>
          ))}
        </div>
        {onAdd && <button className="ps-add" onClick={onAdd} title="Add pages after the current page"><Icon name="plus:bold" size={16} />Add page</button>}
      </aside>
    </>
  );
}

// ---------------- phone: slim properties bar above the keyboard ----------------
function SlimBar({ open, onOpen, onDone, run, obj, onObj, children, docFonts, tools }: {
  open: boolean; onOpen: (v: boolean) => void; onDone: () => void;
  /** bold, italic, underline, … (always in view) */ tools?: React.ReactNode;
  run?: { label: string; css?: string; size: number; color: string; onSize: (v: number) => void; key?: string };
  obj?: Extract<EditorObject, { type: 'text' }>; onObj: (p: any) => void; children: React.ReactNode;
  /** the document has fonts new text can use */
  docFonts?: boolean;
}) {
  const fams: FontFamily[] = ['Helvetica', 'Times', 'Courier'];
  const famLabel: Record<FontFamily, string> = { Helvetica: 'Sans', Times: 'Serif', Courier: 'Mono' };
  const famCss: Record<FontFamily, string> = { Helvetica: 'Arial, sans-serif', Times: '"Times New Roman", serif', Courier: '"Courier New", monospace' };
  const onToggle = () => onOpen(!open);
  // letters selected in the line being typed: the size control is theirs
  const selSize = useLineSelSize(run?.key ?? obj?.id);
  // While the options are open the keyboard stays down (the caret stays), so changing a setting
  // doesn't bring it back each time. Tapping the text, or closing the options, shows it again.
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  useEffect(() => {
    if (!open) return;
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || (el instanceof HTMLElement && el.isContentEditable))) return;
    setSoftKeyboard(el, false);
    const backToTyping = () => latestOpen.current(false);
    el.addEventListener('pointerdown', backToTyping);
    return () => {
      el.removeEventListener('pointerdown', backToTyping);
      if (el.isConnected) setSoftKeyboard(el, true);
    };
  }, [open]);
  return (
    // keep the text field focused while using the bar
    <div className="slimbar" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); }}>
      {open && <div className="more">{children}</div>}
      {tools && <div className="fmtrow">{tools}</div>}
      <div className="row">
        {run && <button className="chipb" onClick={onToggle} aria-label={`Font ${run.label}`}><span style={{ fontFamily: run.css }}>Aa</span><span className="fn">{run.label}</span></button>}
        {obj && (
          obj.font || docFonts
            // the document's fonts: pick one in the options
            ? <button className="chipb" aria-label={`Font ${obj.font?.label ?? famLabel[obj.family]}`} onClick={onToggle}>
                <span style={{ fontFamily: obj.font?.css ?? famCss[obj.family], fontSynthesis: 'none' } as any}>Aa</span><span className="fn">{obj.font?.label ?? famLabel[obj.family]}</span>
              </button>
            : <button className="chipb" aria-label="Change font" onClick={() => onObj({ family: fams[(fams.indexOf(obj.family) + 1) % 3] })}>
                <span style={{ fontFamily: famCss[obj.family] }}>Aa</span><span className="fn">{famLabel[obj.family]}</span>
              </button>
        )}
        {run && <Stepper soft value={selSize ?? run.size} min={2} max={300} label={selSize !== null ? 'size of the selected letters' : 'size'}
          onChange={(v) => { if (selSize !== null && lineEditor()?.setSelSize(v)) return; run.onSize(v); }} />}
        {obj && <Stepper soft value={selSize ?? obj.size} min={selSize !== null ? 2 : 4} max={200} label={selSize !== null ? 'size of the selected letters' : 'size'}
          onChange={(size) => { if (selSize !== null && lineEditor()?.setSelSize(size)) return; onObj({ size }); }} />}
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
    <div className="slimbar fillfloat">
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
