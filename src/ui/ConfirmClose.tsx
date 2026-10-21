import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

/** Asked when leaving a document with unsaved changes (replaces the browser's confirm box). */
export function ConfirmClose({ changes, sheet, onDownload, onDiscard, onCancel, title, body, keepLabel, saveLabel }: {
  changes: number; sheet: boolean; onDownload: () => void; onDiscard: () => void; onCancel: () => void;
  title?: string; body?: string; keepLabel?: string; saveLabel?: string;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cc-t" aria-describedby="cc-d">
        <div className="grab" />
        <div className="cc-head">
          <div className="cc-tile"><Icon name="warning-circle" size={26} /></div>
          <div>
            <h2 id="cc-t">{title ?? 'Close without saving?'}</h2>
            <p id="cc-d">{body ?? `You have ${changes} unsaved ${changes === 1 ? 'change' : 'changes'}. Download the PDF to keep ${changes === 1 ? 'it, or it’ll' : 'them, or they’ll'} be lost.`}</p>
          </div>
        </div>
        <div className="cc-actions">
          <button className="btn primary lg" onClick={onDownload}><Icon name="download" size={18} />{saveLabel ?? 'Download and close'}</button>
          <button className="btn danger lg" onClick={onDiscard}>Discard changes</button>
          <button ref={keep} className="btn ghost lg" onClick={onCancel}>{keepLabel ?? 'Keep editing'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
