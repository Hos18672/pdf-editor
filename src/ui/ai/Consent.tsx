// Switching the AI assistant on: what is sent, to whom, and that it is optional. Small, so the start
// screen can show it too (its menu has the AI switch).
import React from 'react';
import { useBack } from '../back';
import { Icon } from '../icons';
import { t } from '../i18n';
import { setAiOn } from './client';

/** Switching AI on: what is sent, to whom, and that it is optional. */
export function AiConsent({ sheet, why, onAnswer }: { sheet: boolean; why: string; onAnswer: (yes: boolean) => void }) {
  useBack(() => onAnswer(false));
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="modal aimodal ai-consent" role="dialog" aria-modal="true" aria-label={t('Use the AI assistant?')}>
        <div className="grab" />
        <div className="mhead">
          <h2><span className="ai-mark"><Icon name="sparkle:fill" size={20} /></span>{t('Use the AI assistant?')}</h2>
          <button className="ibtn" onClick={() => onAnswer(false)} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
      {why && <p className="ai-why">{why}</p>}
      <ul className="ai-points">
        <li><Icon name="cloud-slash" size={19} /><span>{t('Everything else in Paginka keeps working on this device only.')}</span></li>
        <li><Icon name="paper-plane-right" size={19} /><span>{t('Only when you tap an AI action, what it needs (the text of the pages, a page picture, the form fields and your details for filling) is sent over an encrypted connection to Claude by Anthropic.')}</span></li>
        <li><Icon name="shield-check" size={19} /><span>{t('Paginka stores nothing. Anthropic does not train on it and deletes it within 30 days. You can switch AI off at any time.')}</span></li>
        <li><Icon name="warning-circle" size={19} /><span>{t('AI can make mistakes. Check the answers before you send or sign anything.')}</span></li>
      </ul>
        <div className="foot">
          <button className="btn outline lg" onClick={() => onAnswer(false)}>{t('Not now')}</button>
          <button className="btn primary lg" onClick={() => { setAiOn(true); onAnswer(true); }}><Icon name="sparkle:fill" size={18} />{t('Switch on AI')}</button>
        </div>
      </div>
    </div>
  );
}

