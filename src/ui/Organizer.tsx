import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PageState } from '../engine/types';
import { Icon } from './icons';
import { Thumb } from './Thumb';

type Box = { left: number; top: number; width: number; height: number };
interface Drag {
  src: number; pid: number; touch: boolean;
  startX: number; startY: number; x: number; y: number;
  offX: number; offY: number; // where the page was grabbed, inside the card
  active: boolean; timer: number;
}
const EASE = 'cubic-bezier(.2,.8,.2,1)';

/**
 * Pages organizer: drag to reorder, rotate, delete, select several. Replaces the desk while open.
 * Dragging: the page lifts and follows the pointer, a gap shows where it will land, the other pages
 * slide out of the way (FLIP animation) and the list scrolls when the pointer nears an edge.
 * Touch: press and hold a page (or use the grip right away) so ordinary scrolling still works.
 */
export function Organizer({ pdf, pages, onChange, onDone, mobile }: {
  pdf: any; pages: PageState[]; onChange: (p: PageState[]) => void; onDone: () => void; mobile: boolean;
}) {
  const [order, setOrder] = useState<PageState[] | null>(null); // live order while dragging
  const [lift, setLift] = useState<number | null>(null); // page being dragged
  const [settling, setSettling] = useState<number | null>(null); // page flying back into its slot
  const [sel, setSel] = useState<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const cards = useRef(new Map<number, HTMLDivElement>());
  const drag = useRef<Drag | null>(null);
  const before = useRef<Map<number, Box> | null>(null); // positions before a reorder (for FLIP)
  const justDragged = useRef(false);
  const list = order ?? pages;
  const listRef = useRef(list);
  listRef.current = list;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  /** Layout position of a slot, ignoring any animation transform. */
  const slotBox = (src: number): Box | null => {
    const el = slots.current.get(src), grid = gridRef.current;
    if (!el || !grid) return null;
    const g = grid.getBoundingClientRect();
    return { left: g.left + el.offsetLeft, top: g.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight };
  };
  /** Keep the lifted card under the pointer. */
  const follow = () => {
    const d = drag.current;
    if (!d?.active) return;
    const b = slotBox(d.src), card = cards.current.get(d.src);
    if (!b || !card) return;
    card.style.transform = `translate(${d.x - d.offX - b.left}px, ${d.y - d.offY - b.top}px) scale(1.05) rotate(-1.5deg)`;
  };
  /** Move the lifted page to the slot nearest the pointer. */
  const retarget = () => {
    const d = drag.current;
    if (!d?.active) return;
    const cur = listRef.current;
    let best = -1, bestD = Infinity;
    cur.forEach((p, i) => {
      const b = slotBox(p.src);
      if (!b) return;
      const dd = Math.hypot(d.x - (b.left + b.width / 2), d.y - (b.top + b.height / 2));
      if (dd < bestD) { bestD = dd; best = i; }
    });
    const from = cur.findIndex((p) => p.src === d.src);
    if (best < 0 || best === from) return;
    // remember where everything is on screen right now, then reorder
    before.current = snapshot(d.src);
    const next = cur.slice();
    const [it] = next.splice(from, 1);
    next.splice(best, 0, it);
    listRef.current = next;
    setOrder(next);
  };

  const glide = useRef<{ src: number; cx: number; cy: number } | null>(null);
  const snapshot = (skip?: number) => {
    const snap = new Map<number, Box>();
    slots.current.forEach((el, src) => {
      if (src === skip) return;
      const r = el.getBoundingClientRect();
      snap.set(src, { left: r.left, top: r.top, width: r.width, height: r.height });
    });
    return snap;
  };
  // After any reorder: slide the other pages from where they were to their new slots (FLIP),
  // fly a dropped page into its slot, and keep a lifted page under the pointer.
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    const g = glide.current;
    glide.current = null;
    if (prev) {
      slots.current.forEach((el, src) => {
        if (src === drag.current?.src || src === g?.src) return;
        const o = prev.get(src), n = slotBox(src);
        if (!o || !n) return;
        const dx = o.left - n.left, dy = o.top - n.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetWidth;
        el.style.transition = `transform .26s ${EASE}`;
        el.style.transform = '';
      });
    }
    if (g) {
      const card = cards.current.get(g.src), b = slotBox(g.src);
      if (card && b) {
        card.style.transition = 'none';
        card.style.transform = `translate(${g.cx - (b.left + b.width / 2)}px, ${g.cy - (b.top + b.height / 2)}px) scale(1.05) rotate(-1.5deg)`;
        void card.offsetWidth;
        card.style.transition = `transform .24s ${EASE}`;
        card.style.transform = '';
        setTimeout(() => { card.style.transition = ''; }, 260);
      }
    }
    follow();
  }, [order, lift, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = (d: Drag) => {
    d.active = true;
    setOrder(pagesRef.current);
    setLift(d.src);
    try { navigator.vibrate?.(12); } catch { /* not supported */ }
    requestAnimationFrame(follow);
  };

  const finish = (cancel: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.active) return;
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 50);
    const final = listRef.current;
    const card = cards.current.get(d.src);
    if (card) {
      const r = card.getBoundingClientRect();
      glide.current = { src: d.src, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    }
    if (cancel) before.current = snapshot(d.src);
    setLift(null);
    setSettling(d.src);
    setTimeout(() => setSettling((s) => (s === d.src ? null : s)), 260);
    setOrder(null);
    if (!cancel && final.some((p, i) => p !== pagesRef.current[i])) onChange(final);
  };

  // window listeners for the whole drag (the pointer may leave the card)
  useEffect(() => {
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pid) return;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.active) {
        const moved = Math.hypot(d.x - d.startX, d.y - d.startY);
        if (d.touch) { if (moved > 8) { clearTimeout(d.timer); drag.current = null; } } // a scroll, not a drag
        else if (moved > 5) activate(d);
        return;
      }
      e.preventDefault();
      retarget();
      follow();
    };
    const onUp = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pid) finish(false); };
    const onCancel = (e: PointerEvent) => { if (drag.current && e.pointerId === drag.current.pid) finish(!drag.current.active); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current?.active) finish(true); };
    // while dragging on touch, the finger must not scroll the page
    const onTouchMove = (e: TouchEvent) => { if (drag.current?.active && e.cancelable) e.preventDefault(); };
    const onMenu = (e: Event) => { if (drag.current) e.preventDefault(); };
    // scroll when the pointer is near the top or bottom edge
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = drag.current, sc = rootRef.current;
      if (!d?.active || !sc) return;
      const r = sc.getBoundingClientRect();
      const edge = 72;
      let v = 0;
      if (d.y < r.top + edge) v = -Math.min(1, (r.top + edge - d.y) / edge);
      else if (d.y > r.bottom - edge) v = Math.min(1, (d.y - (r.bottom - edge)) / edge);
      if (!v) return;
      const before0 = sc.scrollTop;
      sc.scrollTop += v * 16;
      if (sc.scrollTop !== before0) { retarget(); follow(); }
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('contextmenu', onMenu);
    const root = rootRef.current;
    root?.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('contextmenu', onMenu);
      root?.removeEventListener('touchmove', onTouchMove);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Pointer down on a card (or its grip). Mouse: drag after a small move. Touch: after a short hold. */
  const grab = (src: number, now = false) => (e: React.PointerEvent) => {
    if (e.button !== 0 || drag.current) return;
    if (!now && (e.target as HTMLElement).closest('button:not(.handle)')) return;
    const card = cards.current.get(src);
    if (!card) return;
    const r = card.getBoundingClientRect();
    const touch = e.pointerType !== 'mouse';
    const d: Drag = {
      src, pid: e.pointerId, touch, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      offX: e.clientX - r.left, offY: e.clientY - r.top, active: false, timer: 0,
    };
    drag.current = d;
    if (now) { e.preventDefault(); activate(d); }
    else if (touch) d.timer = window.setTimeout(() => { if (drag.current === d) activate(d); }, 280);
  };

  const rotate = (srcs: number[]) => onChange(pages.map((p) => (srcs.includes(p.src) ? { ...p, rotation: (p.rotation + 90) % 360 } : p)));
  const remove = (srcs: number[]) => {
    const next = pages.filter((p) => !srcs.includes(p.src));
    if (!next.length) return;
    onChange(next);
    setSel(new Set());
  };
  const toggle = (src: number) => {
    if (justDragged.current) return;
    setSel((s) => { const n = new Set(s); if (n.has(src)) n.delete(src); else n.add(src); return n; });
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= pages.length) return;
    before.current = snapshot();
    const next = pages.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className={`org${lift !== null ? ' dragging' : ''}`} ref={rootRef}>
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
        <button className="btn primary lg" onClick={onDone}>Done</button>
      </div>
      <div className="grid" ref={gridRef}>
        {list.map((p, i) => (
          <div key={p.src} className={`oslot${lift === p.src ? ' hole' : ''}${settling === p.src ? ' rise' : ''}`}
            ref={(el) => { if (el) slots.current.set(p.src, el); else slots.current.delete(p.src); }}>
            <div className={`ocard${lift === p.src ? ' lift' : ''}${settling === p.src ? ' settle' : ''}${sel.has(p.src) ? ' on' : ''}`}
              ref={(el) => { if (el) cards.current.set(p.src, el); else cards.current.delete(p.src); }}
              onPointerDown={grab(p.src)}>
              <button className="ck" onClick={() => toggle(p.src)} aria-label={`Select page ${i + 1}`} aria-pressed={sel.has(p.src)}><Icon name="check" size={14} /></button>
              <div className="sq" onClick={() => toggle(p.src)}>
                <Thumb pdf={pdf} src={p.src} rotation={p.rotation} size={240} />
              </div>
              <div className="row">
                <button className="handle" aria-label={`Drag page ${i + 1}`} title="Drag to reorder (or use the arrow keys)"
                  onPointerDown={(e) => { e.stopPropagation(); grab(p.src, true)(e); }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
                  }}>
                  <Icon name="grip" size={18} />
                </button>
                <span className="n">{i + 1}{p.src !== i && !mobile ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> · was {p.src + 1}</span> : null}</span>
                <button className="ibtn" title="Rotate" aria-label={`Rotate page ${i + 1}`} onClick={() => rotate([p.src])}><Icon name="rotate" size={19} /></button>
                <button className="ibtn danger" title="Delete" aria-label={`Delete page ${i + 1}`} disabled={pages.length === 1} onClick={() => remove([p.src])}><Icon name="trash" size={19} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
