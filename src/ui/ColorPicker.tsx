import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { Icon } from './icons';
import { holdEditing } from './hooks';

export const PALETTE = [
  '#000000', '#3A3F4B', '#6B7280', '#A3A8B4', '#FFFFFF', '#1E2559', '#2F5BD3', '#0EA5E9', '#14A3A3', '#1E7A4C',
  '#22C55E', '#84CC16', '#FFE14D', '#F59E0B', '#F97316', '#B83227', '#EF4444', '#EC4899', '#A855F7', '#7C3AED',
];

const RECENT_KEY = 'pe-recent-colours';
const readRecent = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10) : []; }
  catch { return []; }
};
const saveRecent = (c: string) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([c, ...readRecent().filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 10))); }
  catch { /* storage unavailable */ }
};
const norm = (c: string) => {
  const v = c.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(v)) return '#' + [...v].map((x) => x + x).join('').toLowerCase();
  return /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : '#000000';
};

/**
 * Colour picker: saturation/brightness area + hue (react-colorful), hex field, palette, recent colours
 * and (where the browser has it) an eyedropper. A bottom sheet on phones, a dialog elsewhere.
 * The text being edited stays in edit mode while it is open.
 */
export function ColorPicker({ value, onApply, onClose, sheet, title = 'Colour' }: {
  value: string; onApply: (c: string) => void; onClose: () => void; sheet?: boolean; title?: string;
}) {
  if (sheet === undefined) sheet = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 599px)').matches;
  const start = norm(value);
  const [draft, setDraft] = useState(start);
  const [recent] = useState(readRecent);
  const back = useRef<Element | null>(null);

  useEffect(() => {
    back.current = document.activeElement;
    const release = holdEditing();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      release();
      // give the caret back to the text that was being edited
      const el = back.current as HTMLElement | null;
      if (el && el.isConnected && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && document.activeElement !== el) el.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => { const c = norm(draft); saveRecent(c); onApply(c); onClose(); };
  const eyedropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pickFromScreen = async () => {
    try { const r = await new (window as any).EyeDropper().open(); if (r?.sRGBHex) setDraft(norm(r.sRGBHex)); } catch { /* cancelled */ }
  };
  // taps on the picker must not take focus from the text being edited (keeps the phone keyboard down)
  const keepFocus = (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault(); };
  const chip = (c: string) => (
    <button key={c} type="button" className={`cp-chip${c.toLowerCase() === draft ? ' on' : ''}`} style={{ '--c': c } as React.CSSProperties}
      onClick={() => setDraft(norm(c))} aria-label={`Colour ${c}`} title={c} />
  );

  return createPortal(
    <div className={`cp-scrim${sheet ? ' sheet' : ''}`} onMouseDown={(e) => { keepFocus(e); if (e.target === e.currentTarget) onClose(); }}>
      <div className="cp" role="dialog" aria-label={title} onMouseDown={keepFocus}>
        {sheet && <div className="grab" />}
        <div className="cp-head">
          <h3>{title}</h3>
          <button type="button" className="ibtn muted" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <HexColorPicker color={draft} onChange={setDraft} />
        <div className="cp-row">
          <div className="cp-compare" aria-hidden="true"><i style={{ background: start }} title="Current" /><i style={{ background: draft }} title="New" /></div>
          <label className="cp-hex"><span>#</span>
            <HexColorInput color={draft} onChange={(c) => setDraft(norm(c))} aria-label="Hex colour" spellCheck={false} />
          </label>
          {eyedropper && <button type="button" className="ibtn" onClick={pickFromScreen} aria-label="Pick a colour from the screen" title="Pick from screen"><Icon name="eyedropper" size={19} /></button>}
        </div>
        <div className="cp-grid">{PALETTE.map(chip)}</div>
        {recent.length > 0 && (
          <div className="cp-recent"><span className="label">Recent</span><div className="cp-grid">{recent.map(chip)}</div></div>
        )}
        <div className="cp-acts">
          <button type="button" className="btn outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
