import React, { useEffect, useState } from 'react';
import { Icon } from './icons';
import { appBase } from './assets';
import { useBack } from './back';

export type LegalPage = 'impressum' | 'privacy' | 'terms' | 'licenses';
const PAGES: [LegalPage, string][] = [['impressum', 'Impressum'], ['privacy', 'Privacy'], ['terms', 'Terms'], ['licenses', 'Licenses']];
const TITLE: Record<LegalPage, string> = { impressum: 'Impressum', privacy: 'Privacy policy', terms: 'Terms of use', licenses: 'Open-source licenses' };

/** The legal pages ship with the app (public/legal), so they also open offline in the Android app. */
export const legalUrl = (p: LegalPage) => `${appBase()}legal/${p}.html`;

/** A small row of links to the legal pages (start screen, all tools). */
export function LegalLinks({ onOpen, className = '' }: { onOpen: (p: LegalPage) => void; className?: string }) {
  return (
    <nav className={`legal-links ${className}`} aria-label="Legal">
      {PAGES.map(([p, label], i) => (
        <React.Fragment key={p}>
          {i > 0 && <span aria-hidden="true">·</span>}
          <a href={legalUrl(p)} onClick={(e) => { e.preventDefault(); onOpen(p); }}>{label}</a>
        </React.Fragment>
      ))}
    </nav>
  );
}

/** Full-screen sheet showing one legal page (the pages link to each other). */
export function LegalSheet({ page, onClose }: { page: LegalPage; onClose: () => void }) {
  const [cur] = useState(page);
  useBack(onClose);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="legal-sheet" role="dialog" aria-modal="true" aria-label={TITLE[cur]}>
      <header className="ls-h">
        <button className="ibtn" onClick={onClose} aria-label="Close"><Icon name="back" /></button>
        <b>Legal</b>
        <span style={{ width: 40 }} />
      </header>
      <iframe title={TITLE[cur]} src={legalUrl(cur)} />
    </div>
  );
}
