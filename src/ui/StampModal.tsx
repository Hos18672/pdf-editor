// Stamps: a rubber-stamp look (frame, capitals, the date) drawn as a picture and placed like an image.
import React, { useEffect, useMemo, useState } from 'react';
import { useBack } from './back';
import { Icon } from './icons';
import { t, getLang } from './i18n';
import type { Stamp } from './SignatureModal';

const INKS: [string, string][] = [['#1E7A4C', 'Green'], ['#2F5BD3', 'Blue'], ['#D93025', 'Red'], ['#14161F', 'Black']];
type Preset = { label: string; ink: string; date: boolean };
const PRESETS: Preset[] = [
  { label: 'APPROVED', ink: '#1E7A4C', date: true },
  { label: 'PAID', ink: '#2F5BD3', date: true },
  { label: 'RECEIVED', ink: '#2F5BD3', date: true },
  { label: 'DONE', ink: '#1E7A4C', date: true },
  { label: 'REJECTED', ink: '#D93025', date: true },
  { label: 'COPY', ink: '#D93025', date: false },
  { label: 'DRAFT', ink: '#14161F', date: false },
  { label: 'CONFIDENTIAL', ink: '#D93025', date: false },
];
const DE: Record<string, string> = {
  APPROVED: 'GENEHMIGT', PAID: 'BEZAHLT', RECEIVED: 'ERHALTEN', DONE: 'ERLEDIGT', REJECTED: 'ABGELEHNT', COPY: 'KOPIE', DRAFT: 'ENTWURF', CONFIDENTIAL: 'VERTRAULICH',
};
const word = (en: string) => (getLang() === 'de' ? DE[en] ?? en : en);
const CUSTOM = 'pe.stamp.custom';

const today = () => new Date().toLocaleDateString(getLang() === 'de' ? 'de-AT' : undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** the stamp as a transparent PNG (drawn at 4× so it stays sharp when printed) */
export function drawStamp(text: string, ink: string, sub: string | null): Stamp {
  const k = 4, pad = 14 * k, gap = 6 * k;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const main = `800 ${30 * k}px "Schibsted Grotesk", Arial, Helvetica, sans-serif`;
  const small = `700 ${12 * k}px "Schibsted Grotesk", Arial, Helvetica, sans-serif`;
  ctx.font = main;
  const mw = ctx.measureText(text).width + text.length * 2 * k;
  ctx.font = small;
  const sw = sub ? ctx.measureText(sub).width + sub.length * 1.5 * k : 0;
  const w = Math.ceil(Math.max(mw, sw) + pad * 2), h = Math.ceil(30 * k + (sub ? 12 * k + gap : 0) + pad * 2);
  c.width = w; c.height = h;
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  const frame = (inset: number, lw: number, r: number) => {
    ctx.lineWidth = lw;
    const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x1, y0, x1, y1, r); ctx.arcTo(x1, y1, x0, y1, r); ctx.arcTo(x0, y1, x0, y0, r); ctx.arcTo(x0, y0, x1, y0, r);
    ctx.closePath();
    ctx.stroke();
  };
  frame(2.5 * k, 3.2 * k, 9 * k);
  frame(6.5 * k, 1.2 * k, 6 * k);
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = main;
  (ctx as any).letterSpacing = `${2 * k}px`;
  ctx.fillText(text, w / 2 + k, pad + 25 * k);
  if (sub) {
    ctx.font = small;
    (ctx as any).letterSpacing = `${1.5 * k}px`;
    ctx.fillText(sub, w / 2 + 0.75 * k, pad + 30 * k + gap + 9 * k);
  }
  // a worn rubber look: a few specks of missing ink
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (w * h) / 900; i++) {
    const x = Math.floor(rnd() * w), y = Math.floor(rnd() * h), r = 1 + Math.floor(rnd() * 2.2 * k);
    for (let yy = Math.max(0, y - r); yy < Math.min(h, y + r); yy++) for (let xx = Math.max(0, x - r); xx < Math.min(w, x + r); xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) d[(yy * w + xx) * 4 + 3] *= 0.35;
    }
  }
  for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * 0.92);
  ctx.putImageData(img, 0, 0);
  return { src: c.toDataURL('image/png'), w: w / k / 1.6, h: h / k / 1.6 };
}

export function StampModal({ sheet, onClose, onPick }: { sheet: boolean; onClose: () => void; onPick: (s: Stamp) => void }) {
  useBack(onClose);
  const [text, setText] = useState(() => { try { return localStorage.getItem(CUSTOM) ?? ''; } catch { return ''; } });
  const [ink, setInk] = useState(INKS[2][0]);
  const [date, setDate] = useState(true);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { document.fonts.load('800 30px "Schibsted Grotesk"').catch(() => null).then(() => setFontsReady(true)); }, []);
  const previews = useMemo(() => fontsReady ? PRESETS.map((p) => ({ p, s: drawStamp(word(p.label), p.ink, p.date ? today() : null) })) : [], [fontsReady]);
  const custom = () => {
    const v = text.trim().toUpperCase();
    if (!v) return;
    try { localStorage.setItem(CUSTOM, text.trim()); } catch { /* storage unavailable */ }
    onPick(drawStamp(v, ink, date ? today() : null));
  };
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal stampmodal" role="dialog" aria-modal="true" aria-label={t('Add stamp')}>
        <div className="grab" />
        <div className="mhead">
          <h2>{t('Add stamp')}</h2>
          <button className="ibtn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        <div className="label">{t('Tap a stamp to place it. The date is today’s.')}</div>
        <div className="stamps">
          {previews.map(({ p, s }, i) => (
            <button key={p.label} className="stampbtn" style={{ ['--i' as any]: i }} onClick={() => onPick(s)} aria-label={word(p.label)}>
              <img src={s.src} alt="" draggable={false} />
            </button>
          ))}
        </div>
        <section className="field">
          <div className="label">{t('Your own stamp')}</div>
          <input className="input" value={text} maxLength={28} onChange={(e) => setText(e.target.value)} placeholder={t('e.g. CHECKED')} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') custom(); }} />
          <div className="inkrow">
            <div className="inks"><span className="label">{t('Ink')}</span>
              <div className="swatches">
                {INKS.map(([c, n]) => <button key={c} className={`swatch${ink === c ? ' on' : ''}`} onClick={() => setInk(c)} aria-label={t(n)}><i style={{ background: c, width: 28, height: 28 }} /></button>)}
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <label className="check">
              <input type="checkbox" checked={date} onChange={(e) => setDate(e.target.checked)} />
              <span className="box"><Icon name="check" size={14} /></span>{t('With date')}
            </label>
          </div>
        </section>
        <div className="foot">
          <button className="btn primary lg" disabled={!text.trim()} onClick={custom}><Icon name="stamp" size={18} />{t('Place stamp')}</button>
        </div>
      </div>
    </div>
  );
}
