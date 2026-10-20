import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorObject, M } from '../engine/types';
import { buildRuns, analyseFont, FontInfo, TextRun } from '../engine/pdfText';
import { runBox, toLocal, sampleColors, applyM } from './geometry';
import type { RunEdit, Tool, ToolStyle } from './store';
import { uid } from './store';
import { registerEditFont, baselineInLine } from './textFonts';
import { gesture } from './gesture';
import { Icon } from './icons';

export interface PageInfo { w: number; h: number; vm: M; }
export interface PageData { runs: TextRun[]; colors: Record<string, { bg: string; fg: string }>; }

const FAMILY_CSS: Record<string, string> = {
  Helvetica: 'Arial, Helvetica, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

interface Props {
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
  onAdd: (o: EditorObject) => void;
  onChange: (id: string, patch: Partial<EditorObject>, merge: boolean) => void;
  onPlace: (src: number, x: number, y: number) => boolean;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onTextPlaced: () => void;
  onVisible: (src: number, ratio: number) => void;
  /** the page as re-written with the current text edits (exact output glyphs) */
  preview?: { pdf: any; key: string };
  /** signature of this page's current text edits ('' = none) */
  editKey: string;
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
        renderTask.current = page.render({ canvasContext: ctx, viewport: vp });
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
      renderedKey.current = sourceKey;
      setShownKey(sourceKey);

      if (!p.data && source === p.pdf) {
        const tc = await page.getTextContent();
        const runs = buildRuns(tc.items, p.src);
        const fonts: Record<string, FontInfo> = {};
        for (const r of runs) {
          if (fonts[r.fontName] || p.fonts[r.fontName]) continue;
          try {
            const f = page.commonObjs.has(r.fontName) ? page.commonObjs.get(r.fontName) : null;
            if (f) {
              const info = analyseFont(f, r.fontName);
              fonts[r.fontName] = info;
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
  const live = p.editKey !== '' && shownKey === p.editKey;

  const local = (e: { clientX: number; clientY: number }) =>
    toLocal(e.clientX, e.clientY, pageRef.current!, info.w, info.h, zoom, rotation);

  // ---- creating shapes / placing things ----
  const dragTools: Tool[] = ['whiteout', 'highlight', 'rect', 'ellipse', 'line', 'draw'];
  const onLayerClick = (e: React.MouseEvent) => {
    // new text boxes are placed on click (tap), so scrolling or a two-finger gesture never adds one
    if (p.tool !== 'text' || gesture.multi) return;
    if ((e.target as HTMLElement).closest('.obj, .run, textarea, .objbar')) return;
    const pt = local(e);
    const id = uid();
    p.onAdd({ id, page: p.src, type: 'text', x: pt.x, y: pt.y - p.style.fontSize * 0.6, w: 20, h: p.style.fontSize * 1.2,
      text: '', family: p.style.family, size: p.style.fontSize, color: p.style.color, bold: false, italic: false });
    p.onSelect(id);
    p.onEditing(id);
    p.onTextPlaced();
  };
  const onLayerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.multi) return;
    if ((e.target as HTMLElement).closest('.obj, .run, textarea, .objbar')) return;
    const pt = local(e);
    if (p.tool === 'text') return;
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
    const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
    let w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    const id = uid();
    const st = p.style;
    if (p.tool === 'draw') {
      const pts = d.pts ?? [];
      if (pts.length < 4) return;
      const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...xs), minY = Math.min(...ys);
      p.onAdd({ id, page: p.src, type: 'draw', x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY,
        stroke: st.stroke, strokeWidth: st.strokeWidth, points: pts.map((v, i) => v - (i % 2 ? minY : minX)) });
      return;
    }
    if (p.tool === 'line') {
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 4) return;
      p.onAdd({ id, page: p.src, type: 'line', x: d.x0, y: d.y0, x2: d.x1, y2: d.y1, w: 0, h: 0, stroke: st.stroke, strokeWidth: st.strokeWidth });
      p.onSelect(id);
      return;
    }
    if (w < 4 || h < 4) {
      if (p.tool !== 'whiteout' && p.tool !== 'highlight') return;
      w = 120; h = 22;
    }
    if (p.tool === 'whiteout') p.onAdd({ id, page: p.src, type: 'whiteout', x, y, w, h, fill: '#ffffff' });
    else if (p.tool === 'highlight') p.onAdd({ id, page: p.src, type: 'highlight', x, y, w, h, fill: st.highlight, opacity: 0.4 });
    else p.onAdd({ id, page: p.src, type: p.tool as 'rect' | 'ellipse', x, y, w, h, stroke: st.stroke, fill: st.fill, strokeWidth: st.strokeWidth });
    p.onSelect(id);
  };

  // existing text stays clickable (= editable) with the Edit and Add-text tools
  const passive = p.tool !== 'edit' && p.tool !== 'text';
  const rooms = useMemo(() => lineRooms(p.data?.runs ?? []), [p.data]);

  return (
    <div ref={outerRef} className="pageOuter" style={{ width: swap ? H : W, height: swap ? W : H }}>
      <div
        ref={pageRef}
        className={`page tool-${p.tool}`}
        style={{ width: W, height: H, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
        onPointerDown={onLayerDown}
        onClick={onLayerClick}
        onPointerMove={onLayerMove}
        onPointerUp={onLayerUp}
        onPointerCancel={() => setDraft(null)}
      >
        <canvas ref={canvasRef} />
        <div className={`layer${passive ? ' passive' : ''}`}>
          {p.data?.runs.map((r) => (
            <RunView key={r.key} run={r} vm={info.vm} zoom={zoom} font={p.fonts[r.fontName]} color={p.data!.colors[r.key]}
              edit={p.edits[r.key]} editing={p.editing === r.key} room={rooms[r.key]} live={live}
              onStart={() => { p.onSelect(r.key); p.onEditing(r.key); }}
              onCommit={(raw) => {
                const text = raw.normalize('NFC');
                const prev = p.edits[r.key];
                const next: RunEdit = { text, sizeScale: prev?.sizeScale ?? 1, color: prev?.color ?? null };
                const unchanged = text === r.str && next.sizeScale === 1 && next.color === null;
                if (unchanged ? prev : !prev || prev.text !== text) p.onRunEdit(r.key, unchanged ? null : next);
                p.onStopEditing(r.key);
              }} />
          ))}
          {p.objects.map((o) => (
            <ObjectView key={o.id} o={o} zoom={zoom} selected={p.selected === o.id} editing={p.editing === o.id}
              local={local} onSelect={() => p.onSelect(o.id)} onEditing={(v) => (v ? p.onEditing(o.id) : p.onStopEditing(o.id))}
              onChange={(patch, merge) => p.onChange(o.id, patch, merge)}
              onDelete={() => p.onDelete(o.id)} onDuplicate={() => p.onDuplicate(o.id)} />
          ))}
          {draft && <Draft d={draft} zoom={zoom} tool={p.tool} style={p.style} />}
        </div>
      </div>
      <div className="pageNum">{p.index + 1}</div>
    </div>
  );
}

function Draft({ d, zoom, tool, style }: { d: { x0: number; y0: number; x1: number; y1: number; pts?: number[] }; zoom: number; tool: Tool; style: ToolStyle }) {
  if (d.pts) {
    return (
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <polyline points={d.pts.map((v) => v * zoom).join(' ')} fill="none" stroke={style.stroke} strokeWidth={style.strokeWidth * zoom} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tool === 'line') {
    return (
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
        <line x1={d.x0 * zoom} y1={d.y0 * zoom} x2={d.x1 * zoom} y2={d.y1 * zoom} stroke={style.stroke} strokeWidth={style.strokeWidth * zoom} strokeLinecap="round" />
      </svg>
    );
  }
  const x = Math.min(d.x0, d.x1) * zoom, y = Math.min(d.y0, d.y1) * zoom;
  const w = Math.abs(d.x1 - d.x0) * zoom, h = Math.abs(d.y1 - d.y0) * zoom;
  const bg = tool === 'whiteout' ? '#fff' : tool === 'highlight' ? style.highlight + '66' : 'transparent';
  return <div className="draft" style={{ left: x, top: y, width: w, height: h, background: bg, borderRadius: tool === 'ellipse' ? '50%' : 0 }} />;
}

// ---------------- existing text runs ----------------

/** How far above / below its baseline each run can be covered without touching the neighbouring lines. */
function lineRooms(runs: TextRun[]): Record<string, { up: number; down: number }> {
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

function RunView({ run, vm, zoom, font, color, edit, editing, room, live, onStart, onCommit }: {
  live?: boolean;
  run: TextRun; vm: M; zoom: number; font?: FontInfo; color?: { bg: string; fg: string }; edit?: RunEdit;
  room?: { up: number; down: number };
  editing: boolean; onStart: () => void; onCommit: (text: string) => void;
}) {
  const b = runBox(run, vm);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(edit?.text ?? run.str);
  useEffect(() => { if (editing) setValue(edit?.text ?? run.str); }, [editing]); // eslint-disable-line
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.width = '0px';
    ta.style.height = '0px';
    ta.style.width = ta.scrollWidth + 4 + 'px';
    ta.style.height = ta.scrollHeight + 'px';
  }, [value, editing]);
  useEffect(() => { if (editing) { taRef.current?.focus(); taRef.current?.select(); } }, [editing]);
  const latest = useRef({ value, onCommit, committed: false });
  latest.current.value = value;
  latest.current.onCommit = onCommit;
  useEffect(() => {
    if (!editing) return;
    latest.current.committed = false;
    return () => { if (!latest.current.committed) { latest.current.committed = true; latest.current.onCommit(latest.current.value); } };
  }, [editing]);
  const commitOnce = () => { if (!latest.current.committed) { latest.current.committed = true; onCommit(value); } };

  const scale = edit?.sizeScale ?? 1;
  const size = b.h * scale * zoom;
  const lineH = size * 1.2;
  const fg = edit?.color ?? color?.fg ?? '#000';
  const bg = color?.bg ?? '#fff';
  // Best: the embedded font re-registered with a Unicode cmap (exact glyphs while typing).
  // Otherwise the pdf.js font when its codes are plain Unicode, else a similar system font.
  const identity = font ? Object.entries(font.display).every(([k, v]) => k === v) : false;
  const fontCss = font?.editFamily
    ? `"${font.editFamily}", ${font.cssFallback}`
    : font && identity ? `"${font.loadedName}", ${font.cssFallback}` : font?.cssFallback ?? 'Arial, sans-serif';
  const mapped = !!font && !font.editFamily && !identity;
  // put the baseline of the first line exactly on the original baseline
  const lineTop = b.asc * zoom - baselineInLine(fontCss, size, lineH);
  const style: React.CSSProperties = {
    left: b.x * zoom, top: b.top * zoom, width: b.w * zoom, height: b.height * zoom,
    transform: b.angle ? `rotate(${b.angle}rad)` : undefined,
    transformOrigin: `0 ${b.asc * zoom}px`,
  };

  if ((!edit || live) && !editing) {
    return <div className="run" style={style} title="Click to edit text" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onStart(); }} />;
  }
  const lines = (editing ? value : edit!.text).split('\n');
  const textStyle: React.CSSProperties = { fontSize: size, lineHeight: `${lineH}px`, color: fg, fontFamily: fontCss, top: lineTop };
  return (
    <div className={`run edited${editing ? ' editing' : ''}`} style={style} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (!editing) onStart(); }}>
      <div className="cover" style={{
        background: bg,
        // hide the original glyphs completely (accents, descenders) but stay clear of the lines around it
        top: (b.asc - (room?.up ?? b.h * 0.94)) * zoom - 1,
        height: ((room?.up ?? b.h * 0.94) + (room?.down ?? b.h * 0.3)) * zoom + 2,
        bottom: 'auto',
        left: -Math.max(2, b.h * 0.06 * zoom), right: -Math.max(2, b.h * 0.06 * zoom),
      }} />
      {editing ? (
        <textarea
          ref={taRef}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commitOnce}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
            e.stopPropagation();
          }}
          style={{ ...textStyle, background: bg, caretColor: fg === bg ? '#000' : fg, minWidth: b.w * zoom + 2 }}
        />
      ) : (
        <div className="txt" style={textStyle}>
          {lines.map((line, li) => (
            <div key={li} style={{ height: lineH }}>
              {mapped
                ? segments(line, font).map((sg, i) => (
                  <span key={i} style={{ fontFamily: sg.orig ? `"${font!.loadedName}", ${font!.cssFallback}` : font!.cssFallback }}>{sg.text}</span>
                ))
                : line || '\u200b'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

function ObjectView({ o, zoom, selected, editing, local, onSelect, onEditing, onChange, onDelete, onDuplicate }: {
  o: EditorObject; zoom: number; selected: boolean; editing: boolean;
  local: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  onSelect: () => void; onEditing: (v: boolean) => void; onChange: (patch: Partial<EditorObject>, merge: boolean) => void;
  onDelete: () => void; onDuplicate: () => void;
}) {
  const drag = useRef<null | { mode: 'move' | 'grip' | 'resize' | 'end'; sx: number; sy: number; o: EditorObject; moved: boolean }>(null);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  const isLine = o.type === 'line';
  const bx = isLine ? Math.min(o.x, o.x2) : o.x;
  const by = isLine ? Math.min(o.y, o.y2) : o.y;
  const bw = isLine ? Math.abs(o.x2 - o.x) : o.w;
  const bh = isLine ? Math.abs(o.y2 - o.y) : o.h;

  const start = (mode: 'move' | 'grip' | 'resize' | 'end') => (e: React.PointerEvent) => {
    if (e.button !== 0 || gesture.multi) return;
    e.stopPropagation();
    // while typing, a press inside the box places the caret; the grip still moves the box
    if (editing && mode === 'move') return;
    const pt = local(e);
    drag.current = { mode, sx: pt.x, sy: pt.y, o, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (gesture.multi) { drag.current = null; setDragging(false); return; }
    const pt = local(e);
    const dx = pt.x - d.sx, dy = pt.y - d.sy;
    if (!d.moved && Math.hypot(dx, dy) * zoom < 3) return;
    const first = !d.moved;
    d.moved = true;
    if (first) setDragging(true);
    const s = d.o;
    if (d.mode === 'move' || d.mode === 'grip') {
      const patch: any = { x: s.x + dx, y: s.y + dy };
      if (s.type === 'line') { patch.x2 = s.x2 + dx; patch.y2 = s.y2 + dy; }
      onChange(patch, !first);
    } else if (d.mode === 'end' && s.type === 'line') {
      onChange({ x2: s.x2 + dx, y2: s.y2 + dy } as any, !first);
    } else {
      let w = Math.max(8, s.w + dx), h = Math.max(8, s.h + dy);
      if (s.type === 'image' || s.type === 'signature' || s.type === 'text') {
        const k = Math.max(w / s.w, 8 / s.h);
        w = s.w * k; h = s.h * k;
        if (s.type === 'text') { onChange({ w, h, size: Math.max(4, s.size * k) } as any, !first); return; }
      }
      onChange({ w, h }, !first);
    }
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d && d.mode === 'move' && !d.moved && o.type === 'text' && selected) onEditing(true);
  };
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
  useEffect(() => { if (editing) taRef.current?.focus(); }, [editing]);

  const style: React.CSSProperties = { left: bx * zoom, top: by * zoom, width: Math.max(bw * zoom, 1), height: Math.max(bh * zoom, 1) };
  let inner: React.ReactNode = null;
  switch (o.type) {
    case 'text': {
      const ts: React.CSSProperties = {
        fontSize: o.size * zoom, color: o.color, fontFamily: FAMILY_CSS[o.family],
        fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal',
      };
      inner = (
        <>
          <div ref={measureRef} className="tview" style={{ ...ts, position: 'absolute', inset: 'auto', left: 0, top: 0, visibility: editing ? 'hidden' : 'visible', pointerEvents: 'none' }}>
            {(o.text || ' ') + (o.text.endsWith('\n') ? ' ' : '')}
          </div>
          {editing && (
            <textarea ref={taRef} value={o.text} spellCheck={false} style={ts} placeholder="Type here"
              onChange={(e) => onChange({ text: e.target.value } as any, true)}
              onBlur={() => onEditing(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); e.stopPropagation(); }}
              onPointerDown={(e) => e.stopPropagation()} />
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
    case 'highlight':
      inner = <div style={{ position: 'absolute', inset: 0, background: o.fill, opacity: o.opacity ?? 0.4, mixBlendMode: 'multiply' }} />;
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
        <svg width="100%" height="100%">
          <line x1={(o.x - bx) * zoom} y1={(o.y - by) * zoom} x2={(o.x2 - bx) * zoom} y2={(o.y2 - by) * zoom} stroke={o.stroke} strokeWidth={o.strokeWidth * zoom} strokeLinecap="round" />
        </svg>
      );
      break;
    case 'draw':
      inner = (
        <svg width="100%" height="100%">
          <polyline points={o.points.map((v) => v * zoom).join(' ')} fill="none" stroke={o.stroke} strokeWidth={o.strokeWidth * zoom} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
      break;
  }
  const resizable = o.type !== 'line' && o.type !== 'draw';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className={`obj${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${editing ? ' editing' : ''}`} style={style}
      onPointerDown={start('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => o.type === 'text' && onEditing(true)}>
      {inner}
      {selected && (
        <div className={`objbar${by * zoom < 56 ? ' below' : ''}${dragging ? ' moving' : ''}`}
          onPointerDown={stop} onMouseDown={keepFocus} onClick={stop} onDoubleClick={stop}>
          <button type="button" className="grip" aria-label="Move" title="Drag to move"
            onPointerDown={start('grip')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
            <Icon name="move" size={18} />
          </button>
          <span className="sep" />
          {o.type === 'text' && !editing && (
            <button type="button" aria-label="Edit text" title="Edit text" onClick={() => onEditing(true)}><Icon name="edit" size={18} /></button>
          )}
          <button type="button" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}><Icon name="copy" size={18} /></button>
          <button type="button" className="danger" aria-label="Delete" title="Delete" onClick={onDelete}><Icon name="trash" size={18} /></button>
        </div>
      )}
      {selected && resizable && !editing && <div className="handle" onPointerDown={start('resize')} onPointerMove={move} onPointerUp={end} />}
      {selected && isLine && (
        <div className="handle" style={{ left: (o.x2 - bx) * zoom - 9, top: (o.y2 - by) * zoom - 9, right: 'auto', bottom: 'auto', cursor: 'move' }}
          onPointerDown={start('end')} onPointerMove={move} onPointerUp={end} />
      )}
    </div>
  );
}

export { applyM };
