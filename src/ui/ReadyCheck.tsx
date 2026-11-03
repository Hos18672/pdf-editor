// "Ready to send?": before a form goes out, what is still missing: empty fields, a signature line
// nobody signed, a date nobody wrote. Each one with the fix right next to it.
import React from 'react';
import { useBack } from './back';
import { Icon } from './icons';
import { t, tn } from './i18n';
import type { FormField } from './Fields';

export interface Issue {
  kind: 'empty' | 'sign' | 'date';
  page: number; label: string;
  field?: FormField;
  /** where a signature or the date goes (viewport units at scale 1) */
  at?: { x: number; y: number; size: number };
}

const ICON: Record<Issue['kind'], string> = { empty: 'textbox:duotone', sign: 'signature:duotone', date: 'calendar-blank' };

export function ReadyCheck({ issues, sheet, pageLabel, onClose, onFix, onShow }: {
  issues: Issue[]; sheet: boolean; pageLabel: (src: number) => number;
  onClose: () => void; onFix: (i: Issue) => void; onShow: (i: Issue) => void;
}) {
  useBack(onClose);
  const fix: Record<Issue['kind'], string> = { empty: t('Fill in'), sign: t('Sign'), date: t('Add date') };
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal rcmodal" role="dialog" aria-modal="true" aria-label={t('Ready to send?')}>
        <div className="grab" />
        <div className="mhead">
          <h2><Icon name={issues.length ? 'list-checks' : 'seal-check:fill'} size={24} />{issues.length ? t('Ready to send?') : t('Ready to send')}</h2>
          <button className="ibtn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        {issues.length ? (
          <>
            <p className="rc-sum">{tn(issues.length, 'One thing is still missing:', '{n} things are still missing:')}</p>
            <div className="rc-list">
              {issues.map((it, i) => (
                <div key={`${it.kind}-${it.page}-${i}`} className={`rc-it ${it.kind}`} style={{ ['--i' as any]: Math.min(i, 10) }}>
                  <span className="rc-ic"><Icon name={ICON[it.kind]} size={20} /></span>
                  <button className="rc-t" onClick={() => onShow(it)}>
                    <b>{it.kind === 'empty' ? t('Empty field') : it.kind === 'sign' ? t('Not signed') : t('No date')}</b>
                    <span>{it.label} · {t('p. {n}', { n: pageLabel(it.page) })}</span>
                  </button>
                  <button className="btn outline sm" onClick={() => onFix(it)}>{fix[it.kind]}</button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rc-ok">
            <span className="rc-badge"><Icon name="seal-check:fill" size={46} /></span>
            <p>{t('Every field is filled in, signed and dated. You can send it.')}</p>
          </div>
        )}
        <div className="foot"><button className="btn primary lg" onClick={onClose}>{issues.length ? t('Later') : t('Done')}</button></div>
      </div>
    </div>
  );
}
