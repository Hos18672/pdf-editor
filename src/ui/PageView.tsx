import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharLook, ClonedText, EditorObject, FormValues, M } from '../engine/types';
import { buildRuns, analyseFont, FontInfo, TextRun } from '../engine/pdfText';
import { runBox, toLocal, sampleColors, applyM } from './geometry';
import type { RunEdit, Tool, ToolStyle } from './store';
import { uid, cleanScales, cleanLooks, sameLooks } from './store';
import { BASELINE, textSize, arabicText } from '../engine/matchFonts';
import { hasArabic, isRtl } from '../engine/rtl';
import { registerEditFont, baselineInLine, docFontOf, objectFontCss, arabicFace, ARABIC_CSS } from './textFonts';
import { gesture } from './gesture';
import { Icon } from './icons';
import { isRefocusing, editingHeld } from './hooks';
import { FormLayer, FormField } from './Fields';
import { matchScanStyle, scanStyles } from './scanStyle';
import { coverPixels } from './rules';
import { fillField, readField, fieldSelection, setFieldSelection, setLineEditor, lineEditor, lineEditorChanged, fieldEditor, lookCss, type FieldContent, type LookMode } from './lineEdit';

export type FillMark = 'check' | 'cross' | 'dot' | 'text' | 'date';

export interface PageInfo { w: number; h: number; vm: M; }
export interface PageData { runs: TextRun[]; colors: Record<string, { bg: string; fg: string }>; }

/** underline / strike-through: where the line runs in the marked box (fraction of its height) and how thick */
export const MARK_UNDER = 0.83, MARK_STRIKE = 0.5;
export const markWidth = (h: number) => Math.max(0.6, Math.min(3, h * 0.075));


interface Props {
  /** search / privacy-check matches on this page (viewport units) */
  hits?: { x: number; y: number; w: number; h: number; cur: boolean; priv: boolean }[];
  src: number;
  index: number;
  rotation: number;
  info: PageInfo;
  zoom: number;
  pdf: any;
  tool: Tool;
  style: ToolStyle;
  data?: PageData;
  fonts: Record<string, FontInfo>;
  edits: Record<string, RunEdit>;
  objects: EditorObject[];
  selected: string | null;
  editing: string | null;
  onData: (src: number, data: PageData, fonts: Record<string, FontInfo>) => void;
  onSelect: (id: string | null) => void;
  onEditing: (id: string | null) => void;
  onStopEditing: (id: string) => void;
  onRunEdit: (key: string, e: RunEdit | null) => void;
  onAdd: (o: EditorObject | EditorObject[]) => void;
  onChange: (id: string, patch: Partial<EditorObject>, merge: boolean) => void;
  onPlace: (src: number, x: number, y: number) => boolean;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTextPlaced: () => void;
  /** where a drag is happening (for the magnifier), null when it ends */
  onDragInfo: (d: { x: number; y: number; id: string; page: number } | null) => void;
  onVisible: (src: number, ratio: number) => void;
  /** the page as re-written with the current text edits (exact output glyphs) */
  preview?: { pdf: any; key: string };
  /** signature of this page's current text edits ('' = none) */
  editKey: string;
  /** a scan line's new text as a picture of the page's letters, ready to show */
  cloneFor?: (key: string) => { url: string; img: ClonedText } | undefined;
  fields: FormField[];
  forms: FormValues;
  activeField: string | null;
  fillMark: FillMark | null;
  mobile: boolean;
  onFieldValue: (name: string, v: string | boolean) => void;
  onFieldFocus: (id: string) => void;
  onFieldSign: (f: FormField) => void;
  /** Tab in a line: edit the next one */
  onNextRun: (key: string) => void;
  /** phone: open the properties sheet of an object */
  onMore: (id: string) => void;
  /** picture page: a tap on it reads the text there */
  onPictureTap?: (x: number, y: number) => void;
  /** a tap on a line of the page's text (viewport point): true when it is handled there */
  onRunTap?: (run: TextRun, x: number, y: number) => boolean;
  /** a properties sheet is open over the page (phone): no floating toolbars */
  sheetOpen?: boolean;
  /** the line being moved (drag it), if any */
  moving?: string | null;
  onRunMove?: (key: string, dx: number, dy: number) => void;
  /** copied text waiting for a tap on the page to be placed there */
  pasting?: boolean;
  onPasteAt?: (src: number, x: number, y: number) => void;
  /** picture page: text being read (whole page in the background, a tapped line) */
  reading?: { page: boolean; band: { y0: number; y1: number } | null; at: { x: number; y: number } | null };
}

export function PageView(p: Props) {
  const { info, zoom, rotation } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(0); // zoom it was rendered at
  const renderTask = useRef<any>(null);
  const renderedKey = useRef<string | null>(null);
  const [shownKey, setShownKey] = useState('');
  const [paints, setPaints] = useState(0); // canvas repaints (covers copy its table lines)
  const source = p.preview?.pdf ?? p.pdf;
  const sourceKey = p.preview?.key ?? '';
  const [draft, setDraft] = useState<null | { x0: number; y0: number; x1: number; y1: number; pts?: number[] }>(null);

  const W = info.w * zoom;
  const H = info.h * zoom;
  const swap = rotation % 180 !== 0;

  // visibility
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        setVisible(e.isIntersecting);
        p.onVisible(p.src, e.intersectionRatio);
      }
    }, { rootMargin: '600px 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.src]);

  // render canvas (debounced on zoom)
  useEffect(() => {
    if (!visible) return;
    if (rendered && Math.abs(rendered - zoom) < 0.001 && renderedKey.current === sourceKey) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      let page: any;
      try { page = await source.getPage(p.src + 1); } catch { return; }
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const scale = Math.min(zoom * dpr, 4096 / Math.max(info.w, info.h));
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      try {
        renderTask.current?.cancel?.();
        renderTask.current = page.render({ canvasContext: ctx, viewport: vp, annotationMode: 2 /* ENABLE_FORMS: fields are drawn by the form layer */ });
        await renderTask.current.promise;
      } catch {
        return;
      }
      if (cancelled || !canvasRef.current) return;
      const target = canvasRef.current;
      target.width = canvas.width;
      target.height = canvas.height;
      target.getContext('2d')!.drawImage(canvas, 0, 0);
      setRendered(zoom);
      setPaints((n) => n + 1);
      renderedKey.current = sourceKey;
      setShownKey(sourceKey);

      if (!p.data && source === p.pdf) {
        const tc = await page.getTextContent();
        const runs = buildRuns(tc.items, p.src);
        const fonts: Record<string, FontInfo> = {};
        // every font of the page, also those of a few words inside a line (a bold amount)
        for (const fn of [...new Set(runs.flatMap((r) => [r.fontName, ...Object.keys(r.fontChars ?? {})]))]) {
          if (fonts[fn] || p.fonts[fn]) continue;
          try {
            const f = page.commonObjs.has(fn) ? page.commonObjs.get(fn) : null;
            if (f) {
              const info = analyseFont(f, fn);
              fonts[fn] = info;
              info.editFamily = await Promise.race([
                registerEditFont(info, f),
                new Promise<undefined>((res) => setTimeout(() => res(undefined), 2500)),
              ]);
            }
          } catch { /* font unavailable */ }
        }
        if (cancelled) return;
        const colors: PageData['colors'] = {};
        const k = scale;
        for (const r of runs) {
          const b = runBox(r, info.vm);
          const c = Math.cos(b.angle), s = Math.sin(b.angle);
          const corners: [number, number][] = [[0, -b.asc], [b.w, -b.asc], [b.w, b.h * 0.3], [0, b.h * 0.3]]
            .map(([dx, dy]) => [(b.x + dx * c - dy * s) * k, (b.y + dx * s + dy * c) * k]);
          colors[r.key] = sampleColors(ctx, corners);
        }
        p.onData(p.src, { runs, colors }, fonts);
      }
    }, rendered && renderedKey.current === sourceKey ? 160 : 0);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, zoom, p.pdf, p.src, source, sourceKey]);
  // the canvas already shows the edited text with the document's real glyphs
  // (per line: a newer edit elsewhere on the page leaves the lines already in the preview as they are)
  const shownEdits = useMemo(() => {
    const m = new Map<string, string>();
    try { for (const [k, e] of JSON.parse(shownKey || '[]') as [string, unknown][]) m.set(k, JSON.stringify(e)); } catch { /* none */ }
    return m;
  }, [shownKey]);
  const liveRun = (key: string) => !!p.edits[key] && shownEdits.get(key) === JSON.stringify(p.edits[key]);
  const shownEdit = (key: string): RunEdit | null => { const j = shownEdits.get(key); try { return j ? JSON.parse(j) : null; } catch { return null; } };

  // Opening a line for editing: note the look of its letters on the page (font, weight, width,
  // softness), so the edit can be drawn to match when the text is part of a scan / picture.
  useEffect(() => {
    const key = p.editing;
    if (!key || !key.startsWith(p.src + ':') || scanStyles.has(key) || p.edits[key] || source !== p.pdf) return;
    const run = p.data?.runs.find((r) => r.key === key);
    const canvas = canvasRef.current;
    const colors = p.data?.colors[key];
    if (!run || !canvas || !colors || !canvas.width) return;
    const b = runBox(run, info.vm);
    if (Math.abs(b.angle) > 0.02) return;
    const k = canvas.width / info.w;
    matchScanStyle(canvas, { x: b.x * k, y: b.y * k, w: b.w * k, size: b.h * k }, run.str, colors)
      .then((st) => { if (st) scanStyles.set(key, st); })
      .catch(() => null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.editing]);

  const local = (e: { clientX: number; clientY: number }) =>
    toLocal(e.clientX, e.clientY, pageRef.current!, info.w, info.h, zoom, rotation);

  // ---- creating shapes / placing things ----
  const dragTools: Tool[] = ['whiteout', 'redact', 'highlight', 'underline', 'strike', 'rect', 'ellipse', 'line', 'arrow', 'draw', 'link'];
  const onLayerClick = (e: React.MouseEvent) => {
    if (gesture.multi) return;
    if (p.pasting && p.onPasteAt) { p.onPasteAt(p.src, local(e).x, local(e).y); return; }
    const onObj = !!(e.target as HTMLElement).closest('.obj');
    if (onObj && !(p.tool === 'text' && downObj.current)) return;
    if ((e.target as HTMLElement).closest('.run, textarea, .objbar, .ff, .ffbox, .ffsig')) return;
    const pt = local(e);
    const id = uid();
    if (p.tool === 'fill' && p.fillMark) {
      if (p.fillMark === 'text' || p.fillMark === 'date') {
        const text = p.fillMark === 'date' ? new Date().toLocaleDateString() : '';
        const look = p.style.match ? lookAt(pt) : null;
        const size = look?.size ?? 11;
        p.onAdd({ id, page: p.src, type: 'text', x: pt.x, y: look?.y ?? pt.y - size * 0.6, w: 20, h: size * 1.2, text, family: 'Helvetica', size, color: '#000000', bold: false, italic: false,
          ...(look ? { family: look.family, bold: look.bold, italic: look.italic, font: look.font ?? undefined, color: look.color } : {}) });
        p.onSelect(id);
        if (!text) p.onEditing(id);
      } else {
        const w = 12;
        p.onAdd({ id, page: p.src, type: 'mark', kind: p.fillMark, x: pt.x - w / 2, y: pt.y - w / 2, w, h: w, color: '#1d1d1f' });
        p.onSelect(id);
      }
      return;
    }
    // a picture page (scan): tapping its text reads it, then opens the line for editing
    // (a tap that only ends editing or clears a selection does not)
    if (p.onPictureTap && p.tool === 'edit') { if (!hadSelection.current) p.onPictureTap(pt.x, pt.y); return; }
    // new text boxes are placed on click (tap), so scrolling or a two-finger gesture never adds one
    if (p.tool !== 'text') return;
    // new text looks like the page's own text next to it (font, size, colour; on a line: its baseline)
    const look = p.style.match ? lookAt(pt) : null;
    if (look) {
      p.onAdd({ id, page: p.src, type: 'text', x: pt.x, y: look.y ?? pt.y - look.size * 0.6, w: 20, h: look.size * 1.2,
        text: '', family: look.family, size: look.size, color: look.color, bold: look.bold, italic: look.italic, ...(look.font ? { font: look.font } : {}) });
    } else {
      p.onAdd({ id, page: p.src, type: 'text', x: pt.x, y: pt.y - p.style.fontSize * 0.6, w: 20, h: p.style.fontSize * 1.2,
        text: '', family: p.style.family, size: p.style.fontSize, color: p.style.color, bold: false, italic: false });
    }
    p.onSelect(id);
    p.onEditing(id);
    p.onTextPlaced();
  };
  /** the look of the document's text nearest to a point (null: the page has no usable text) */
  const lookAt = (pt: { x: number; y: number }) => {
    let best: { r: TextRun; b: ReturnType<typeof runBox>; d: number; on: boolean } | null = null;
    for (const r of p.data?.runs ?? []) {
      if (!r.str.trim()) continue;
      const b = runBox(r, info.vm);
      if (Math.abs(b.angle) > 0.02 || b.h < 2) continue;
      const top = b.y - b.asc, bot = b.y + b.h * 0.3;
      const dx = Math.max(0, b.x - pt.x, pt.x - (b.x + b.w));
      const dy = Math.max(0, top - pt.y, pt.y - bot);
      // the line above / below counts more than a far one in the same row
      const d = dx * 0.6 + dy * 2;
      if (!best || d < best.d) best = { r, b, d, on: dy === 0 && dx < b.h * 8 };
    }
    if (!best || best.d > 400) return null;
    const { r, b } = best;
    const info2 = p.fonts[r.fontName];
    const font = docFontOf(r, p.fonts, p.data!.runs);
    const size = Math.round(b.h * 10) / 10;
    let color = p.data!.colors[r.key]?.fg ?? '#000000';
    // anti-aliased black reads as a dark grey: keep it black
    const [cr, cg, cb] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    if (Math.max(cr, cg, cb) < 40 && Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 12) color = '#000000';
    const fb = info2?.fallback ?? { family: 'Helvetica' as const, bold: false, italic: false };
    const base = font ? font.base : BASELINE[fb.family];
    return {
      size, color, font, family: fb.family, bold: fb.bold, italic: fb.italic,
      /** top of the new text so that it sits on the line's baseline */
      y: best.on ? b.y - size * base : undefined,
    };
  };
  const hadSelection = useRef(false);
  const downObj = useRef<string | null>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const onLayerDown = (e: React.PointerEvent) => {
    hadSelection.current = p.selected !== null || p.editing !== null;
    // started on an object the tool works through
    const through = (e.nativeEvent as any).peObj as string | undefined;
    downObj.current = through ?? null;
    if (e.button !== 0 || gesture.multi) return;
    // a second finger (pinch starting): drop the stroke the first one began
    if (e.pointerType === 'touch' && !e.isPrimary) { setDraft(null); return; }
    if ((e.target as HTMLElement).closest(through ? '.run, textarea, .objbar, .ff, .ffbox, .ffsig' : '.obj, .run, textarea, .objbar, .ff, .ffbox, .ffsig')) return;
    const pt = local(e);
    if (p.tool === 'text' || (p.tool === 'fill' && p.fillMark)) return;
    if ((p.tool === 'sign' || p.tool === 'image') && p.onPlace(p.src, pt.x, pt.y)) return;
    if (dragTools.includes(p.tool)) {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDraft({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y, pts: p.tool === 'draw' ? [pt.x, pt.y] : undefined });
      e.preventDefault();
      return;
    }
    (document.activeElement as HTMLElement | null)?.blur?.();
    p.onSelect(null);
  };
  const onLayerMove = (e: React.PointerEvent) => {
    if (!draft) return;
    if (gesture.multi) { setDraft(null); return; }
    const pt = local(e);
    setDraft((d) => d && ({ ...d, x1: pt.x, y1: pt.y, pts: d.pts ? [...d.pts, pt.x, pt.y] : undefined }));
  };
  const onLayerUp = () => {
    if (!draft) return;
    const d = draft;
    setDraft(null);
    if (gesture.multi) return;
    // a tap (no drag) on an object selects it; while something is selected, a tap only lets go of it
    if (downObj.current && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * zoom < 8) { p.onSelect(downObj.current); return; }
    if (hadSelection.current && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * zoom < 8) { p.onSelect(null); return; }
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    let w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    const id = uid();
    const st = p.style;
    if (p.tool === 'draw') {
      const pts = d.pts ?? [];
      if (pts.length < 4) return;
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      // a tap (a finger always wobbles a little) is not a stroke: it left stray dots on the page
      let len = 0;
      for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (ext < Math.max(4, 12 / zoom, st.strokeWidth * 2) || len < Math.max(6, 16 / zoom)) return;
      const minX = Math.min(...xs), minY = Math.min(...ys);
      p.onAdd({ id, page: p.src, type: 'draw', x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY,
        stroke: st.stroke, strokeWidth: st.strokeWidth, points: pts.map((v, i) => v - (i % 2 ? minY : minX)) });
      return;
    }
    if (p.tool === 'line' || p.tool === 'arrow') {
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
      p.onAdd({ id, page: p.src, type: 'line', x: d.x0, y: d.y0, x2: d.x1, y2: d.y1, w: 0, h: 0, stroke: st.stroke, strokeWidth: st.strokeWidth, ...(p.tool === 'arrow' ? { arrow: true } : null) });
      p.onSelect(id);
      return;
    }
    const markup = p.tool === 'highlight' || p.tool === 'underline' || p.tool === 'strike';
    if (markup) {
      // over text: follows the lines like a text selection (from where the drag started to where it ended)
      const lines = textSpans(d);
      if (lines.length) {
        const objs = lines.map((l, i): EditorObject => markObj(i ? uid() : id, l.x, l.y, l.w, l.h));
        p.onAdd(objs);
        if (objs.length === 1) p.onSelect(id);
        return;
      }
    }
    if (w < 4 || h < 4) {
      if (!markup && p.tool !== 'whiteout' && p.tool !== 'redact' && p.tool !== 'link') return;
      w = 120; h = 22;
    }
    if (markup) { p.onAdd(markObj(id, x, y, w, h)); p.onSelect(id); return; }
    if (p.tool === 'link') { p.onAdd({ id, page: p.src, type: 'link', x, y, w, h, url: '' }); p.onSelect(id); return; }
    if (p.tool === 'whiteout') p.onAdd({ id, page: p.src, type: 'whiteout', x, y, w, h, fill: '#ffffff' });
    else if (p.tool === 'redact') p.onAdd({ id, page: p.src, type: 'redact', x, y, w, h });
    else if (p.tool === 'highlight') p.onAdd({ id, page: p.src, type: 'highlight', x, y, w, h, fill: st.highlight, opacity: 0.4 });
    else p.onAdd({ id, page: p.src, type: p.tool as 'rect' | 'ellipse', x, y, w, h, stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth });
    p.onSelect(id);
  };

  /** a highlight / underline / strike-through box */
  const markObj = (id: string, x: number, y: number, w: number, h: number): EditorObject => {
    const st = p.style;
    return p.tool === 'highlight'
      ? { id, page: p.src, type: 'highlight', x, y, w, h, fill: st.highlight, opacity: 0.4 }
      : { id, page: p.src, type: 'highlight', style: p.tool === 'underline' ? 'underline' : 'strike', x, y, w, h, fill: st.ink, opacity: 1 };
  };
  /** the stretches of text lines between the drag's start and end (a tap: the word's whole line piece) */
  const textSpans = (d: { x0: number; y0: number; x1: number; y1: number }) => {
    const boxes = (p.data?.runs ?? []).map((r) => runBox(r, info.vm)).filter((b) => Math.abs(b.angle) < 0.02 && b.w > 0)
      .map((b) => ({ x0: b.x, x1: b.x + b.w, top: b.top, bot: b.top + b.height, base: b.y, h: b.h }));
    if (!boxes.length) return [];
    const [a, z] = d.y0 <= d.y1 ? [{ x: d.x0, y: d.y0 }, { x: d.x1, y: d.y1 }] : [{ x: d.x1, y: d.y1 }, { x: d.x0, y: d.y0 }];
    const ylo = a.y, yhi = z.y;
    // pieces touched by the drag's height (a flat drag: the line it runs along)
    const hit = boxes.filter((b) => (yhi - ylo < 3 ? b.top - 2 <= ylo && ylo <= b.bot + 2 : Math.min(b.bot, yhi) - Math.max(b.top, ylo) > (b.bot - b.top) * 0.3 || (b.top <= ylo && ylo <= b.bot) || (b.top <= yhi && yhi <= b.bot)));
    if (!hit.length) return [];
    // group into lines by baseline
    hit.sort((p1, p2) => p1.base - p2.base);
    const lines: (typeof hit)[] = [];
    for (const b of hit) { const l = lines[lines.length - 1]; if (l && Math.abs(l[0].base - b.base) < Math.max(l[0].h, b.h) * 0.5) l.push(b); else lines.push([b]); }
    const tap = Math.abs(d.x1 - d.x0) < 4 && Math.abs(d.y1 - d.y0) < 4;
    const out: { x: number; y: number; w: number; h: number }[] = [];
    lines.forEach((l, i) => {
      const lx0 = Math.min(...l.map((b) => b.x0)), lx1 = Math.max(...l.map((b) => b.x1));
      const top = Math.min(...l.map((b) => b.top)), bot = Math.max(...l.map((b) => b.bot));
      let xa = lx0, xb = lx1;
      if (tap) {
        const b = l.find((q) => q.x0 - 2 <= a.x && a.x <= q.x1 + 2);
        if (!b) return;
        xa = b.x0; xb = b.x1;
      } else if (lines.length === 1) { xa = Math.max(lx0, Math.min(d.x0, d.x1)); xb = Math.min(lx1, Math.max(d.x0, d.x1)); }
      else if (i === 0) xa = Math.max(lx0, Math.min(lx1, a.x));
      else if (i === lines.length - 1) xb = Math.min(lx1, Math.max(lx0, z.x));
      if (xb - xa < 2) return;
      out.push({ x: xa, y: top, w: xb - xa, h: bot - top });
    });
    return out;
  };

  // existing text stays clickable (= editable) with the Edit and Add-text tools
  const passive = (p.tool !== 'edit' && p.tool !== 'text') || !!p.pasting;
  const rooms = useMemo(() => lineRooms(p.data?.runs ?? []), [p.data]);
  // snap targets: page centre and the left margin(s) the text already uses
  const snap = useMemo(() => {
    const lefts = new Map<number, number>();
    for (const r of p.data?.runs ?? []) {
      const b = runBox(r, info.vm);
      if (Math.abs(b.angle) > 0.01) continue;
      const k = Math.round(b.x);
      lefts.set(k, (lefts.get(k) ?? 0) + 1);
    }
    const xs = [...lefts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x]) => x);
    if (!xs.length) xs.push(36);
    return { xs, cx: info.w / 2, cy: info.h / 2 };
  }, [p.data, info]);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  return (
    <div ref={outerRef} className="pageOuter" data-src={p.src} data-rot={rotation} style={{ width: swap ? H : W, height: swap ? W : H }}>
      <div
        ref={pageRef}
        className={`page tool-${p.tool}${p.pasting ? ' pasting' : ''}`}
        style={{ width: W, height: H, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
        onPointerDownCapture={(e) => { downAt.current = local(e); }}
        onPointerDown={onLayerDown}
        onClick={onLayerClick}
        onPointerMove={onLayerMove}
        onPointerUp={onLayerUp}
        onPointerCancel={() => setDraft(null)}
      >
        <canvas ref={canvasRef} />
        <div className={`layer${passive ? ' passive' : ''}`}>
          {p.hits?.map((h, i) => (
            <div key={i} className={`hitbox${h.cur ? ' cur' : ''}${h.priv ? ' priv' : ''}`} style={{ left: (h.x - 1) * zoom, top: (h.y - 1) * zoom, width: (h.w + 2) * zoom, height: (h.h + 2) * zoom }} />
          ))}
          {p.data?.runs.map((r) => (
            <RunView key={r.key} run={r} vm={info.vm} zoom={zoom} font={p.fonts[r.fontName]} color={p.data!.colors[r.key]}
              edit={p.edits[r.key]} shown={shownEdit(r.key)} editing={p.editing === r.key} selected={p.selected === r.key} room={rooms[r.key]} live={liveRun(r.key)}
              moving={p.moving === r.key} onMove={(dx, dy) => p.onRunMove?.(r.key, dx, dy)}
              page={{ canvas: canvasRef, w: info.w, paints }}
              clone={p.edits[r.key] ? p.cloneFor?.(r.key) : undefined}
              local={local} onNext={() => p.onNextRun(r.key)}
              onStart={() => {
                const at = downAt.current;
                if (at && p.onRunTap?.(r, at.x, at.y)) return;
                p.onSelect(r.key); p.onEditing(r.key);
              }}
              onCommit={(raw, ks, ls) => {
                // NFC can join letters: sizes and looks only stay when the letters stay the same
                const text = raw.normalize('NFC');
                const prev = p.edits[r.key];
                const scales = cleanScales(text, ks);
                const looks = cleanLooks(text, ls);
                const next: RunEdit = { text, sizeScale: prev?.sizeScale ?? 1, color: prev?.color ?? null,
                  ...(scales ? { scales } : {}), ...(looks ? { looks } : {}), ...(prev?.dx || prev?.dy ? { dx: prev.dx ?? 0, dy: prev.dy ?? 0 } : {}) };
                const unchanged = text === r.str && next.sizeScale === 1 && next.color === null && !scales && !looks && !next.dx && !next.dy;
                const same = !!prev && prev.text === text && JSON.stringify(prev.scales ?? null) === JSON.stringify(scales ?? null) && sameLooks(prev.looks, looks);
                if (unchanged ? prev : !same) p.onRunEdit(r.key, unchanged ? null : next);
                p.onStopEditing(r.key);
              }} />
          ))}
          {(p.fields.length > 0) && (
            <FormLayer fields={p.fields} values={p.forms} zoom={zoom} interactive={p.tool === 'fill'} active={p.activeField}
              onValue={p.onFieldValue} onFocus={p.onFieldFocus} onSign={p.onFieldSign} />
          )}
          {p.objects.map((o) => (
            <ObjectView key={o.id} o={o} zoom={zoom} selected={p.selected === o.id} editing={p.editing === o.id}
              pass={p.tool === 'text' ? o.type !== 'text' : dragTools.includes(p.tool) && p.selected !== o.id}
              local={local} rotation={rotation} onSelect={() => p.onSelect(o.id)} onEditing={(v) => (v ? p.onEditing(o.id) : p.onStopEditing(o.id))}
              onChange={(patch, merge) => p.onChange(o.id, patch, merge)}
              onDelete={() => p.onDelete(o.id)} onDuplicate={() => p.onDuplicate(o.id)}
              onDrag={(d) => p.onDragInfo(d ? { ...d, id: o.id, page: p.src } : null)}
              snap={snap} page={info} onGuides={setGuides} mobile={p.mobile} onMore={() => p.onMore(o.id)} sheetOpen={p.sheetOpen} />
          ))}
          {draft && <Draft d={draft} zoom={zoom} tool={p.tool} style={p.style} />}
          {guides.v.map((x) => <div key={'v' + x} className="guide v" style={{ left: x * zoom }} />)}
          {guides.h.map((y) => <div key={'h' + y} className="guide h" style={{ top: y * zoom }} />)}
          {p.reading?.band && <div className="ocr-band" style={{ top: p.reading.band.y0 * zoom, height: (p.reading.band.y1 - p.reading.band.y0) * zoom }} />}
          {p.reading?.at && (
            <div className="ocr-tap" style={{ left: p.reading.at.x * zoom, top: p.reading.at.y * zoom }} role="status">
              <span className="spinner" />Reading text…
            </div>
          )}
        </div>
      </div>
      {p.reading?.page && !p.reading.at && (
        <div className="ocr-page" role="status"><span className="spinner" />Reading this page</div>
      )}
      <div className="pageNum">{p.index + 1}</div>
    </div>
  );
}

/** the filled head of an arrow ending at (x1, y1), in page units */
export function arrowHead(x0: number, y0: number, x1: number, y1: number, sw: number): [number, number][] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const L = Math.min(len * 0.45, Math.max(8, sw * 4.5)), W = L * 0.55;
  const bx = x1 - ux * L, by = y1 - uy * L;
  return [[x1 + ux * sw * 0.5, y1 + uy * sw * 0.5], [bx - uy * W, by + ux * W], [bx + uy * W, by - ux * W]];
}

function Draft({ d, zoom, tool, style }: { d: { x0: number; y0: number; x1: number; y1: number; pts?: number[] }; zoom: number; tool: Tool; style: ToolStyle }) {
  if (d.pts) {
    return (
      <svg className="draftline" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <polyline points={d.pts.map((v) => v * zoom).join(' ')} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth * zoom} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tool === 'line' || tool === 'arrow') {
    return (
      <svg className="draftline" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <line x1={d.x0 * zoom} y1={d.y0 * zoom} x2={d.x1 * zoom} y2={d.y1 * zoom} stroke={style.stroke} strokeWidth={style.strokeWidth * zoom} strokeLinecap="round" />
        {tool === 'arrow' && <polygon points={arrowHead(d.x0, d.y0, d.x1, d.y1, style.strokeWidth).map(([x, y]) => `${x * zoom},${y * zoom}`).join(' ')} fill={style.stroke} />}
      </svg>
    );
  }
  const x = Math.min(d.x0, d.x1) * zoom, y = Math.min(d.y0, d.y1) * zoom;
  const w = Math.abs(d.x1 - d.x0) * zoom, h = Math.abs(d.y1 - d.y0) * zoom;
  const bg = tool === 'whiteout' ? '#fff' : tool === 'redact' ? '#111' : tool === 'highlight' ? style.highlight + '66' : tool === 'underline' || tool === 'strike' ? style.ink + '22' : tool === 'link' ? 'rgba(37,99,235,.08)' : 'transparent';
  return <div className={`draft${tool === 'link' ? ' link' : ''}`} style={{ left: x, top: y, width: w, height: h, background: bg, borderRadius: tool === 'ellipse' ? '50%' : 0 }} />;
}

// ---------------- existing text runs ----------------

/** How far above / below its baseline each run can be covered without touching the neighbouring lines. */
export function lineRooms(runs: TextRun[]): Record<string, { up: number; down: number }> {
  const out: Record<string, { up: number; down: number }> = {};
  for (const r of runs) {
    const h = r.region.height;
    let up = h * 0.94, down = h * 0.3;
    const [ux, uy] = r.region.u;
    for (const o of runs) {
      if (o === r || Math.abs(o.region.u[0] - ux) > 0.01 || Math.abs(o.region.u[1] - uy) > 0.01) continue;
      const dx = o.region.o[0] - r.region.o[0], dy = o.region.o[1] - r.region.o[1];
      const t = dx * ux + dy * uy;
      const sOff = -dx * uy + dy * ux;
      if (t > r.region.width || t + o.region.width < 0) continue; // no horizontal overlap
      const oh = o.region.height;
      if (sOff > h * 0.3) up = Math.min(up, sOff - oh * 0.24);
      else if (sOff < -h * 0.3) down = Math.min(down, -sOff - oh * 0.76);
    }
    out[r.key] = { up: Math.max(up, h * 0.72), down: Math.max(down, h * 0.12) };
  }
  return out;
}

type PageRef = { canvas: React.RefObject<HTMLCanvasElement | null>; w: number; paints: number };

/**
 * Cover over the original letters of an edited line, placed in the line's own frame (x, y from the
 * start of the line's box, page units): the page itself with only the old letters filled in from the
 * background around them, so patterns, tints and two background colours meeting under the line stay
 * as they are (see coverPixels). Table borders and other rules that cross it stay visible.
 */
function Cover({ page, b, bg, fg, zoom, x, y, w, h }: { page: PageRef; b: ReturnType<typeof runBox>; bg: string; fg: string; zoom: number; x: number; y: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current, pc = page.canvas.current;
    if (!c || !pc || !pc.width || Math.abs(b.angle) > 0.02) { if (c) c.width = c.height = 0; return; }
    const k = pc.width / page.w;
    const m = Math.max(2, Math.round(k * 1.5));
    const x0 = Math.round((b.x + x) * k) - m, y0 = Math.round((b.top + y) * k) - m;
    const W = Math.round(w * k) + 2 * m, H = Math.round(h * k) + 2 * m;
    if (W <= 2 * m || H <= 2 * m || W * H > 4e6) { c.width = c.height = 0; return; }
    try {
      const sx = Math.max(0, x0), sy = Math.max(0, y0);
      const src = document.createElement('canvas');
      src.width = W; src.height = H;
      const sc = src.getContext('2d', { willReadFrequently: true })!;
      sc.fillStyle = bg; sc.fillRect(0, 0, W, H);
      sc.drawImage(pc, sx, sy, Math.min(pc.width, x0 + W) - sx, Math.min(pc.height, y0 + H) - sy, sx - x0, sy - y0, Math.min(pc.width, x0 + W) - sx, Math.min(pc.height, y0 + H) - sy);
      const img = coverPixels(sc.getImageData(0, 0, W, H).data, W, H, m, bg, b.h * k, fg);
      c.width = img.width; c.height = img.height;
      c.getContext('2d')!.putImageData(img, 0, 0);
    } catch { c.width = c.height = 0; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.paints, bg, fg, x, y, w, h, b.x, b.top, b.h, b.angle]);
  // until drawn (or for a turned line) the canvas is see-through and its background covers
  return <canvas ref={ref} className="cover" style={{ background: bg, left: x * zoom, top: y * zoom, width: w * zoom, height: h * zoom, right: 'auto', bottom: 'auto' }} />;
}

function RunView({ run, vm, zoom, font, color, edit, shown, editing, selected, moving, room, live, clone, page, local, onStart, onCommit, onMove, onNext }: {
  page: PageRef; live?: boolean; selected: boolean; onNext: () => void; clone?: { url: string; img: ClonedText };
  run: TextRun; vm: M; zoom: number; font?: FontInfo; color?: { bg: string; fg: string }; edit?: RunEdit;
  /** the edit of this line as the page picture already shows it (null: the original line) */
  shown?: RunEdit | null;
  room?: { up: number; down: number };
  editing: boolean; onStart: () => void; onCommit: (text: string, scales?: number[], looks?: FieldContent['looks']) => void;
  /** being moved: dragging it moves the line (viewport units, from its original place) */
  moving?: boolean; onMove?: (dx: number, dy: number) => void;
  local: (e: { clientX: number; clientY: number }) => { x: number; y: number };
}) {
  const b = runBox(run, vm);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(edit?.text ?? run.str);
  const scalesRef = useRef<number[] | undefined>(edit?.scales);
  const looksRef = useRef<FieldContent['looks'] | undefined>(edit?.looks);
  const [selVer, setSelVer] = useState(0);
  useEffect(() => { if (editing) { setValue(edit?.text ?? run.str); scalesRef.current = edit?.scales; looksRef.current = edit?.looks; } }, [editing]); // eslint-disable-line
  // distance along the line (page units) where the user tapped; the caret goes there
  const tapAt = useRef<number | null>(null);
  const begin = (e: React.MouseEvent) => {
    if (moving) return;
    const pt = local(e);
    tapAt.current = (pt.x - b.x - (edit?.dx ?? 0)) * Math.cos(b.angle) + (pt.y - b.y - (edit?.dy ?? 0)) * Math.sin(b.angle);
    onStart();
  };

  const scale = edit?.sizeScale ?? 1;
  const size = b.h * scale * zoom;
  // in tightly set text the box keeps to the line's own room, so it does not cover the lines around it
  const lineH = Math.max(size * 1.02, Math.min(size * 1.2, room ? (room.up + room.down) * scale * zoom : size * 1.2));
  const fg = edit?.color ?? color?.fg ?? '#000';
  const bg = color?.bg ?? '#fff';
  // Best: the embedded font re-registered with a Unicode cmap (exact glyphs while typing).
  // Otherwise the pdf.js font when its codes are plain Unicode, else a similar system font.
  const identity = font ? Object.entries(font.display).every(([k, v]) => k === v) : false;
  // Arabic or Persian typed in: the shipped Arabic font (as in the saved file), lines that read right to
  // left keep the original line's right end
  const arText = hasArabic(editing ? value : edit?.text ?? '');
  const rtl = arText && isRtl(editing ? value : edit?.text ?? '');
  if (arText) arabicFace();
  const fontCss = arText ? `${ARABIC_CSS}, ${font?.cssFallback ?? 'sans-serif'}` : font?.editFamily
    ? `"${font.editFamily}", ${font.cssFallback}`
    : font && identity ? `"${font.loadedName}", ${font.cssFallback}` : font?.cssFallback ?? 'Arial, sans-serif';
  const mapped = !arText && !!font && !font.editFamily && !identity;
  // put the baseline of the first line exactly on the original baseline
  const lineTop = b.asc * zoom - baselineInLine(fontCss, size, lineH);

  // ----- editing -----
  useEffect(() => {
    const el = fieldRef.current;
    if (!editing || !el) return;
    // plain text only (no bold or pasted formatting); older browsers get a rich field that is kept plain
    try { el.contentEditable = 'plaintext-only'; } catch { /* unsupported */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    fillField(el, edit?.text ?? run.str, edit?.scales, edit?.looks);
    // never let the browser scroll the page to the end of the line
    el.focus({ preventScroll: true });
    const text = edit?.text ?? run.str;
    const at = caretIndex(text, tapAt.current, fontCss, b.h * (edit?.sizeScale ?? 1), !edit ? b.w : null);
    setFieldSelection(el, at);
    tapAt.current = null;
  }, [editing]); // eslint-disable-line
  // the letters last selected in the field (kept when a button takes the focus for a moment)
  const lastSel = useRef<[number, number] | null>(null);
  useEffect(() => {
    if (!editing) return;
    const onSel = () => {
      const el = fieldRef.current;
      if (!el || document.activeElement !== el) return;
      const s = fieldSelection(el);
      if (s) { lastSel.current = s; lineEditorChanged(); }
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [editing]);
  const baseSize = b.h * scale;
  useEffect(() => {
    if (!editing) return;
    const api = fieldEditor({
      key: run.key, el: () => fieldRef.current, sel: () => lastSel.current, baseSize, base: {}, mode: 'faux',
      after: (c) => { scalesRef.current = c.scales; looksRef.current = c.looks; setValue(c.text); setSelVer((v) => v + 1); },
    });
    setLineEditor(api);
    return () => { if (lineEditor() === api) setLineEditor(null); };
  }, [editing, baseSize, run.key]);
  const latest = useRef({ value, onCommit, committed: false, cancel: false });
  latest.current.value = value;
  latest.current.onCommit = onCommit;
  useEffect(() => {
    if (!editing) return;
    latest.current.committed = false;
    latest.current.cancel = false;
    return () => { if (!latest.current.committed) { latest.current.committed = true; latest.current.onCommit(latest.current.value, scalesRef.current, looksRef.current); } };
  }, [editing]);
  const original = edit?.text ?? run.str;
  const commitOnce = () => {
    if (latest.current.committed) return;
    latest.current.committed = true;
    if (latest.current.cancel) onCommit(original, edit?.scales, edit?.looks);
    else onCommit(value, scalesRef.current, looksRef.current);
  };
  const readBack = () => {
    const el = fieldRef.current;
    if (!el) return;
    const { text, scales, looks } = readField(el);
    scalesRef.current = scales;
    looksRef.current = looks;
    setValue(text);
  };
  /** put plain text in at the caret (newlines, pasted text) */
  const insertPlain = (t: string) => {
    const el = fieldRef.current;
    if (!el) return;
    const s = fieldSelection(el) ?? lastSel.current;
    if (!s) return;
    const { text, scales, looks } = readField(el);
    const cps = [...text];
    const k = scales[Math.max(0, s[0] - 1)] ?? 1, lk = looks[Math.max(0, s[0] - 1)] ?? null;
    const add = [...t.replace(/\r\n?/g, '\n')];
    cps.splice(s[0], s[1] - s[0], ...add);
    scales.splice(s[0], s[1] - s[0], ...add.map(() => k));
    looks.splice(s[0], s[1] - s[0], ...add.map(() => lk));
    fillField(el, cps.join(''), scales, looks);
    setFieldSelection(el, s[0] + add.length);
    readBack();
  };

  /** Ctrl+B / I / U in the field: the selected letters, else the whole line */
  const toggleKey = (k: 'b' | 'i' | 'u') => {
    const ed = lineEditor();
    if (!ed || ed.key !== run.key) return;
    const cur = ed.selLook();
    if (cur) ed.setSelLook({ [k]: !cur[k] });
    else {
      const all = fieldRef.current ? readField(fieldRef.current) : null;
      if (!all) return;
      const shared = all.looks.every((l, i) => [...all.text][i] === '\n' || !!l?.[k]);
      ed.setSelLook({ [k]: !shared }, true);
    }
  };

  // ----- where the line is drawn -----
  // the line's move (a drag in progress, else the saved one)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dx = drag?.dx ?? edit?.dx ?? 0, dy = drag?.dy ?? edit?.dy ?? 0;
  const moved = dx !== 0 || dy !== 0;
  // in the line's own (possibly turned) frame
  const ca = Math.cos(b.angle), sa = Math.sin(b.angle);
  const ldx = dx * ca + dy * sa, ldy = -dx * sa + dy * ca;
  // Edited text can be longer (or have more lines) than the original line: the tap target grows with
  // it, measured against the original line so it follows the real font's widths.
  const extent = (t: string, ks?: number[]) => {
    const ls = t.split('\n');
    const base = textWidth(run.str, fontCss) || 1;
    let i = 0, widest = 0, tall = 0;
    for (const l of ls) {
      let w = 0, k1 = 1;
      for (const ch of l) { const k = ks?.[i++] ?? 1; w += textWidth(ch, fontCss) * k; k1 = Math.max(k1, k); }
      i++; // the newline
      widest = Math.max(widest, w);
      tall += k1;
    }
    return { w: Math.max(b.w, (b.w * widest * scale) / base), lines: ls.length, tall };
  };
  const shownText = edit && !editing ? edit.text : null;
  const grown = useMemo(() => (shownText === null || (shownText === run.str && !edit?.scales) ? null : extent(shownText, edit?.scales)),
    [shownText, edit?.scales, run.str, fontCss, b.w, scale]); // eslint-disable-line react-hooks/exhaustive-deps
  const style: React.CSSProperties = {
    left: b.x * zoom, top: b.top * zoom, width: (grown?.w ?? b.w) * zoom,
    height: (b.height + (grown && grown.tall > 1 ? (grown.tall - 1) * b.h * scale * 1.2 : 0)) * zoom,
    transform: b.angle ? `rotate(${b.angle}rad)` : undefined,
    transformOrigin: `0 ${b.asc * zoom}px`,
  };
  // the cover goes where the page picture shows the line now (its earlier move and length included)
  const sh = shown ?? null;
  const shownBox = useMemo(() => (sh ? extent(sh.text, sh.scales) : null), [sh, fontCss, b.w]); // eslint-disable-line react-hooks/exhaustive-deps
  const cdx = sh?.dx ?? 0, cdy = sh?.dy ?? 0;
  const cl = cdx * ca + cdy * sa, ct = -cdx * sa + cdy * ca;
  const coverW = Math.max(b.w, shownBox?.w ?? b.w), coverTall = Math.max(1, shownBox?.tall ?? 1) * (sh?.sizeScale ?? 1);

  // dragging the line while it is being moved
  const dragFrom = useRef<{ x: number; y: number; dx: number; dy: number; id: number } | null>(null);
  const moveBox = moving ? (
    <div className="movebox" title="Drag to move the line"
      style={{ left: ldx * zoom - 6, top: ldy * zoom - 6, width: (grown?.w ?? b.w) * zoom + 12, height: style.height as number + 12 }}
      onPointerDown={(e) => {
        e.stopPropagation(); e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const pt = local(e);
        dragFrom.current = { x: pt.x, y: pt.y, dx: edit?.dx ?? 0, dy: edit?.dy ?? 0, id: e.pointerId };
        setDrag({ dx: edit?.dx ?? 0, dy: edit?.dy ?? 0 });
      }}
      onPointerMove={(e) => {
        const d = dragFrom.current;
        if (!d || d.id !== e.pointerId) return;
        const pt = local(e);
        setDrag({ dx: d.dx + pt.x - d.x, dy: d.dy + pt.y - d.y });
      }}
      onPointerUp={(e) => {
        const d = dragFrom.current;
        if (!d || d.id !== e.pointerId) return;
        dragFrom.current = null;
        const pt = local(e);
        const ndx = d.dx + pt.x - d.x, ndy = d.dy + pt.y - d.y;
        setDrag(null);
        if (Math.abs(ndx - d.dx) > 0.01 || Math.abs(ndy - d.dy) > 0.01) onMove?.(ndx, ndy);
      }}
      onPointerCancel={() => { dragFrom.current = null; setDrag(null); }}
      onClick={(e) => e.stopPropagation()}>
      <span className="grip"><Icon name="move" size={14} /></span>
    </div>
  ) : null;

  // a scan line: the new letters (made of the page's own) over the old ones, as it will be saved
  if (clone && edit && !editing) {
    const c = clone.img, h = b.h;
    const pad = h * 0.15;
    const down = Math.max(Math.min(h * 0.42, room?.down ?? h * 0.42), c.inkDown !== undefined ? Math.min(h * 0.75, (c.inkDown + 0.06) * h) : 0);
    const up = Math.max(Math.min(h * 1.05, room?.up ?? h * 1.05), c.inkUp !== undefined ? Math.min(h * 1.4, (c.inkUp + 0.06) * h) : 0);
    const l = Math.min(0, c.inkX0 * h) - pad, r = Math.max(b.w, c.inkX1 * h) + pad, cdy2 = c.dy * h;
    const z = zoom, oy = b.asc; // children are placed from the baseline start
    return (
      <div className={`run changed cloned${selected ? ' selected' : ''}${moving ? ' moving' : ''}`} data-key={run.key}
        style={{ ...style, width: Math.max(b.w, c.w - c.left) * z, pointerEvents: moved ? 'none' : undefined }}
        title="Click to edit text" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); begin(e); }}>
        <Cover page={page} b={b} bg={bg} fg={color?.fg ?? '#000'} zoom={z} x={l} y={oy + cdy2 - up} w={r - l} h={up + down} />
        <img className="clone" src={clone.url} alt="" draggable={false}
          style={{ left: (ldx - c.left) * z, top: (ldy + oy + c.below - c.h) * z, width: c.w * z, height: c.h * z, pointerEvents: 'auto' }} />
        {moveBox}
      </div>
    );
  }
  if ((!edit || live) && !editing && !drag) {
    return (
      <div className={`run${selected ? ' selected' : ''}${edit ? ' changed' : ''}${moving ? ' moving' : ''}`} data-key={run.key}
        style={{ ...style, left: (b.x + dx) * zoom, top: (b.top + dy) * zoom }}
        title="Click to edit text" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); begin(e); }}>
        {moving && moveBox && React.cloneElement(moveBox, { style: { ...moveBox.props.style, left: -6, top: -6 } })}
      </div>
    );
  }
  const text = editing ? value : edit?.text ?? run.str;
  const ks = editing ? undefined : edit?.scales;
  const lks = editing ? undefined : edit?.looks;
  const lines = text.split('\n');
  // letters the embedded font lacks fall back to a system font: give them the line's weight and slant,
  // without faking bold on the embedded font itself
  const textStyle: React.CSSProperties = {
    fontSize: size, lineHeight: `${lineH}px`, color: fg, fontFamily: fontCss, top: lineTop + ldy * zoom, left: ldx * zoom,
    fontWeight: font?.fallback.bold ? 700 : 400, fontStyle: font?.fallback.italic && !arText ? 'italic' : 'normal', fontSynthesis: 'none',
    ...(rtl ? { left: 'auto', right: ((grown?.w ?? b.w) - b.w - ldx) * zoom, direction: 'rtl', textAlign: 'right' } as React.CSSProperties : {}),
  };
  void selVer;
  let ci = 0;
  return (
    <div className={`run edited${editing ? ' editing' : ''}${selected ? ' selected' : ''}${moving ? ' moving' : ''}`} data-key={run.key}
      style={{ ...style, pointerEvents: moved && !editing ? 'none' : undefined }}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (!editing) begin(e); }}>
      {/* hide the original glyphs completely (accents, descenders) but stay clear of the lines around it;
          only where the line is drawn now: longer text runs on over the page, as it will be saved */}
      <Cover page={page} b={b} bg={bg} fg={color?.fg ?? '#000'} zoom={zoom}
        x={cl - Math.max(2 / zoom, b.h * 0.06)} w={coverW + 2 * Math.max(2 / zoom, b.h * 0.06)}
        y={ct + b.asc - (room?.up ?? b.h * 0.94) * (sh?.sizeScale ?? 1) - 1 / zoom}
        h={((room?.up ?? b.h * 0.94) + (room?.down ?? b.h * 0.3)) * (sh?.sizeScale ?? 1) + (coverTall - (sh?.sizeScale ?? 1)) * b.h * 1.2 + 2 / zoom} />
      {editing ? (
        // own keys: the field's letters are put in by hand, so it must never be reused for the shown text
        <div
          key="field"
          ref={fieldRef}
          className="lfield"
          dir="auto"
          role="textbox"
          aria-multiline="true"
          aria-label="Line text"
          spellCheck={false}
          autoCapitalize="off"
          {...{ autoCorrect: 'off' } as any}
          suppressContentEditableWarning
          onInput={readBack}
          onPaste={(e) => { e.preventDefault(); insertPlain(e.clipboardData.getData('text/plain')); }}
          onDrop={(e) => e.preventDefault()}
          onBlur={(e) => { if (!isRefocusing(e.currentTarget) && !editingHeld()) commitOnce(); }}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            e.stopPropagation();
            const mod = e.ctrlKey || e.metaKey;
            if (e.key === 'Escape') { latest.current.cancel = true; el.blur(); }
            else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); insertPlain('\n'); }
            else if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
            else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); el.blur(); setTimeout(onNext, 0); }
            // Ctrl+B / I / U: the selected letters (never the browser's own rich formatting)
            else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); toggleKey(e.key.toLowerCase() as 'b' | 'i' | 'u'); }
          }}
          style={{ ...textStyle, caretColor: fg === bg ? '#000' : fg, minWidth: b.w * zoom + 2 }}
        />
      ) : (
        <div key="txt" className="txt" style={{ ...textStyle, pointerEvents: moved ? 'auto' : undefined }} dir={arText ? 'auto' : undefined}>
          {lines.map((line, li) => {
            // pieces of one size and look each
            const parts: { t: string; k: number; l: string }[] = [];
            for (const ch of line) {
              const l = JSON.stringify(lks?.[ci] ?? null);
              const k = ks?.[ci++] ?? 1;
              const last = parts[parts.length - 1];
              if (last && last.k === k && last.l === l) last.t += ch; else parts.push({ t: ch, k, l });
            }
            ci++; // the newline
            // the first line keeps its baseline (bigger letters reach up); later lines move down as far
            // as their biggest letters need, as in the saved file
            const tallest = Math.max(1, ...parts.map((p) => p.k));
            return (
              <div key={li} style={{ height: lineH * (li ? tallest : 1), paddingTop: li ? (tallest - 1) * lineH : 0 }}>
                {!parts.length ? '​' : parts.map((pt, i) => (
                  <span key={i} style={{ ...(pt.k !== 1 ? { fontSize: `${pt.k}em` } : {}), ...lookCss(JSON.parse(pt.l), {}, 'faux') } as React.CSSProperties}>
                    {mapped
                      ? segments(pt.t, font).map((sg, j) => (
                        <span key={j} style={{ fontFamily: sg.orig ? `"${font!.loadedName}", ${font!.cssFallback}` : font!.cssFallback }}>{sg.text}</span>
                      ))
                      : pt.t}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {moveBox}
    </div>
  );
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of a string at 100px in the given CSS font family. */
function textWidth(text: string, fontCss: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 50;
  measureCtx.font = `100px ${fontCss}`;
  return measureCtx.measureText(text).width;
}
/** Character index closest to a distance along the line (first line only). */
function caretIndex(text: string, t: number | null, fontCss: string, size: number, actualWidth: number | null) {
  const first = text.split('\n')[0];
  if (t === null) return first.length;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return first.length;
  measureCtx.font = `${size}px ${fontCss}`;
  const chars = [...first];
  const total = measureCtx.measureText(first).width || 1;
  // stretch to the real width of the original line, so taps land on the right letter
  const k = actualWidth ? actualWidth / total : 1;
  let best = 0, bestD = Math.abs(t), acc = '';
  let units = 0;
  for (let i = 0; i < chars.length; i++) {
    acc += chars[i];
    const x = measureCtx.measureText(acc).width * k;
    const d = Math.abs(t - x);
    if (d < bestD) { bestD = d; best = acc.length; }
    units = x;
  }
  if (t > units) return acc.length;
  return best;
}

function segments(line: string, font?: FontInfo) {
  const out: { text: string; orig: boolean }[] = [];
  for (const ch of line) {
    const mapped = font?.display[ch];
    const orig = mapped !== undefined || ch === ' ';
    const t = mapped ?? ch;
    const last = out[out.length - 1];
    if (last && last.orig === orig) last.text += t;
    else out.push({ text: t, orig });
  }
  return out;
}

// ---------------- added objects ----------------

/** text with per-letter sizes and looks, as shown in a text box (white-space: pre keeps its new lines) */
function StyledText({ text, scales, looks, base, mode }: { text: string; scales?: number[]; looks?: (CharLook | null)[]; base: CharLook; mode: LookMode }) {
  const cps = [...text];
  if (!cps.length) return <>{' '}</>;
  const parts: { t: string; k: number; l: CharLook | null; key: string }[] = [];
  cps.forEach((ch, i) => {
    const k = scales?.[i] ?? 1, l = looks?.[i] ?? null, key = k + JSON.stringify(l);
    const last = parts[parts.length - 1];
    if (last && last.key === key) last.t += ch; else parts.push({ t: ch, k, l, key });
  });
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} style={{ ...(p.k !== 1 ? { fontSize: `${p.k}em` } : {}), ...lookCss(p.l, base, mode) } as React.CSSProperties}>{p.t}</span>
      ))}
      {text.endsWith('\n') ? ' ' : null}
    </>
  );
}

type Snap = { xs: number[]; cx: number; cy: number };

function ObjectView({ o, zoom, selected, editing, local, rotation, onSelect, onEditing, onChange, onDelete, onDuplicate, onDrag, snap, page, onGuides, mobile, onMore, sheetOpen, pass }: {
  /** the tool in hand works through this object (a text box tapped on a whiteout, a box drawn over a shape) */
  pass?: boolean;
  o: EditorObject; zoom: number; selected: boolean; editing: boolean; rotation: number;
  local: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  onSelect: () => void; onEditing: (v: boolean) => void; onChange: (patch: Partial<EditorObject>, merge: boolean) => void;
  onDelete: () => void; onDuplicate: () => void; onDrag: (d: { x: number; y: number } | null) => void;
  snap: Snap; page: PageInfo; onGuides: (g: { v: number[]; h: number[] }) => void; mobile: boolean; onMore: () => void;
  /** its properties sheet is open (phone): the toolbar would only sit on top of it */
  sheetOpen?: boolean;
}) {
  type Mode = 'move' | 'grip' | 'resize' | 'end' | 'start' | 'rotate' | 'pending';
  const drag = useRef<null | { mode: Mode; sx: number; sy: number; cx: number; cy: number; o: EditorObject; moved: boolean }>(null);
  const [dragging, setDragging] = useState(false);
  const [turning, setTurning] = useState<number | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);

  const isLine = o.type === 'line';
  const bx = isLine ? Math.min(o.x, o.x2) : o.x;
  const by = isLine ? Math.min(o.y, o.y2) : o.y;
  const bw = isLine ? Math.abs(o.x2 - o.x) : o.w;
  const bh = isLine ? Math.abs(o.y2 - o.y) : o.h;

  const start = (mode: 'move' | 'grip' | 'resize' | 'end' | 'start' | 'rotate') => (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.multi) return;
    // the page's tool takes it (marked so the page knows which object it started on)
    if (pass && mode === 'move' && !editing) { (e.nativeEvent as any).peObj = o.id; return; }
    e.stopPropagation();
    const pt = local(e);
    // while typing, a tap places the caret; dragging (> 10px) moves the box
    if (editing && mode === 'move') {
      drag.current = { mode: 'pending', sx: pt.x, sy: pt.y, cx: e.clientX, cy: e.clientY, o, moved: false };
      return;
    }
    drag.current = { mode, sx: pt.x, sy: pt.y, cx: e.clientX, cy: e.clientY, o, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (gesture.multi) { drag.current = null; setDragging(false); onDrag(null); onGuides({ v: [], h: [] }); return; }
    if (d.mode === 'pending') {
      if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 10) return;
      d.mode = 'move';
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      window.getSelection()?.removeAllRanges?.();
    }
    e.preventDefault();
    // touch: start only after 4px so taps never nudge things
    if (!d.moved && Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 4) return;
    if (d.mode !== 'rotate') onDrag({ x: e.clientX, y: e.clientY });
    const pt = local(e);
    let dx = pt.x - d.sx, dy = pt.y - d.sy;
    const first = !d.moved;
    d.moved = true;
    if (first) setDragging(true);
    const s = d.o;
    if (d.mode === 'move' || d.mode === 'grip') {
      if (s.type !== 'line') {
        // snap to the page centre and the text margins within 6px on screen
        const t = 6 / zoom;
        const v: number[] = [], h: number[] = [];
        const nx = s.x + dx, ny = s.y + dy;
        const xc: [number, number][] = [[nx + s.w / 2, snap.cx], ...snap.xs.map((m) => [nx, m] as [number, number]), ...snap.xs.map((m) => [nx + s.w, page.w - m] as [number, number])];
        let best: [number, number] | null = null;
        for (const [a, b] of xc) if (Math.abs(a - b) < t && (!best || Math.abs(a - b) < Math.abs(best[0] - best[1]))) best = [a, b];
        if (best) { dx += best[1] - best[0]; v.push(best[1]); }
        if (Math.abs(ny + s.h / 2 - snap.cy) < t) { dy += snap.cy - (ny + s.h / 2); h.push(snap.cy); }
        onGuides({ v, h });
      }
      const patch: any = { x: s.x + dx, y: s.y + dy };
      if (s.type === 'line') { patch.x2 = s.x2 + dx; patch.y2 = s.y2 + dy; }
      onChange(patch, !first);
    } else if (d.mode === 'end' && s.type === 'line') {
      onChange({ x2: s.x2 + dx, y2: s.y2 + dy } as any, !first);
    } else if (d.mode === 'start' && s.type === 'line') {
      onChange({ x: s.x + dx, y: s.y + dy } as any, !first);
    } else if (d.mode === 'rotate' && s.type !== 'line') {
      // the handle sits above the box: pointing straight up is 0°; snaps to every 15°
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      let a = (Math.atan2(pt.y - cy, pt.x - cx) * 180) / Math.PI + 90;
      const near = Math.round(a / 15) * 15;
      if (Math.abs(a - near) < 4) a = near;
      a = ((Math.round(a * 10) / 10) % 360 + 540) % 360 - 180;
      setTurning(a);
      onChange({ rot: a } as any, !first);
    } else {
      // resize in the box's own (turned) frame, keeping its top-left corner where it is
      const r = ((s.rot ?? 0) * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
      const lx = dx * c + dy * n, ly = -dx * n + dy * c;
      let w = Math.max(8, s.w + lx), h = Math.max(8, s.h + ly);
      const keep = s.type === 'text' || s.type === 'mark' || ((s.type === 'image' || s.type === 'signature') && !e.altKey);
      if (keep) {
        const k = Math.max(w / s.w, 8 / s.h);
        w = s.w * k; h = s.h * k;
      }
      let pos = {};
      if (r) {
        const px = s.x + s.w / 2 + (-s.w / 2) * c - (-s.h / 2) * n, py = s.y + s.h / 2 + (-s.w / 2) * n + (-s.h / 2) * c;
        const ncx = px + (w / 2) * c - (h / 2) * n, ncy = py + (w / 2) * n + (h / 2) * c;
        pos = { x: ncx - w / 2, y: ncy - h / 2 };
      }
      if (s.type === 'text') { onChange({ w, h, ...pos, size: Math.max(4, s.size * (w / s.w)) } as any, !first); return; }
      onChange({ w, h, ...pos }, !first);
    }
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    setTurning(null);
    onDrag(null);
    onGuides({ v: [], h: [] });
    if (d && d.mode === 'move' && !d.moved && o.type === 'text' && selected) onEditing(true);
    if (d && d.moved && (d.mode === 'move' || d.mode === 'grip' || d.mode === 'resize')) settle();
  };
  /**
   * After a move: a box left between two pages goes onto the page that holds its middle (dragged
   * across), and it is kept inside its page (nothing cut off at a page's edge).
   */
  const settle = () => {
    if (o.type === 'line') return;
    const el = objRef.current;
    const outer = el?.closest('.pageOuter') as HTMLElement | null;
    if (!el || !outer) return;
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pages = [...document.querySelectorAll<HTMLElement>('.pageOuter[data-src]')];
    let target = outer, best = Infinity;
    for (const pg of pages) {
      const b = pg.getBoundingClientRect();
      const dist = Math.max(0, b.top - cy, cy - b.bottom) + Math.max(0, b.left - cx, cx - b.right);
      if (dist < best) { best = dist; target = pg; }
    }
    const w = o.w, h = o.h;
    const fit = (x: number, y: number, pw: number, ph: number) => ({
      x: Math.max(0, Math.min(x, pw - w)), y: Math.max(0, Math.min(y, ph - h)),
    });
    if (target !== outer && rotation === 0 && Number(target.dataset.rot || 0) === 0) {
      const b = target.getBoundingClientRect();
      const pos = fit((cx - b.left) / zoom - w / 2, (cy - b.top) / zoom - h / 2, b.width / zoom, b.height / zoom);
      onChange({ page: Number(target.dataset.src), ...pos } as any, true);
      return;
    }
    if (rotation !== 0) return;
    const pos = fit(o.x, o.y, page.w, page.h);
    if (Math.abs(pos.x - o.x) > 0.01 || Math.abs(pos.y - o.y) > 0.01) onChange(pos, true);
  };

  // floating toolbar: fixed to the viewport, kept inside the visible desk
  const barRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ left: number; top: number; ax: number; below: boolean; hidden: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const el = barRef.current, obj = objRef.current;
    const wrap = obj?.closest('.canvasWrap') as HTMLElement | null;
    if (!selected || !el || !obj || !wrap) return;
    const wr = wrap.getBoundingClientRect();
    const r0 = obj.getBoundingClientRect();
    // the turn handle above the box belongs to it too (the toolbar must not cover it)
    const hr = obj.querySelector('.rothandle')?.getBoundingClientRect();
    const r = hr ? { left: Math.min(r0.left, hr.left), right: Math.max(r0.right, hr.right), top: Math.min(r0.top, hr.top), bottom: Math.max(r0.bottom, hr.bottom), width: 0, height: 0 } : r0;
    if (hr) { r.width = r.right - r.left; r.height = r.bottom - r.top; }
    const bw = el.offsetWidth, bh = el.offsetHeight;
    const vw = window.innerWidth;
    const minL = Math.max(4, wr.left + 8), maxL = Math.min(vw - 4, wr.right - 8) - bw;
    let left = r.left + r.width / 2 - bw / 2;
    left = maxL < minL ? Math.max(4, (vw - bw) / 2) : Math.min(maxL, Math.max(minL, left));
    let top = r.top - 12 - bh, below = false;
    if (top < wr.top + 8) { top = r.bottom + 12; below = true; }
    top = Math.min(top, wr.bottom - bh - 8);
    const hidden = r.bottom < wr.top || r.top > wr.bottom || r.right < wr.left || r.left > wr.right;
    const next = { left: Math.round(left), top: Math.round(top), ax: Math.round(r.left + r.width / 2 - left), below, hidden };
    if (!bar || next.left !== bar.left || next.top !== bar.top || next.below !== bar.below || next.hidden !== bar.hidden || next.ax !== bar.ax) setBar(next);
  });
  useEffect(() => {
    if (!selected) { setBar(null); return; }
    const wrap = objRef.current?.closest('.canvasWrap');
    if (!wrap) return;
    let raf = 0;
    const fn = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTick((t) => t + 1)); };
    wrap.addEventListener('scroll', fn, { passive: true });
    window.addEventListener('resize', fn);
    window.visualViewport?.addEventListener('resize', fn);
    const ro = new ResizeObserver(fn);
    ro.observe(wrap);
    return () => { wrap.removeEventListener('scroll', fn); window.removeEventListener('resize', fn); window.visualViewport?.removeEventListener('resize', fn); ro.disconnect(); cancelAnimationFrame(raf); };
  }, [selected]);
  void tick;
  // keep the text caret when pressing the grip / toolbar
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  // auto-size text boxes
  useLayoutEffect(() => {
    if (o.type !== 'text' || !measureRef.current) return;
    const el = measureRef.current;
    const w = el.scrollWidth / zoom + 2;
    const h = el.scrollHeight / zoom;
    if (Math.abs(w - o.w) > 0.5 || Math.abs(h - o.h) > 0.5) onChange({ w, h }, true);
  });
  // ----- typing in a text box: an editable field whose letters can have sizes and looks of their own -----
  const tx = o.type === 'text' ? o : null;
  const tBase: CharLook = tx ? { b: tx.bold, i: tx.italic, u: !!tx.underline, s: !!tx.strike, c: tx.color } : {};
  const tMode: LookMode = tx && (tx.font || arabicText(tx)) ? 'faux' : 'real';
  const baseKey = JSON.stringify([tBase, tMode]);
  const tLast = useRef<[number, number] | null>(null);
  const filledWith = useRef('');
  const tLatest = useRef({ tx, tBase, onChange });
  tLatest.current = { tx, tBase, onChange };
  /** what the field holds, kept in the box (sizes and looks only where they differ) */
  const pushField = (c: FieldContent, merge: boolean) => {
    const { tBase: base, onChange: change } = tLatest.current;
    const el = fieldRef.current;
    if (el) el.toggleAttribute('data-empty', !c.text);
    change({ text: c.text, scales: cleanScales(c.text, c.scales), looks: cleanLooks(c.text, c.looks, base) } as any, merge);
  };
  useEffect(() => {
    const el = fieldRef.current;
    if (!editing || !el || !tx) return;
    try { el.contentEditable = 'plaintext-only'; } catch { /* unsupported */ }
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    fillField(el, tx.text, tx.scales, tx.looks, tBase, tMode);
    filledWith.current = baseKey;
    el.toggleAttribute('data-empty', !tx.text);
    el.focus({ preventScroll: true });
    setFieldSelection(el, [...tx.text].length);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  // a change from outside the field (the box's style, a look given to all letters): shown in it, selection kept
  useEffect(() => {
    const el = fieldRef.current;
    if (!editing || !el || !tx) return;
    const now = readField(el);
    const same = now.text === tx.text && JSON.stringify(cleanScales(now.text, now.scales) ?? null) === JSON.stringify(tx.scales ?? null)
      && sameLooks(cleanLooks(now.text, now.looks, tBase), tx.looks);
    if (same && filledWith.current === baseKey) return;
    const sel = document.activeElement === el ? fieldSelection(el) : tLast.current;
    fillField(el, tx.text, tx.scales, tx.looks, tBase, tMode);
    filledWith.current = baseKey;
    if (sel) setFieldSelection(el, sel[0], sel[1]);
  });
  useEffect(() => {
    if (!editing || !tx) return;
    const onSel = () => {
      const el = fieldRef.current;
      if (!el || document.activeElement !== el) return;
      const s = fieldSelection(el);
      if (s) { tLast.current = s; lineEditorChanged(); }
    };
    document.addEventListener('selectionchange', onSel);
    const api = fieldEditor({
      key: o.id, el: () => fieldRef.current, sel: () => tLast.current, baseSize: tx.size, base: tBase, mode: tMode,
      after: (c) => pushField(c, false),
    });
    setLineEditor(api);
    return () => { document.removeEventListener('selectionchange', onSel); if (lineEditor() === api) setLineEditor(null); };
  }, [editing, baseKey, tx?.size, o.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /** put plain text in at the caret (new lines, pasted text), with the look of the letter before it */
  const tInsert = (t: string) => {
    const el = fieldRef.current;
    if (!el) return;
    const s = fieldSelection(el) ?? tLast.current;
    if (!s) return;
    const c = readField(el);
    const cps = [...c.text];
    const at = Math.max(0, s[0] - 1);
    const add = [...t.replace(/\r\n?/g, '\n')];
    cps.splice(s[0], s[1] - s[0], ...add);
    c.scales.splice(s[0], s[1] - s[0], ...add.map(() => c.scales[at] ?? 1));
    c.looks.splice(s[0], s[1] - s[0], ...add.map(() => c.looks[at] ?? null));
    const next = { text: cps.join(''), scales: c.scales, looks: c.looks };
    fillField(el, next.text, next.scales, next.looks, tBase, tMode);
    setFieldSelection(el, s[0] + add.length);
    pushField(next, true);
  };
  const tToggle = (k: 'b' | 'i' | 'u') => {
    const ed = lineEditor();
    if (!ed || ed.key !== o.id || !tx) return;
    const cur = ed.selLook();
    if (cur) ed.setSelLook({ [k]: !cur[k] });
    else { const all = ed.selLook(true); ed.setSelLook({ [k]: !all?.[k] }, true); }
  };

  const rot = !isLine && o.rot ? o.rot : 0;
  const style: React.CSSProperties = { left: bx * zoom, top: by * zoom, width: Math.max(bw * zoom, 1), height: Math.max(bh * zoom, 1), transform: rot ? `rotate(${rot}deg)` : undefined };
  /** a quarter turn: boxes turn around their centre, lines around their middle */
  const quarter = () => {
    if (o.type === 'line') {
      const mx = (o.x + o.x2) / 2, my = (o.y + o.y2) / 2;
      const t = (x: number, y: number) => [mx - (y - my), my + (x - mx)];
      const [x1, y1] = t(o.x, o.y), [x2, y2] = t(o.x2, o.y2);
      onChange({ x: x1, y: y1, x2, y2 } as any, false);
    } else onChange({ rot: ((((o.rot ?? 0) + 90) % 360) + 540) % 360 - 180 } as any, false);
  };
  let inner: React.ReactNode = null;
  switch (o.type) {
    case 'text': {
      const ts: React.CSSProperties = {
        fontSize: textSize(o) * zoom, color: o.color, fontFamily: objectFontCss(o),
        fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', textAlign: o.align ?? 'left',
        // a document font is drawn as it is (it is already bold / italic when it should be)
        ...(o.font || arabicText(o) ? { fontSynthesis: 'none' } as any : {}),
      };
      inner = (
        <>
          <div ref={measureRef} className="tview" dir="auto" style={{ ...ts, position: 'absolute', inset: 'auto', left: 0, top: 0, visibility: editing ? 'hidden' : 'visible', pointerEvents: 'none' }}>
            <StyledText text={o.text} scales={o.scales} looks={o.looks} base={tBase} mode={tMode} />
          </div>
          {editing && (
            // own key: its letters are put in by hand, React must never fill it
            <div key="tfield" ref={fieldRef} className="tfield" dir="auto" role="textbox" aria-multiline="true" aria-label="Text" data-ph="Type here"
              spellCheck={false} suppressContentEditableWarning style={{ ...ts, touchAction: 'none' }}
              onInput={(e) => pushField(readField(e.currentTarget), true)}
              onPaste={(e) => { e.preventDefault(); tInsert(e.clipboardData.getData('text/plain')); }}
              onDrop={(e) => e.preventDefault()}
              onBlur={(e) => { if (isRefocusing(e.currentTarget) || editingHeld()) return; if (!drag.current || drag.current.mode === 'pending') onEditing(false); }}
              onKeyDown={(e) => {
                e.stopPropagation();
                const mod = e.ctrlKey || e.metaKey;
                if (e.key === 'Escape') (e.currentTarget as HTMLElement).blur();
                else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); tInsert('\n'); }
                else if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); tToggle(e.key.toLowerCase() as 'b' | 'i' | 'u'); }
              }} />
          )}
        </>
      );
      break;
    }
    case 'image':
    case 'signature':
      inner = <img src={o.src} alt="" draggable={false} style={{ opacity: o.opacity ?? 1 }} />;
      break;
    case 'whiteout':
      inner = <div style={{ position: 'absolute', inset: 0, background: o.fill }} />;
      break;
    case 'redact':
      inner = <div className="redbox" />;
      break;
    case 'highlight':
      inner = o.style
        ? <div style={{ position: 'absolute', left: 0, right: 0, top: `${(o.style === 'underline' ? MARK_UNDER : MARK_STRIKE) * 100}%`, height: Math.max(1, markWidth(o.h) * zoom), marginTop: -Math.max(1, markWidth(o.h) * zoom) / 2, background: o.fill, opacity: o.opacity ?? 1 }} />
        : <div style={{ position: 'absolute', inset: 0, background: o.fill, opacity: o.opacity ?? 0.4, mixBlendMode: 'multiply' }} />;
      break;
    case 'link':
      inner = <div className="linkbox" title={o.url || (o.target !== undefined ? 'Link to a page' : 'Link')}><Icon name="link" size={Math.max(10, Math.min(16, o.h * zoom * 0.6))} /></div>;
      break;
    case 'rect':
    case 'ellipse':
      inner = (
        <svg width="100%" height="100%">
          {o.type === 'rect'
            ? <rect x={0} y={0} width={o.w * zoom} height={o.h * zoom} fill={o.fill ?? 'none'} stroke={o.strokeWidth ? o.stroke : 'none'} strokeWidth={o.strokeWidth * zoom} />
            : <ellipse cx={(o.w * zoom) / 2} cy={(o.h * zoom) / 2} rx={(o.w * zoom) / 2} ry={(o.h * zoom) / 2} fill={o.fill ?? 'none'} stroke={o.strokeWidth ? o.stroke : 'none'} strokeWidth={o.strokeWidth * zoom} />}
        </svg>
      );
      break;
    case 'line':
      inner = (
        <svg width="100%" height="100%" overflow="visible">
          <line x1={(o.x - bx) * zoom} y1={(o.y - by) * zoom} x2={(o.x2 - bx) * zoom} y2={(o.y2 - by) * zoom} stroke={o.stroke} strokeWidth={o.strokeWidth * zoom} strokeLinecap="round" />
          {o.arrow && <polygon points={arrowHead(o.x, o.y, o.x2, o.y2, o.strokeWidth).map(([x, y]) => `${(x - bx) * zoom},${(y - by) * zoom}`).join(' ')} fill={o.stroke} />}
        </svg>
      );
      break;
    case 'draw':
      inner = (
        <svg width="100%" height="100%" overflow="visible">
          <polyline points={o.points.map((v) => v * zoom).join(' ')} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth * zoom} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
      break;
    case 'mark': {
      const W = o.w * zoom, H = o.h * zoom, sw = Math.min(W, H) * 0.13;
      inner = (
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
          {o.kind === 'dot' && <circle cx={W / 2} cy={H / 2} r={Math.min(W, H) * 0.32} fill={o.color} />}
          {o.kind === 'check' && <polyline points={`${W * 0.14},${H * 0.54} ${W * 0.4},${H * 0.8} ${W * 0.88},${H * 0.2}`} fill="none" stroke={o.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />}
          {o.kind === 'cross' && <path d={`M${W * 0.2} ${H * 0.2}L${W * 0.8} ${H * 0.8}M${W * 0.8} ${H * 0.2}L${W * 0.2} ${H * 0.8}`} stroke={o.color} strokeWidth={sw} strokeLinecap="round" />}
        </svg>
      );
      break;
    }
  }
  const resizable = o.type !== 'line' && o.type !== 'draw';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const step = (d: number) => {
    if (o.type === 'text') {
      // letters selected while typing: just their size
      const ed = lineEditor(), ss = ed && ed.key === o.id ? ed.selSize() : null;
      if (ss !== null && ed!.setSelSize(Math.min(200, Math.max(2, Math.round(ss) + d)))) return;
      onChange({ size: Math.min(200, Math.max(4, Math.round(o.size) + d)) } as any, false);
    }
    else if (o.type === 'mark') { const w = Math.min(60, Math.max(4, Math.round(o.w) + d)); onChange({ w, h: w, x: o.x - (w - o.w) / 2, y: o.y - (w - o.h) / 2 } as any, false); }
  };
  const sized = o.type === 'text' || o.type === 'mark';
  const toolbar = selected && !sheetOpen && typeof document !== 'undefined' ? createPortal(
    <div ref={barRef} className={`objbar${bar?.below ? ' below' : ''}${dragging ? ' moving' : ''}`} role="toolbar" aria-label="Object actions"
      style={{ left: bar?.left ?? -9999, top: bar?.top ?? -9999, visibility: !bar || bar.hidden ? 'hidden' : 'visible', ['--ax' as any]: `${bar?.ax ?? 0}px` }}
      onPointerDown={stop} onMouseDown={keepFocus} onClick={stop} onDoubleClick={stop}>
      <button type="button" className="grip" aria-label="Move" title="Drag to move"
        onPointerDown={start('grip')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <Icon name="move" size={18} />
      </button>
      <span className="sep" />
      {sized && (
        <>
          <button type="button" aria-label="Smaller" title="Smaller" onClick={() => step(-1)}><Icon name="minus" size={16} /></button>
          <span className="fsize" aria-label="Size">{Math.round(o.type === 'text' ? o.size : o.w)}</span>
          <button type="button" aria-label="Larger" title="Larger" onClick={() => step(1)}><Icon name="plus" size={16} /></button>
          <span className="sep" />
        </>
      )}
      {o.type === 'text' && !editing && (
        <button type="button" aria-label="Edit text" title="Edit text" onClick={() => onEditing(true)}><Icon name="pencil" size={18} /></button>
      )}
      <button type="button" aria-label="Turn 90°" title="Turn 90°" onClick={quarter}><Icon name="arrow-clockwise" size={18} /></button>
      <button type="button" aria-label="Duplicate" title="Duplicate (Ctrl+D)" onClick={onDuplicate}><Icon name="copy" size={18} /></button>
      <button type="button" className="danger" aria-label="Delete" title="Delete" onClick={onDelete}><Icon name="trash" size={18} /></button>
      {mobile && !editing && o.type !== 'whiteout' && o.type !== 'redact' && (
        <><span className="sep" /><button type="button" aria-label="More options" title="More options" onClick={onMore}><Icon name="more" size={18} /></button></>
      )}
    </div>, document.body) : null;
  // thin or small things (a line, an underline, a dot): a bigger area around them takes the tap
  const thin = typeof style.width === 'number' && typeof style.height === 'number' && (style.width < 32 || style.height < 32);
  return (
    <div ref={objRef} data-id={o.id} className={`obj${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${editing ? ' editing' : ''}${thin ? ' thin' : ''}`} style={style}
      onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => o.type === 'text' && onEditing(true)}>
      {inner}
      {toolbar}
      {selected && resizable && !editing && (
        <>
          <i className="dotc" style={{ left: -5, top: -5 }} /><i className="dotc" style={{ right: -5, top: -5 }} /><i className="dotc" style={{ left: -5, bottom: -5 }} />
          <div className="handle" aria-label="Resize" onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon name="resize" size={10} /></div>
        </>
      )}
      {selected && !isLine && !editing && o.type !== 'link' && !(o.type === 'highlight' && o.style) && (
        <div className="rothandle" role="slider" aria-label="Turn" aria-valuenow={Math.round(o.rot ?? 0)} title="Drag to turn"
          onPointerDown={start('rotate')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          <Icon name="arrow-clockwise:bold" size={13} />
          {turning !== null && <span className="rotval">{Math.round(turning)}°</span>}
        </div>
      )}
      {selected && isLine && (
        <>
          <div className="handle" style={{ left: (o.x - bx) * zoom - 9, top: (o.y - by) * zoom - 9, right: 'auto', bottom: 'auto', cursor: 'move' }}
            onPointerDown={start('start')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
          <div className="handle" style={{ left: (o.x2 - bx) * zoom - 9, top: (o.y2 - by) * zoom - 9, right: 'auto', bottom: 'auto', cursor: 'move' }}
            onPointerDown={start('end')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        </>
      )}
    </div>
  );
}

export { applyM };
