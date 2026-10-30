import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { useBack } from './back';
import { t, tn } from './i18n';

/** Asked when leaving a document with unsaved changes (replaces the browser's confirm box). */
export function ConfirmClose({ changes, sheet, onDownload, onDiscard, onCancel, title, body, keepLabel, saveLabel }: {
  changes: number; sheet: boolean; onDownload: () => void; onDiscard: () => void; onCancel: () => void;
  title?: string; body?: string; keepLabel?: string; saveLabel?: string;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useBack(onCancel);
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
            <h2 id="cc-t">{title ?? t('Close without saving?')}</h2>
            <p id="cc-d">{body ?? tn(changes, 'You have {n} unsaved change. Download the PDF to keep it, or it’ll be lost.', 'You have {n} unsaved changes. Download the PDF to keep them, or they’ll be lost.')}</p>
          </div>
        </div>
        <div className="cc-actions">
          <button className="btn primary lg" onClick={onDownload}><Icon name="download" size={18} />{saveLabel ?? t('Download and close')}</button>
          <button className="btn danger lg" onClick={onDiscard}>{t('Discard changes')}</button>
          <button ref={keep} className="btn ghost lg" onClick={onCancel}>{keepLabel ?? t('Keep editing')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
