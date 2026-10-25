import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useBack } from '../back';
import type { Stroke } from './kernels';
import { renderLook, turnStrokes, type ScanPage } from './engine';

/** brush sizes, as a share of the page's longer side */
const SIZES = [{ id: 's', r: 0.012, label: 'Small' }, { id: 'm', r: 0.025, label: 'Medium' }, { id: 'l', r: 0.05, label: 'Large' }] as const;
type Z = { k: number; x: number; y: number };
const NOZ: Z = { k: 1, x: 0, y: 0 };

/**
 * Remove things from a scanned page (a finger, a sticker, a stain, a pen mark): paint over them and they
 * are filled in from the page around them. Pinch or use the buttons to zoom in for small marks.
 */
export function EraseEditor({ page, long, onApply, onCancel }: { page: ScanPage; long: number; onApply: (erase: Stroke[]) => void; onCancel: () => void }) {
  const [plain, setPlain] = useState<Pic | null>(null);
  // the page without any removals (what is painted on)
  useEffect(() => {
    let gone = false, url = '';
    renderLook(page, { long, noErase: true }).then((r) => { url = r.url; if (gone) URL.revokeObjectURL(r.url); else setPlain({ url: r.url, w: r.w, h: r.h }); }).catch(() => null);
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [page, long]);
  const unturn = (st: Stroke[]) => turnStrokes(st, (4 - (page.rot % 4)) % 4) ?? [];
  return (
    <RemovePainter plain={plain} aspect={page.rot % 2 ? 1 / page.ratio : page.ratio} initial={turnStrokes(page.erase, page.rot) ?? []}
      render={(st) => renderLook({ ...page, erase: unturn(st) }, { long }).then((r) => r.url)}
      onApply={(st) => onApply(unturn(st))} onCancel={onCancel} />
  );
}

export type Pic = { url: string; w: number; h: number };

/**
 * The painter behind Remove (scanner and editor): paint over things on a picture, see them filled in.
 * `render` makes the picture with the strokes removed (an object URL, freed here); strokes are fractions
 * of the picture as shown.
 */
export function RemovePainter({ plain, aspect, initial, render, onApply, onCancel, hint = 'Paint over what should go: a finger, a stain, a mark' }: {
  plain: Pic | null; aspect: number; initial: Stroke[]; render: (strokes: Stroke[]) => Promise<string>;
  onApply: (strokes: Stroke[]) => void; onCancel: () => void; hint?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const draw = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // strokes on the picture as it is shown
  const [strokes, setStrokes] = useState<Stroke[]>(initial);
  const [brush, setBrush] = useState<(typeof SIZES)[number]['id']>('m');
  const [preview, setPreview] = useState<{ url: string; n: number; key: string } | null>(null);
  // strokes whose preview couldn't be made (not shown as working forever)
  const [failed, setFailed] = useState('');
  const [z, setZ] = useState<Z>(NOZ);
  const zRef = useRef(z); zRef.current = z;
  const live = useRef<Stroke | null>(null);
  const [, redraw] = useState(0);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; m0: { x: number; y: number }; z0: Z } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useBack(onCancel);

  const strokesKey = JSON.stringify(strokes);
  const prevUrl = useRef('');
  const showPreview = (v: { url: string; n: number; key: string } | null) => {
    if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    prevUrl.current = v?.url ?? '';
    setPreview(v);
  };
  useEffect(() => {
    if (!strokes.length) { showPreview(null); return; }
    let gone = false;
    const t = setTimeout(() => {
      render(strokes).then((url) => {
        if (gone) URL.revokeObjectURL(url);
        else showPreview({ url, n: strokes.length, key: strokesKey });
      }).catch((e) => { if (!gone && String(e?.message ?? e) !== 'outdated') setFailed(strokesKey); });
    }, 120);
    return () => { gone = true; clearTimeout(t); };
  }, [strokesKey, !!plain]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (prevUrl.current) URL.revokeObjectURL(prevUrl.current); }, []);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); setStrokes((s) => s.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const pw = plain?.w ?? aspect * 1000, ph = plain?.h ?? 1000;
  const pad = 20;
  const s = size.w ? Math.min((size.w - pad * 2) / pw, (size.h - pad * 2) / ph) : 0;
  const W = pw * s, H = ph * s, L = Math.max(W, H);
  const ox = (size.w - W) / 2, oy = (size.h - H) / 2;
  const R = SIZES.find((b) => b.id === brush)!.r;
  // the strokes already in the preview are seen done there; the rest are drawn as paint
  const fits = !!preview && preview.n <= strokes.length && JSON.stringify(strokes.slice(0, preview.n)) === preview.key;
  const shown = fits ? preview!.n : 0;

  // paint
  useEffect(() => {
    const c = draw.current;
    if (!c || !s) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * Math.min(3, z.k);
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 92, 120, .55)'; ctx.fillStyle = 'rgba(255, 92, 120, .55)';
    const all = [...strokes.slice(shown), ...(live.current ? [live.current] : [])];
    for (const st of all) {
      const r = st.r * Math.max(c.width, c.height);
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      for (let i = 0; i + 1 < st.pts.length; i += 2) { const x = st.pts[i] * c.width, y = st.pts[i + 1] * c.height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      if (st.pts.length === 2) { ctx.arc(st.pts[0] * c.width, st.pts[1] * c.height, r, 0, Math.PI * 2); ctx.fill(); } else ctx.stroke();
    }
  });

  // ---- pointers: one finger paints, two pinch and pan
  const toPage = (cx: number, cy: number) => {
    const r = draw.current!.getBoundingClientRect();
    return { x: (cx - r.left) / r.width, y: (cy - r.top) / r.height };
  };
  const centre = () => { const r = stage.current!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const clampZ = (q: Z): Z => {
    const k = Math.max(1, Math.min(8, q.k));
    if (k <= 1.001) return NOZ;
    const mx = Math.max(0, (W * k - size.w) / 2 + 40), my = Math.max(0, (H * k - size.h) / 2 + 40);
    return { k, x: Math.max(-mx, Math.min(mx, q.x)), y: Math.max(-my, Math.min(my, q.y)) };
  };
  const zoomBy = (f: number) => setZ((z0) => clampZ({ k: z0.k * f, x: z0.x * f, y: z0.y * f }));
  const down = (e: React.PointerEvent) => {
    if (!s || (e.pointerType === 'mouse' && e.button !== 0)) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) {
      // a second finger: no painting, a pinch
      live.current = null; redraw((n) => n + 1);
      const [a, b] = [...pts.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, z0: zRef.current };
      return;
    }
    if (pts.current.size > 2) return;
    const p = toPage(e.clientX, e.clientY);
    // the brush keeps its size on screen: zoomed in, it paints finer
    live.current = { r: R / zRef.current.k, pts: [p.x, p.y] };
    redraw((n) => n + 1);
  };
  const move = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') setCursor({ x: e.clientX, y: e.clientY });
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = Math.max(1, Math.min(8, pc.z0.k * Math.hypot(a.x - b.x, a.y - b.y) / pc.d0));
      const c = centre(), r = k / pc.z0.k;
      setZ(clampZ({ k, x: m.x - c.x - r * (pc.m0.x - c.x - pc.z0.x), y: m.y - c.y - r * (pc.m0.y - c.y - pc.z0.y) }));
      return;
    }
    const st = live.current;
    if (!st) return;
    const p = toPage(e.clientX, e.clientY);
    const lx = st.pts[st.pts.length - 2], ly = st.pts[st.pts.length - 1];
    // a point every few screen pixels is plenty
    if (Math.hypot((p.x - lx) * W * zRef.current.k, (p.y - ly) * H * zRef.current.k) < 3) return;
    st.pts.push(p.x, p.y);
    redraw((n) => n + 1);
  };
  const up = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
    if (pinch.current) { if (pts.current.size < 2) pinch.current = null; return; }
    const st = live.current;
    live.current = null;
    if (st) setStrokes((ss) => [...ss, st]);
  };

  const brushPx = R * L;
  const busy = !!strokes.length && (!preview || preview.key !== strokesKey) && failed !== strokesKey;
  const img = fits ? preview!.url : plain?.url;

  return createPortal(
    <div className="scrop serase" role="dialog" aria-modal="true" aria-label="Remove marks">
      <header className="scrop-top">
        <button className="btn lg on-dark" onClick={onCancel}>Cancel</button>
        <div className="t"><b>Remove</b><span>{hint}</span></div>
        <button className="btn primary lg" onClick={() => onApply(strokes)}><Icon name="check" size={18} />Done</button>
      </header>
      <div className="scrop-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerLeave={() => setCursor(null)}
        onWheel={(e) => { if (e.ctrlKey || e.deltaY < 0 || z.k > 1) zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))); }}>
        {s > 0 && (
          <div className="serase-pic" style={{ left: ox, top: oy, width: W, height: H, transform: `translate(${z.x}px, ${z.y}px) scale(${z.k})` }}>
            {img ? <img src={img} alt="" draggable={false} /> : <div className="sc-skel" />}
            <canvas ref={draw} />
          </div>
        )}
        {cursor && s > 0 && <i className="serase-brush" style={{ left: cursor.x - (stage.current?.getBoundingClientRect().left ?? 0), top: cursor.y - (stage.current?.getBoundingClientRect().top ?? 0), width: brushPx * 2, height: brushPx * 2 }} />}
        {!plain && <div className="scrop-wait"><span className="spinner" /></div>}
        {busy && plain && <div className="serase-busy" role="status"><span className="spinner" />Removing…</div>}
        <div className="serase-zoom">
          <button onClick={() => zoomBy(1 / 1.6)} disabled={z.k <= 1.001} aria-label="Zoom out"><Icon name="minus" size={16} /></button>
          <button onClick={() => zoomBy(1.6)} disabled={z.k >= 7.99} aria-label="Zoom in"><Icon name="plus" size={16} /></button>
        </div>
      </div>
      <footer className="scrop-bar serase-bar">
        <div className="serase-sizes" role="radiogroup" aria-label="Brush size">
          {SIZES.map((b) => (
            <button key={b.id} role="radio" aria-checked={brush === b.id} aria-label={b.label} title={b.label} className={brush === b.id ? 'on' : ''} onClick={() => setBrush(b.id)}>
              <i style={{ width: 6 + SIZES.indexOf(b) * 7, height: 6 + SIZES.indexOf(b) * 7 }} />
            </button>
          ))}
        </div>
        <button className="scrop-tool" onClick={() => setStrokes((ss) => ss.slice(0, -1))} disabled={!strokes.length}><Icon name="undo" size={22} /><span>Undo</span></button>
        <button className="scrop-tool" onClick={() => setStrokes([])} disabled={!strokes.length}><Icon name="restore" size={22} /><span>Clear</span></button>
      </footer>
    </div>,
    document.body,
  );
}
