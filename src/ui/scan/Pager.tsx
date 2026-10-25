import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import type { ScanPage } from './engine';

export interface PagerRender { key: string; url: string; w: number; h: number; quick?: boolean }

const MAX_Z = 6;
type Z = { k: number; x: number; y: number };
const NOZ: Z = { k: 1, x: 0, y: 0 };

/**
 * The scanned pages, one at a time: swipe (or drag) sideways to move between them; swiping past the
 * last page opens the camera for the next one. With `compare`, the page on screen shows the photo as
 * taken on the left of a handle you can drag.
 */
export function Pager({ pages, renders, cur, onCur, onAdd, keyOf, compare, orig, label, onCheck, sharp, onSharp }: {
  pages: ScanPage[]; renders: Record<string, PagerRender>; cur: number;
  onCur: (i: number) => void; onAdd: () => void; keyOf: (p: ScanPage) => string;
  compare: boolean; orig: string | undefined; label: string; onCheck: (id: string) => void;
  /** the page at the screen's sharpness, or sharper for looking closely (zoomed in) */
  sharp?: Record<string, { key: string; url: string; long: number }>; onSharp?: (id: string, long: number) => void;
}) {
  const vp = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [split, setSplit] = useState(0.5);
  const drag = useRef<{ x: number; y: number; dx: number; on: boolean } | null>(null);
  const justDragged = useRef(false);
  const n = pages.length;
  // zoom on the page on screen: pinch, double tap, the buttons or the mouse wheel
  const [z, setZ] = useState<Z>(NOZ);
  const zRef = useRef(z); zRef.current = z;
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; m0: { x: number; y: number }; z0: Z } | null>(null);
  const pan = useRef<{ x: number; y: number; z0: Z; moved: boolean } | null>(null);
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  // every compare starts with both halves in view: before on the left, the chosen look on the right
  useEffect(() => { setZ(NOZ); setSplit(0.5); }, [cur, compare]);

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

  // the page's size on screen (unzoomed) and the view's centre
  const picSize = () => { const p = pages[cur]; if (!p) return { w: box.w, h: box.h }; const sz = shapeOf(p); const f = fit(sz.w, sz.h); return { w: f.width, h: f.height }; };
  const centre = () => { const r = vp.current!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const clampZ = (q: Z): Z => {
    const k = Math.max(1, Math.min(MAX_Z, q.k));
    if (k <= 1.001) return NOZ;
    const ps = picSize();
    const mx = Math.max(0, (ps.w * k - box.w) / 2 + 24), my = Math.max(0, (ps.h * k - box.h) / 2 + 24);
    return { k, x: Math.max(-mx, Math.min(mx, q.x)), y: Math.max(-my, Math.min(my, q.y)) };
  };
  /** zoom to k keeping the point (screen px) where it is */
  const zoomAt = (k: number, at?: { x: number; y: number }, from: Z = zRef.current) => {
    const c = centre(), p = at ?? c;
    const r = k / from.k;
    setZ(clampZ({ k, x: p.x - c.x - r * (p.x - c.x - from.x), y: p.y - c.y - r * (p.y - c.y - from.y) }));
  };
  const zoomed = z.k > 1.001;
  // the page on screen at the screen's own sharpness (a moment after it's ready), and in full detail when
  // zoomed in: the quick picture is sized for speed, phone screens have far more pixels
  const curR = pages[cur] ? renders[pages[cur].id] : undefined;
  const ready = !!curR && !curR.quick && curR.key === keyOf(pages[cur]);
  useEffect(() => {
    const p = pages[cur];
    if (!p || !ready || !box.w) return;
    if (zoomed) { onSharp?.(p.id, 0); return; }
    const ps = picSize();
    const need = Math.max(ps.w, ps.h) * Math.min(3, window.devicePixelRatio || 1);
    if (need <= Math.max(curR!.w, curR!.h) * 1.1) return;
    const t = setTimeout(() => onSharp?.(p.id, need), 450);
    return () => clearTimeout(t);
  }, [zoomed, cur, ready, curR?.key, box.w, box.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    if (!box.w) return;
    if (e.pointerType !== 'mouse' || e.button === 0) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      // second finger: a pinch, never a swipe
      const [a, b] = [...pts.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: zRef.current };
      if (drag.current?.on) place(0, true);
      drag.current = null; pan.current = null;
      try { vp.current?.setPointerCapture(e.pointerId); } catch { /* gone */ }
      return;
    }
    if (e.button !== 0) return;
    if (zRef.current.k > 1.001) { pan.current = { x: e.clientX, y: e.clientY, z0: zRef.current, moved: false }; return; }
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, on: false };
  };
  const move = (e: React.PointerEvent) => {
    if (pts.current.has(e.pointerId)) pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.max(1, Math.min(MAX_Z, pc.z0.k * Math.hypot(a.x - b.x, a.y - b.y) / pc.d0));
      const c = centre(), r = k / pc.z0.k;
      setZ(clampZ({ k, x: m.x - c.x - r * (pc.m0.x - c.x - pc.z0.x), y: m.y - c.y - r * (pc.m0.y - c.y - pc.z0.y) }));
      return;
    }
    const pn = pan.current;
    if (pn) {
      const dx = e.clientX - pn.x, dy = e.clientY - pn.y;
      if (!pn.moved && Math.hypot(dx, dy) < 6) return;
      if (!pn.moved) { pn.moved = true; try { vp.current?.setPointerCapture(e.pointerId); } catch { /* gone */ } }
      setZ(clampZ({ k: pn.z0.k, x: pn.z0.x + dx, y: pn.z0.y + dy }));
      return;
    }
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
  const up = (e: React.PointerEvent) => {
    const wasPinch = !!pinch.current;
    pts.current.delete(e.pointerId);
    if (pinch.current) {
      if (pts.current.size < 2) pinch.current = null;
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 50);
      // the finger left on the page carries on panning
      const rest = [...pts.current.values()][0];
      if (rest && zRef.current.k > 1.001) pan.current = { x: rest.x, y: rest.y, z0: zRef.current, moved: true };
      return;
    }
    const pn = pan.current;
    pan.current = null;
    if (pn?.moved) { justDragged.current = true; setTimeout(() => { justDragged.current = false; }, 50); return; }
    const d = drag.current;
    drag.current = null;
    if (!wasPinch && e.type === 'pointerup' && !d?.on && (pn || d)) {
      // double tap: zoom in there, or back out
      const now = Date.now(), lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30 && !(e.target as HTMLElement).closest('button, .sc-split')) {
        lastTap.current = null;
        if (zRef.current.k > 1.001) setZ(NOZ); else zoomAt(2.5, { x: e.clientX, y: e.clientY });
        return;
      }
      lastTap.current = { x: e.clientX, y: e.clientY, t: now };
    }
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
    // a tall page (a long receipt) stops above the zoom buttons instead of running under them
    const tall = h > w * 1.6 ? 52 : 0;
    const s = Math.min((box.w - pad * 2) / w, (box.h - pad * 2 - tall) / h);
    return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)), marginBottom: tall };
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
    <div className={`sc-pager${zoomed ? ' zoomed' : ''}`} ref={vp} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onWheel={(e) => { if (!box.w || (!zoomed && e.deltaY > 0)) return; zoomAt(zRef.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), { x: e.clientX, y: e.clientY }); }}
      onClickCapture={(e) => { if (justDragged.current) { e.stopPropagation(); e.preventDefault(); } }}>
      <div className="sc-track" ref={track} style={{ width: (n + 1) * box.w }}>
        {box.w > 0 && pages.map((p, i) => {
          const near = Math.abs(i - cur) <= 2;
          const r = renders[p.id];
          const sz = shapeOf(p);
          const on = i === cur;
          const stale = !!r && r.key !== keyOf(p);
          const hi = near && r && !r.quick && sharp?.[p.id]?.key === r.key ? sharp[p.id].url : null;
          return (
            <div key={p.id} className="sc-slide" style={{ width: box.w }} aria-hidden={!on}>
              <div className="sc-pic" style={{ ...fit(sz.w, sz.h), ...(on && zoomed ? { transform: `translate(${z.x}px, ${z.y}px) scale(${z.k})`, zIndex: 2 } : null) }}>
                {near && r ? <img src={r.url} alt={`Page ${i + 1}`} draggable={false} /> : <div className="sc-skel" />}
                {hi && <img className="sc-sharp" src={hi} alt="" draggable={false} />}
                {on && compare && orig && (
                  <>
                    <img className="sc-orig" src={orig} alt="" draggable={false} style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }} />
                    <span className="sc-tag l">Before</span><span className="sc-tag r">{label}</span>
                    <div className="sc-split" style={{ left: `${split * 100}%` }} onPointerDown={splitDown} role="slider" aria-label="Compare with the original" aria-valuenow={Math.round(split * 100)}><i /></div>
                  </>
                )}
                {on && compare && !orig && <div className="sc-working sm"><span className="spinner" />Loading the photo…</div>}
                {on && (!r || r.quick) && <div className="sc-working"><span className="spinner" />Straightening and cleaning…</div>}
                {on && stale && !r!.quick && <div className="sc-working sm"><span className="spinner" />Applying…</div>}
                {on && !p.sure && r && !r.quick && !compare && !zoomed && (
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
      {n > 0 && cur < n && (
        <div className="sc-zoom" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => zoomAt(zRef.current.k / 1.6)} disabled={!zoomed} aria-label="Zoom out"><Icon name="minus" size={16} /></button>
          <button className="pct" onClick={() => setZ(NOZ)} aria-label={`Zoom ${Math.round(z.k * 100)}%, fit page`}>{Math.round(z.k * 100)}%</button>
          <button onClick={() => zoomAt(zRef.current.k * 1.6)} disabled={z.k >= MAX_Z - 0.01} aria-label="Zoom in"><Icon name="plus" size={16} /></button>
        </div>
      )}
    </div>
  );
}
