import React from 'react';
import type { EditorObject, FontFamily } from '../engine/types';
import type { FontInfo, TextRun } from '../engine/pdfText';
import type { RunEdit, Tool, ToolStyle } from './store';
import { Icon } from './icons';

export const COLORS = ['#000000', '#1e2559', '#1d3fb8', '#c93434', '#157a52', '#d9730d', '#ffffff'];
export const HIGHLIGHTS = ['#ffe14d', '#8fe39a', '#ffadc4', '#94ccff'];

function Swatches({ value, onPick, list = COLORS, allowNone }: { value: string | null; onPick: (c: string | null) => void; list?: string[]; allowNone?: boolean }) {
  return (
    <div className="swatches">
      {allowNone && <button className={`swatch none${value === null ? ' on' : ''}`} onClick={() => onPick(null)} aria-label="No fill" />}
      {list.map((c) => (
        <button key={c} className={`swatch${value?.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={`Colour ${c}`} />
      ))}
      <label className="swatch" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)', position: 'relative' }} aria-label="Custom colour">
        <input type="color" value={value ?? '#000000'} onChange={(e) => onPick(e.target.value)} style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    </div>
  );
}

const Family = ({ value, onChange }: { value: FontFamily; onChange: (f: FontFamily) => void }) => (
  <div className="seg">
    {(['Helvetica', 'Times', 'Courier'] as FontFamily[]).map((f) => (
      <button key={f} className={value === f ? 'on' : ''} onClick={() => onChange(f)}
        style={{ fontFamily: f === 'Helvetica' ? 'Arial' : f === 'Times' ? '"Times New Roman"' : '"Courier New"' }}>
        {f === 'Helvetica' ? 'Sans' : f === 'Times' ? 'Serif' : 'Mono'}
      </button>
    ))}
  </div>
);

const Num = ({ label, value, onChange, min = 1, max = 400, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) => (
  <label className="f">{label}
    <input type="number" value={Math.round(value * 10) / 10} min={min} max={max} step={step}
      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v))); }} />
  </label>
);

export function RunPanel({ run, font, edit, onEdit, onReset, onClose }: {
  run: TextRun; font?: FontInfo; edit?: RunEdit; onEdit: (e: RunEdit) => void; onReset: () => void; onClose: () => void;
}) {
  const cur: RunEdit = edit ?? { text: run.str, sizeScale: 1, color: null };
  const missing = [...new Set([...cur.text].filter((c) => !/\s/.test(c) && font && font.charMap[c] === undefined))];
  const fbName = font ? (font.fallback.family === 'Times' ? 'Times' : font.fallback.family === 'Courier' ? 'Courier' : 'Helvetica') : 'Helvetica';
  return (
    <aside className="panel" aria-label="Text properties">
      <button className="iconbtn close" onClick={onClose} aria-label="Close panel"><Icon name="close" /></button>
      <div>
        <h3>Existing text</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Font: {font?.name || 'Embedded font'}</div>
      </div>
      {missing.length > 0 && (
        <div className="note warn">
          The embedded font doesn't include {missing.slice(0, 12).join(' ')}{missing.length > 12 ? '…' : ''}. Those characters use {fbName}; everything else keeps the original font.
        </div>
      )}
      <Num label="Size (pt)" value={run.region.height * cur.sizeScale} min={2} max={300}
        onChange={(v) => onEdit({ ...cur, sizeScale: v / run.region.height })} />
      <label className="f">Colour
        <div className="row">
          <button className={`btn ghost small`} style={cur.color === null ? { borderColor: 'var(--ink)' } : undefined} onClick={() => onEdit({ ...cur, color: null })}>Original</button>
        </div>
        <Swatches value={cur.color} onPick={(c) => onEdit({ ...cur, color: c })} />
      </label>
      <div className="row">
        <button className="btn ghost small" onClick={() => onEdit({ ...cur, text: '' })}><Icon name="trash" size={16} /> Delete text</button>
        {edit && <button className="btn ghost small" onClick={onReset}>Restore original</button>}
      </div>
    </aside>
  );
}

export function ObjectPanel({ o, onChange, onDelete, onDuplicate, onClose }: {
  o: EditorObject; onChange: (p: Partial<EditorObject>) => void; onDelete: () => void; onDuplicate: () => void; onClose: () => void;
}) {
  const title: Record<EditorObject['type'], string> = {
    text: 'Text', image: 'Image', signature: 'Signature', rect: 'Rectangle', ellipse: 'Ellipse',
    whiteout: 'Whiteout', highlight: 'Highlight', line: 'Line', draw: 'Drawing',
  };
  const set = (p: any) => onChange(p);
  return (
    <aside className="panel" aria-label={`${title[o.type]} properties`}>
      <button className="iconbtn close" onClick={onClose} aria-label="Close panel"><Icon name="close" /></button>
      <h3>{title[o.type]}</h3>
      {o.type === 'text' && (
        <>
          <Family value={o.family} onChange={(family) => set({ family })} />
          <div className="row">
            <div className="seg">
              <button className={o.bold ? 'on' : ''} onClick={() => set({ bold: !o.bold })} style={{ fontWeight: 700 }} aria-label="Bold">B</button>
              <button className={o.italic ? 'on' : ''} onClick={() => set({ italic: !o.italic })} style={{ fontStyle: 'italic', fontFamily: 'serif' }} aria-label="Italic">I</button>
            </div>
          </div>
          <Num label="Size (pt)" value={o.size} min={4} max={200} onChange={(size) => set({ size })} />
          <label className="f">Colour<Swatches value={o.color} onPick={(color) => set({ color: color ?? '#000000' })} /></label>
        </>
      )}
      {(o.type === 'rect' || o.type === 'ellipse') && (
        <>
          <label className="f">Outline<Swatches value={o.stroke} onPick={(stroke) => set({ stroke: stroke ?? '#000000' })} /></label>
          <label className="f">Fill<Swatches value={o.fill} allowNone onPick={(fill) => set({ fill })} /></label>
          <Num label="Outline width" value={o.strokeWidth} min={0} max={30} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      )}
      {(o.type === 'line' || o.type === 'draw') && (
        <>
          <label className="f">Colour<Swatches value={o.stroke} onPick={(stroke) => set({ stroke: stroke ?? '#000000' })} /></label>
          <Num label="Width" value={o.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} />
        </>
      )}
      {o.type === 'whiteout' && (
        <label className="f">Colour<Swatches value={o.fill} list={['#ffffff', '#f4f4f4', '#000000']} onPick={(fill) => set({ fill: fill ?? '#ffffff' })} /></label>
      )}
      {o.type === 'highlight' && (
        <label className="f">Colour<Swatches value={o.fill} list={HIGHLIGHTS} onPick={(fill) => set({ fill: fill ?? HIGHLIGHTS[0] })} /></label>
      )}
      {(o.type === 'image' || o.type === 'signature') && (
        <label className="f">Opacity
          <input type="range" min={0.1} max={1} step={0.05} value={o.opacity ?? 1} onChange={(e) => set({ opacity: parseFloat(e.target.value) })} />
        </label>
      )}
      <div className="row">
        <button className="btn ghost small" onClick={onDuplicate}><Icon name="copy" size={16} /> Duplicate</button>
        <button className="btn ghost small" onClick={onDelete}><Icon name="trash" size={16} /> Delete</button>
      </div>
    </aside>
  );
}

export function ToolPanel({ tool, style, onChange }: { tool: Tool; style: ToolStyle; onChange: (s: Partial<ToolStyle>) => void }) {
  const names: Partial<Record<Tool, string>> = { text: 'Add text', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', draw: 'Draw', highlight: 'Highlight', whiteout: 'Whiteout' };
  const hint: Partial<Record<Tool, string>> = {
    text: 'Click anywhere on a page to start typing.',
    rect: 'Drag on the page to draw.', ellipse: 'Drag on the page to draw.', line: 'Drag on the page to draw.',
    draw: 'Draw freely on the page.', highlight: 'Drag over the area to highlight.',
    whiteout: 'Drag over anything you want to hide. Click a text line with Edit to change it instead.',
  };
  return (
    <aside className="panel toolprefs" aria-label="Tool settings">
      <div><h3>{names[tool]}</h3><div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{hint[tool]}</div></div>
      {tool === 'text' && (
        <>
          <Family value={style.family} onChange={(family) => onChange({ family })} />
          <Num label="Size (pt)" value={style.fontSize} min={4} max={200} onChange={(fontSize) => onChange({ fontSize })} />
          <label className="f">Colour<Swatches value={style.color} onPick={(color) => onChange({ color: color ?? '#000000' })} /></label>
        </>
      )}
      {(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'draw') && (
        <>
          <label className="f">Colour<Swatches value={style.stroke} onPick={(stroke) => onChange({ stroke: stroke ?? '#000000' })} /></label>
          {(tool === 'rect' || tool === 'ellipse') && <label className="f">Fill<Swatches value={style.fill} allowNone onPick={(fill) => onChange({ fill })} /></label>}
          <Num label="Width" value={style.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => onChange({ strokeWidth })} />
        </>
      )}
      {tool === 'highlight' && <label className="f">Colour<Swatches value={style.highlight} list={HIGHLIGHTS} onPick={(highlight) => onChange({ highlight: highlight ?? HIGHLIGHTS[0] })} /></label>}
    </aside>
  );
}
