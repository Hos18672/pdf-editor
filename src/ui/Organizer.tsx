import React, { useRef, useState } from 'react';
import type { PageState } from '../engine/types';
import { Icon } from './icons';
import { Thumb } from './Thumb';

/** Pages organizer: drag to reorder, rotate, delete, select several. Replaces the desk while open. */
export function Organizer({ pdf, pages, onChange, onDone, mobile }: {
  pdf: any; pages: PageState[]; onChange: (p: PageState[]) => void; onDone: () => void; mobile: boolean;
}) {
  const [order, setOrder] = useState<PageState[] | null>(null); // live order while dragging
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const list = order ?? pages;

  const startDrag = (src: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragSrc(src);
    setOrder(pages);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (dragSrc === null || !order || !gridRef.current) return;
    const cards = [...gridRef.current.querySelectorAll<HTMLElement>('.ocard')];
    let best = -1, bestD = Infinity;
    cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bestD) { bestD = d; best = i; }
    });
    const from = order.findIndex((p) => p.src === dragSrc);
    if (best < 0 || best === from) return;
    const next = order.slice();
    const [it] = next.splice(from, 1);
    next.splice(best, 0, it);
    setOrder(next);
  };
  const endDrag = () => {
    if (order && order.some((p, i) => p !== pages[i])) onChange(order);
    setOrder(null);
    setDragSrc(null);
  };

  const rotate = (srcs: number[]) => onChange(pages.map((p) => (srcs.includes(p.src) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  const remove = (srcs: number[]) => {
    const next = pages.filter((p) => !srcs.includes(p.src));
    if (!next.length) return;
    onChange(next);
    setSel(new Set());
  };
  const toggle = (src: number) => setSel((s) => { const n = new Set(s); if (n.has(src)) n.delete(src); else n.add(src); return n; });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= pages.length) return;
    const next = pages.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="org">
      <div className="ohead">
        <div className="t"><h2>Organize pages</h2><p>{mobile ? 'Hold the dots and drag to reorder' : 'Drag to reorder · changes apply on download'}</p></div>
        {sel.size > 0 && (
          <div className="selbar" role="toolbar" aria-label="Selected pages">
            <span className="num">{sel.size} selected</span>
            <button className="ibtn" onClick={() => rotate([...sel])} aria-label="Rotate selected"><Icon name="rotate" size={19} /></button>
            <button className="ibtn danger" onClick={() => remove([...sel])} disabled={sel.size >= pages.length} aria-label="Delete selected"><Icon name="trash" size={19} /></button>
            <button className="ibtn muted" onClick={() => setSel(new Set())} aria-label="Clear selection"><Icon name="close" size={17} /></button>
          </div>
        )}
        <button className="btn primary lg" onClick={onDone}>Done</button>
      </div>
      <div className="grid" ref={gridRef}>
        {list.map((p, i) => (
          <div key={p.src} className={`ocard${dragSrc === p.src ? ' lift' : ''}${sel.has(p.src) ? ' on' : ''}`}>
            <button className="ck" onClick={() => toggle(p.src)} aria-label={`Select page ${i + 1}`} aria-pressed={sel.has(p.src)}><Icon name="check" size={14} /></button>
            <div className="sq" onClick={() => toggle(p.src)}>
              <Thumb pdf={pdf} src={p.src} rotation={p.rotation} size={240} />
            </div>
            <div className="row">
              <button className="handle" aria-label={`Drag page ${i + 1}`} title="Drag to reorder"
                onPointerDown={startDrag(p.src)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i, -1); if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i, 1); }}>
                <Icon name="grip" size={18} />
              </button>
              <span className="n">{i + 1}{p.src !== i ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · was {p.src + 1}</span> : null}</span>
              <button className="ibtn" title="Rotate" aria-label={`Rotate page ${i + 1}`} onClick={() => rotate([p.src])}><Icon name="rotate" size={19} /></button>
              <button className="ibtn danger" title="Delete" aria-label={`Delete page ${i + 1}`} disabled={pages.length === 1} onClick={() => remove([p.src])}><Icon name="trash" size={19} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
