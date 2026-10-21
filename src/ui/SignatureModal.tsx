import React, { useEffect, useRef, useState } from 'react';
import { useBack } from './back';
import { Icon } from './icons';

export interface Stamp { src: string; w: number; h: number; }

const SIG_FONTS = ['Caveat', 'Dancing Script', 'Great Vibes', 'Homemade Apple'];
const INKS = ['#14161F', '#1E2559', '#2F5BD3'];
const STORE = 'pdfeditor.signatures';

const loadSaved = (): string[] => {
  try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; }
};
const save = (list: string[]) => { try { localStorage.setItem(STORE, JSON.stringify(list.slice(0, 6))); } catch { /* storage unavailable */ } };

/** Crop transparent/white margins and return a PNG stamp. */
function trim(canvas: HTMLCanvasElement, whiteToAlpha = false): Stamp | null {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (whiteToAlpha) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (lum > 215) d[i + 3] = 0;
      else if (lum > 170) d[i + 3] = Math.round(d[i + 3] * (215 - lum) / 45);
    }
    if (d[i + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  if (whiteToAlpha) ctx.putImageData(img, 0, 0);
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height };
}

const stampFromSrc = (src: string): Promise<Stamp> => new Promise((res) => {
  const im = new Image();
  im.onload = () => res({ src, w: im.naturalWidth, h: im.naturalHeight });
  im.src = src;
});

export function SignatureModal({ onClose, onPick, sheet }: { onClose: () => void; onPick: (s: Stamp) => void; sheet?: boolean }) {
  useBack(onClose);
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [ink, setInk] = useState(INKS[1]);
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [name, setName] = useState('');
  const [font, setFont] = useState(SIG_FONTS[0]);
  const [hasInk, setHasInk] = useState(false);
  const [keep, setKeep] = useState(true);
  const padRef = useRef<HTMLCanvasElement>(null);
  const pts = useRef<{ x: number; y: number }[]>([]);
  const drawing = useRef(false);

  useEffect(() => {
    const c = padRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasInk(false);
  }, [tab]);

  const pos = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    drawing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pts.current = [pos(e)];
  };
  const moveP = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = padRef.current!.getContext('2d')!;
    const p = pos(e);
    const list = pts.current;
    list.push(p);
    ctx.strokeStyle = ink;
    const pressure = e.pressure && e.pointerType === 'pen' ? e.pressure : 0.6;
    ctx.lineWidth = 1.4 + pressure * 2.6;
    if (list.length >= 3) {
      const [a, b, c] = list.slice(-3);
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
      ctx.stroke();
    }
    setHasInk(true);
  };
  const upP = () => { drawing.current = false; };
  const clear = () => {
    const c = padRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const typedStamp = (): Stamp | null => {
    if (!name.trim()) return null;
    const c = document.createElement('canvas');
    c.width = 1400; c.height = 360;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = ink;
    ctx.font = `160px "${font}"`;
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 30, 190, 1340);
    return trim(c);
  };

  const finish = (s: Stamp | null) => {
    if (!s) return;
    if (keep && !saved.includes(s.src)) { const list = [s.src, ...saved]; save(list); }
    onPick(s);
  };

  const onFile = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        const k = Math.min(1, 1400 / im.naturalWidth);
        c.width = im.naturalWidth * k; c.height = im.naturalHeight * k;
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
        finish(trim(c, true));
      };
      im.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const place = () => {
    if (tab === 'draw') finish(trim(padRef.current!));
    else document.fonts.load(`160px "${font}"`).catch(() => null).then(() => finish(typedStamp()));
  };
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sigmodal" role="dialog" aria-modal="true" aria-label="Add signature">
        <div className="grab" />
        <div className="mhead">
          <h2>Add signature</h2>
          <button className="ibtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {saved.length > 0 && (
          <section className="field">
            <div className="label">Saved on this device · tap to place</div>
            <div className="saved">
              {saved.map((s) => (
                <div key={s} className="s" role="button" tabIndex={0} aria-label="Place saved signature"
                  onClick={() => stampFromSrc(s).then(onPick)} onKeyDown={(e) => e.key === 'Enter' && stampFromSrc(s).then(onPick)}>
                  <img src={s} alt="" draggable={false} />
                  <button className="x" aria-label="Remove saved signature" onClick={(e) => {
                    e.stopPropagation();
                    const list = saved.filter((x) => x !== s); setSaved(list); save(list);
                  }}><Icon name="close" size={13} /></button>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="seg lg" role="tablist">
          {([['draw', 'Draw', 'scribble'], ['type', 'Type', 'keyboard'], ['upload', 'Upload', 'upload']] as const).map(([t, label, ic]) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
              <Icon name={ic} size={17} />{label}
            </button>
          ))}
        </div>
        {tab === 'draw' && (
          <div className="sigpad">
            <canvas ref={padRef} onPointerDown={down} onPointerMove={moveP} onPointerUp={upP} onPointerCancel={upP} />
            <div className="base" /><div className="xm"><Icon name="close" size={16} /></div>
            {!hasInk && <div className="ph">Sign with finger, pen or mouse</div>}
          </div>
        )}
        {tab === 'type' && (
          <div className="typed">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Type your name" autoFocus />
            <div className="opts">
              {SIG_FONTS.map((f) => (
                <button key={f} className={font === f ? 'on' : ''} style={{ fontFamily: `"${f}"`, color: ink }} onClick={() => setFont(f)}>
                  {name || 'Your name'}
                </button>
              ))}
            </div>
          </div>
        )}
        {tab === 'upload' && (
          <label className="sigpad upload">
            <input type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            <div><Icon name="upload" size={28} /><div style={{ marginTop: 8, fontWeight: 600 }}>Choose a photo of your signature</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>A white background is removed automatically</div></div>
          </label>
        )}
        <div className="inkrow">
          {tab !== 'upload' && (
            <div className="inks"><span className="label">Ink</span>
              <div className="swatches">
                {INKS.map((c) => <button key={c} className={`swatch${ink === c ? ' on' : ''}`} onClick={() => setInk(c)} aria-label={`Ink ${c}`}><i style={{ background: c, width: 28, height: 28 }} /></button>)}
              </div>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <label className="check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span className="box"><Icon name="check" size={14} /></span>Save on this device
          </label>
        </div>
        {tab !== 'upload' && (
          <div className="foot">
            {tab === 'draw' && <button className="btn outline lg" onClick={clear} disabled={!hasInk}><Icon name="restore" size={17} />Clear</button>}
            <button className="btn primary lg" disabled={tab === 'draw' ? !hasInk : !name.trim()} onClick={place}>
              <Icon name="signature:bold" size={18} />Place signature
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
