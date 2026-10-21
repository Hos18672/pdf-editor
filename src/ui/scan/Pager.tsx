import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import type { ScanPage } from './engine';

export interface PagerRender { key: string; url: string; w: number; h: number; quick?: boolean }

/**
 * The scanned pages, one at a time: swipe (or drag) sideways to move between them; swiping past the
 * last page opens the camera for the next one. With `compare`, the page on screen shows the photo as
 * taken on the left of a handle you can drag.
 */
export function Pager({ pages, renders, cur, onCur, onAdd, keyOf, compare, orig, label, onCheck }: {
  pages: ScanPage[]; renders: Record<string, PagerRender>; cur: number;
  onCur: (i: number) => void; onAdd: () => void; keyOf: (p: ScanPage) => string;
  compare: boolean; orig: string | undefined; label: string; onCheck: (id: string) => void;
}) {
  const vp = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [split, setSplit] = useState(0.5);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  const justDragged = useRef(false);
  const n = pages.length;

  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const place = (dx: number, anim: boolean) => {
    const t = track.current;
    if (!t) return;
    t.style.transition = anim ? 'transform .32s var(--ease)' : 'none';
    t.style.transform = `translate3d(${-cur * box.w + dx}px, 0, 0)`;
  };
  useLayoutEffect(() => { place(0, !!box.w); }); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || !box.w) return;
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.on) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) { d.on = true; try { vp.current?.setPointerCapture(e.pointerId); } catch { /* gone */ } }
      else { if (Math.abs(dy) > 14) drag.current = null; return; }
    }
    d.dx = cur === 0 && dx > 0 ? dx * 0.35 : dx; // resists before the first page
    place(d.dx, false);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on) return;
    justDragged.current = true;
    setTimeout(() => { justDragged.current = false; }, 50);
    const th = Math.min(80, box.w * 0.18);
    if (d.dx < -th) {
      if (cur < n - 1) onCur(cur + 1);
      else { // past the last page: a new scan
        const t = track.current;
        if (t) { t.style.transition = 'transform .25s var(--ease)'; t.style.transform = `translate3d(${-n * box.w}px, 0, 0)`; }
        setTimeout(onAdd, 200);
      }
    } else if (d.dx > th && cur > 0) onCur(cur - 1);
    else place(0, true);
  };

  // the page fitted into the view (explicit size, so overlays sit exactly on it)
  const pad = 6;
  const fit = (w: number, h: number) => {
    const s = Math.min((box.w - pad * 2) / w, (box.h - pad * 2) / h);
    return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)) };
  };
  const shapeOf = (p: ScanPage) => {
    const r = renders[p.id];
    if (r) return { w: r.w, h: r.h };
    const ratio = p.rot % 2 ? 1 / p.ratio : p.ratio;
    return ratio >= 1 ? { w: 1000 * ratio, h: 1000 } : { w: 1000, h: 1000 / ratio };
  };

  const splitDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const pic = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const go = (x: number) => { const r = pic.getBoundingClientRect(); setSplit(Math.max(0.02, Math.min(0.98, (x - r.left) / r.width))); };
    go(e.clientX);
    const el = e.currentTarget as HTMLElement;
    const mv = (ev: PointerEvent) => go(ev.clientX);
    const end = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', end); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  };

  const last = pages[n - 1];
  return (
    <div className="sc-pager" ref={vp} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onClickCapture={(e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}>
      <div className="sc-track" ref={track} style={{ width: (n + 1) * box.w }}>
        {box.w > 0 && pages.map((p, i) => {
          const near = Math.abs(i - cur) <= 2;
          const r = renders[p.id];
          const sz = shapeOf(p);
          const on = i === cur;
          const stale = !!r && r.key !== keyOf(p);
          return (
            <div key={p.id} className="sc-slide" style={{ width: box.w }} aria-hidden={!on}>
              <div className="sc-pic" style={fit(sz.w, sz.h)}>
                {near && r ? <img src={r.url} alt={`Page ${i + 1}`} draggable={false} /> : <div className="sc-skel" />}
                {on && compare && orig && (
                  <>
                    <img className="sc-orig" src={orig} alt="" draggable={false} style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }} />
                    <span className="sc-tag l">Original</span><span className="sc-tag r">{label}</span>
                    <div className="sc-split" style={{ left: `${split * 100}%` }} onPointerDown={splitDown} role="slider" aria-label="Compare with the original" aria-valuenow={Math.round(split * 100)}><i /></div>
                  </>
                )}
                {on && compare && !orig && <div className="sc-working sm"><span className="spinner" />Original…</div>}
                {on && (!r || r.quick) && <div className="sc-working"><span className="spinner" />Straightening and cleaning…</div>}
                {on && stale && !r!.quick && <div className="sc-working sm"><span className="spinner" />Applying…</div>}
                {on && !p.sure && r && !r.quick && !compare && (
                  <button className="sc-check" onClick={() => onCheck(p.id)}><Icon name="crop" size={16} />Check the corners</button>
                )}
              </div>
            </div>
          );
        })}
        {box.w > 0 && (
          <div className="sc-slide" style={{ width: box.w }}>
            <button className="sc-addslide" style={last ? fit(shapeOf(last).w, shapeOf(last).h) : undefined} onClick={onAdd} tabIndex={-1}>
              <Icon name="camera-plus" size={30} /><b>Add a page</b><span>Swipe left or tap</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
