import React, { useState } from 'react';
import type { PageState } from '../engine/types';
import { Icon } from './icons';
import { Thumb } from './Thumb';
import { SortableArea, useSortableItem } from './sortable';

/** Pages organizer: drag to reorder, rotate, delete, select several. Replaces the desk while open. */
export function Organizer({ pdf, pages, onChange, onDone, onAdd, mobile }: {
  pdf: any; pages: PageState[]; onChange: (p: PageState[]) => void; onDone: () => void; mobile: boolean;
  /** add pages after this many pages */
  onAdd: (after: number) => void;
}) {
  const [sel, setSel] = useState<Set<number>>(new Set());

  const rotate = (srcs: number[]) => onChange(pages.map((p) => (srcs.includes(p.src) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  const remove = (srcs: number[]) => {
    const next = pages.filter((p) => !srcs.includes(p.src));
    if (!next.length) return;
    onChange(next);
    setSel(new Set());
  };
  const toggle = (src: number) => setSel((s) => { const n = new Set(s); if (n.has(src)) n.delete(src); else n.add(src); return n; });

  return (
    <div className="org">
      <div className="ohead">
        <div className="t"><h2>Organize pages</h2><p>{mobile ? 'Press and hold a page, then drag it' : 'Drag pages to reorder · changes apply on download'}</p></div>
        {sel.size > 0 && (
          <div className="selbar" role="toolbar" aria-label="Selected pages">
            <span className="num">{sel.size} selected</span>
            <button className="ibtn" onClick={() => rotate([...sel])} aria-label="Rotate selected"><Icon name="rotate" size={19} /></button>
            <button className="ibtn danger" onClick={() => remove([...sel])} disabled={sel.size >= pages.length} aria-label="Delete selected"><Icon name="trash" size={19} /></button>
            <button className="ibtn muted" onClick={() => setSel(new Set())} aria-label="Clear selection"><Icon name="close" size={17} /></button>
          </div>
        )}
        <button className="btn outline lg" onClick={() => {
          // after the last selected page, or at the end
          const last = Math.max(-1, ...pages.map((p, i) => (sel.has(p.src) ? i : -1)));
          onAdd(last >= 0 ? last + 1 : pages.length);
        }}><Icon name="plus:bold" size={17} />Add pages</button>
        <button className="btn primary lg" onClick={onDone}>Done</button>
      </div>
      <SortableArea items={pages} idOf={(p) => String(p.src)} onReorder={onChange} layout="grid"
        overlay={(p) => <div className={`ocard${sel.has(p.src) ? ' on' : ''}`}><CardBody pdf={pdf} p={p} i={pages.indexOf(p)} mobile={mobile} on={sel.has(p.src)} /></div>}>
        <div className="grid">
          {pages.map((p, i) => (
            <PageCard key={p.src} pdf={pdf} p={p} i={i} mobile={mobile} on={sel.has(p.src)} only={pages.length === 1}
              onToggle={() => toggle(p.src)} onRotate={() => rotate([p.src])} onRemove={() => remove([p.src])} />
          ))}
          <div className="oslot">
            <button className="oadd" onClick={() => onAdd(pages.length)}>
              <span className="pl"><Icon name="plus:bold" size={22} /></span>
              <b>Add pages</b><span>Blank, PDF or images</span>
            </button>
          </div>
        </div>
      </SortableArea>
    </div>
  );
}

function PageCard({ pdf, p, i, mobile, on, only, onToggle, onRotate, onRemove }: {
  pdf: any; p: PageState; i: number; mobile: boolean; on: boolean; only: boolean;
  onToggle: () => void; onRotate: () => void; onRemove: () => void;
}) {
  const s = useSortableItem(String(p.src));
  return (
    <div ref={s.ref} style={s.style} className={`oslot${s.dragging ? ' hole' : ''}`}>
      <div className={`ocard${on ? ' on' : ''}`} {...s.pointer}>
        <CardBody pdf={pdf} p={p} i={i} mobile={mobile} on={on} grip={s.grip} only={only}
          onToggle={onToggle} onRotate={onRotate} onRemove={onRemove} />
      </div>
    </div>
  );
}

/** The card's content; also drawn under the finger while dragging. */
function CardBody({ pdf, p, i, mobile, on, grip, only, onToggle, onRotate, onRemove }: {
  pdf: any; p: PageState; i: number; mobile: boolean; on: boolean; grip?: Record<string, any>; only?: boolean;
  onToggle?: () => void; onRotate?: () => void; onRemove?: () => void;
}) {
  const tab = grip ? 0 : -1;
  return (
    <>
      <button className="ck" onClick={onToggle} aria-label={`Select page ${i + 1}`} aria-pressed={on} tabIndex={tab}><Icon name="check" size={14} /></button>
      <div className="sq" onClick={onToggle}>
        <Thumb pdf={pdf} src={p.src} rotation={p.rotation} size={240} />
      </div>
      <div className="row">
        <button className="handle" aria-label={`Move page ${i + 1}`} title="Drag to reorder (or press Space, then the arrow keys)" tabIndex={tab} {...grip}>
          <Icon name="grip" size={18} />
        </button>
        <span className="n">{i + 1}{p.src !== i && !mobile ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · was {p.src + 1}</span> : null}</span>
        <button className="ibtn" title="Rotate" aria-label={`Rotate page ${i + 1}`} tabIndex={tab} onClick={onRotate}><Icon name="rotate" size={19} /></button>
        <button className="ibtn danger" title="Delete" aria-label={`Delete page ${i + 1}`} tabIndex={tab} disabled={only} onClick={onRemove}><Icon name="trash" size={19} /></button>
      </div>
    </>
  );
}
