import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { fullQuad, isConvex, type Pt, type Quad } from './geom';
import { decode, type ScanPage } from './engine';

const LOUPE = 128, ZOOM = 2.6;

/**
 * Corner editor: drag corners (or the middle of a side) onto the sheet's edges. A magnifier shows
 * what's under the finger.
 */
export function CropEditor({ page, onApply, onCancel }: { page: ScanPage; onApply: (q: Quad) => void; onCancel: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [bmp, setBmp] = useState<ImageBitmap | HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [q, setQ] = useState<Quad>(page.quad);
  const [drag, setDrag] = useState<{ handle: number; at: Pt } | null>(null);
  const start = useRef<{ x: number; y: number; q: Quad } | null>(null);

  useEffect(() => { decode(page.blob).then(setBmp).catch(() => null); }, [page.blob]);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const pad = 28;
  const s = size.w && page.w ? Math.min((size.w - pad * 2) / page.w, (size.h - pad * 2) / page.h) : 0;
  const ox = (size.w - page.w * s) / 2, oy = (size.h - page.h * s) / 2;
  const toScreen = (p: Pt) => ({ x: ox + p.x * s, y: oy + p.y * s });

  // draw the photo
  useEffect(() => {
    const c = canvas.current;
    if (!c || !bmp || !s) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(page.w * s * dpr); c.height = Math.round(page.h * s * dpr);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
  }, [bmp, s, page.w, page.h]);

  // magnifier
  useEffect(() => {
    const c = loupe.current;
    if (!c || !bmp || !drag || !s) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = c.height = LOUPE * dpr;
    const ctx = c.getContext('2d')!;
    const k = (s * ZOOM * dpr); // canvas px per photo px
    const span = c.width / k;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, drag.at.x - span / 2, drag.at.y - span / 2, span, span, 0, 0, c.width, c.height);
    // the outline near the point
    ctx.strokeStyle = '#FFE14D'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    q.forEach((p, i) => { const x = (p.x - drag.at.x) * k + c.width / 2, y = (p.y - drag.at.y) * k + c.height / 2; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.moveTo(c.width / 2, c.height / 2 - 12 * dpr); ctx.lineTo(c.width / 2, c.height / 2 + 12 * dpr);
    ctx.moveTo(c.width / 2 - 12 * dpr, c.height / 2); ctx.lineTo(c.width / 2 + 12 * dpr, c.height / 2); ctx.stroke();
  }, [drag, q, bmp, s]);

  const clamp = (p: Pt): Pt => ({ x: Math.max(-page.w * 0.03, Math.min(page.w * 1.03, p.x)), y: Math.max(-page.h * 0.03, Math.min(page.h * 1.03, p.y)) });
  const down = (handle: number) => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, q };
    setDrag({ handle, at: handle < 4 ? q[handle] : mid(q[handle - 4], q[(handle - 3) % 4]) });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag || !start.current || !s) return;
    const dx = (e.clientX - start.current.x) / s, dy = (e.clientY - start.current.y) / s;
    const q0 = start.current.q;
    const n = [...q0] as Quad;
    if (drag.handle < 4) {
      n[drag.handle] = clamp({ x: q0[drag.handle].x + dx, y: q0[drag.handle].y + dy });
      setDrag({ handle: drag.handle, at: n[drag.handle] });
    } else {
      // a side moves along its normal, keeping its direction
      const a = drag.handle - 4, b = (a + 1) % 4;
      const ex = q0[b].x - q0[a].x, ey = q0[b].y - q0[a].y, len = Math.hypot(ex, ey) || 1;
      const nx = -ey / len, ny = ex / len, d = dx * nx + dy * ny;
      n[a] = clamp({ x: q0[a].x + nx * d, y: q0[a].y + ny * d });
      n[b] = clamp({ x: q0[b].x + nx * d, y: q0[b].y + ny * d });
      setDrag({ handle: drag.handle, at: mid(n[a], n[b]) });
    }
    setQ(n);
  };
  const up = () => { setDrag(null); start.current = null; };

  const ok = isConvex(q);
  const pts = q.map(toScreen);
  const outline = pts.map((p) => `${p.x},${p.y}`).join(' ');
  // magnifier sits in the corner away from the finger
  const dp = drag ? toScreen(drag.at) : null;
  const loupeLeft = dp ? dp.x > size.w / 2 : true;

  return createPortal(
    <div className="scrop" role="dialog" aria-modal="true" aria-label="Adjust the corners">
      <header className="scrop-top">
        <button className="btn lg on-dark" onClick={onCancel}>Cancel</button>
        <div className="t"><b>Adjust the corners</b><span>Drag a corner or a side onto the page’s edge</span></div>
        <button className="btn primary lg" onClick={() => onApply(q)} disabled={!ok}><Icon name="check" size={18} />Done</button>
      </header>
      <div className="scrop-stage" ref={stage} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {s > 0 && <canvas ref={canvas} style={{ position: 'absolute', left: ox, top: oy, width: page.w * s, height: page.h * s }} />}
        {s > 0 && (
          <svg className="scrop-svg" width={size.w} height={size.h}>
            <path d={`M0 0H${size.w}V${size.h}H0Z M${outline.replace(/ /g, ' L')}Z`} fillRule="evenodd" className="shade" />
            <polygon points={outline} className={`edge${ok ? '' : ' bad'}`} />
            {pts.map((p, i) => {
              const nb = pts[(i + 1) % 4];
              return <rect key={'e' + i} x={(p.x + nb.x) / 2 - 14} y={(p.y + nb.y) / 2 - 5} width="28" height="10" rx="5" className="grip"
                transform={`rotate(${(Math.atan2(nb.y - p.y, nb.x - p.x) * 180) / Math.PI} ${(p.x + nb.x) / 2} ${(p.y + nb.y) / 2})`} />;
            })}
            {pts.map((p, i) => <circle key={'c' + i} cx={p.x} cy={p.y} r={drag?.handle === i ? 15 : 12} className={`corner${drag?.handle === i ? ' on' : ''}`} />)}
          </svg>
        )}
        {/* generous invisible touch targets */}
        {s > 0 && pts.map((p, i) => (
          <button key={'hc' + i} className="scrop-hit" style={{ left: p.x - 24, top: p.y - 24 }} onPointerDown={down(i)} aria-label={`Corner ${i + 1}`}
            onKeyDown={(e) => nudge(e, i)} />
        ))}
        {s > 0 && pts.map((p, i) => {
          const nb = pts[(i + 1) % 4];
          return <button key={'he' + i} className="scrop-hit mid" style={{ left: (p.x + nb.x) / 2 - 20, top: (p.y + nb.y) / 2 - 20 }} onPointerDown={down(4 + i)} aria-label={`Side ${i + 1}`} tabIndex={-1} />;
        })}
        {drag && <canvas ref={loupe} className="scrop-loupe" style={{ width: LOUPE, height: LOUPE, [loupeLeft ? 'left' : 'right']: 16 }} />}
        {!ok && <div className="scrop-warn"><Icon name="warning-circle" size={16} />The corners cross. Move them back onto the page’s edges.</div>}
        {!bmp && <div className="scrop-wait"><span className="spinner" /></div>}
      </div>
      <footer className="scrop-bar">
        <button className="scrop-tool" onClick={() => page.auto && setQ(page.auto)} disabled={!page.auto}><Icon name="magic-wand" size={22} /><span>Auto-detect</span></button>
        <button className="scrop-tool" onClick={() => setQ(fullQuad(page.w, page.h))}><Icon name="corners-out" size={22} /><span>Whole photo</span></button>
        <button className="scrop-tool" onClick={() => setQ(page.quad)}><Icon name="restore" size={22} /><span>Reset</span></button>
      </footer>
    </div>,
    document.body,
  );

  function nudge(e: React.KeyboardEvent, i: number) {
    const step = (e.shiftKey ? 10 : 1) / (s || 1);
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    const n = [...q] as Quad;
    n[i] = clamp({ x: q[i].x + v[0], y: q[i].y + v[1] });
    setQ(n);
  }
}

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
