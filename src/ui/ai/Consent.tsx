// Switching the AI assistant on, and its settings: where requests go (Paginka AI, or the user's own key for
// Claude, ChatGPT or Gemini), what is sent, and that it is optional. Small, so the start screen can show it too.
import React, { useState } from 'react';
import { useBack } from '../back';
import { Icon } from '../icons';
import { t } from '../i18n';
import { AiError, PROVIDERS, aiErrorText, aiErrorMsg, aiSettings, forgetKey, hostedAi, providerInfo, saveAi, setAiOn, testKey, type AiProvider } from './client';

/** Switching AI on (or changing its settings when `settings` is set). */
export function AiConsent({ sheet, why, onAnswer, settings }: { sheet: boolean; why: string; onAnswer: (yes: boolean) => void; settings?: boolean }) {
  useBack(() => onAnswer(false));
  const saved = aiSettings();
  const [prov, setProv] = useState<AiProvider>(saved.provider);
  const own = prov !== 'paginka';
  const [keys, setKeys] = useState<Record<string, string>>(saved.keys as Record<string, string>);
  const [models, setModels] = useState<Record<string, string>>(saved.models as Record<string, string>);
  const [show, setShow] = useState(false);
  const [adv, setAdv] = useState(!!(own && saved.models[prov as keyof typeof saved.models]));
  const [check, setCheck] = useState<null | 'busy' | 'ok' | string>(null);
  const key = own ? keys[prov] ?? '' : '';
  const model = own ? models[prov] ?? '' : '';
  const info = own ? providerInfo(prov) : null;
  const target = info ? `${info.name} (${info.company})` : 'Claude (Anthropic)';

  const runTest = async (): Promise<boolean> => {
    if (!own) return true;
    setCheck('busy');
    const err = await testKey(prov, key, model);
    if (!err) { setCheck('ok'); return true; }
    setCheck(aiErrorMsg(err, t));
    // offline or busy: the key may still be right
    return !(err.code === 'bad_key' || err.code === 'bad_model');
  };
  const go = async () => {
    if (own && !key.trim()) return;
    if (own && check !== 'ok' && !(await runTest())) return;
    saveAi(prov, own ? key : undefined, own ? model : undefined);
    onAnswer(true);
  };

  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="modal aimodal ai-consent" role="dialog" aria-modal="true" aria-label={settings ? t('AI settings') : t('Use the AI assistant?')} onKeyDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mhead">
          <h2><span className="ai-mark"><Icon name="sparkle:fill" size={20} /></span>{settings ? t('AI settings') : t('Use the AI assistant?')}</h2>
          <button className="ibtn" onClick={() => onAnswer(false)} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        {why && <p className="ai-why">{why}</p>}

        <div className="field">
          <span className="label">{t('Which AI?')}</span>
          <div className="ai-provs" role="radiogroup" aria-label={t('Which AI?')}>
            {hostedAi() && (
              <button role="radio" aria-checked={prov === 'paginka'} className={`ai-prov${prov === 'paginka' ? ' on' : ''}`} onClick={() => { setProv('paginka'); setCheck(null); }}>
                <b>{t('Paginka AI')}</b><small>{t('Free, with a daily limit. Runs on Claude.')}</small>
              </button>
            )}
            {PROVIDERS.map((p) => (
              <button key={p.id} role="radio" aria-checked={prov === p.id} className={`ai-prov${prov === p.id ? ' on' : ''}`} onClick={() => { setProv(p.id); setCheck(null); setAdv(!!models[p.id]); }}>
                <b>{p.name} <span>({p.company})</span></b>
                <small>{saved.keys[p.id] ? t('Your key is saved') : t('Your own API key')}</small>
              </button>
            ))}
          </div>
        </div>

        {info && (
          <div className="ai-keybox">
            <label className="field"><span className="label">{t('{name} API key', { name: info.company })}</span>
              <span className="ai-keyrow">
                <input className="input" type={show ? 'text' : 'password'} value={key} placeholder={`${info.prefix}…`} autoComplete="off" spellCheck={false}
                  onChange={(e) => { setKeys((k) => ({ ...k, [prov]: e.target.value })); setCheck(null); }} aria-label={t('{name} API key', { name: info.company })} />
                <button type="button" className="ibtn" onClick={() => setShow((v) => !v)} aria-label={show ? t('Hide') : t('Show')}><Icon name={show ? 'eye-slash' : 'eye'} size={18} /></button>
              </span>
            </label>
            <div className="ai-keyacts">
              <a className="linkbtn" href={info.keyUrl} target="_blank" rel="noopener noreferrer">{t('Get a key at {site}', { site: info.keyUrl.replace(/^https:\/\//, '').split('/')[0] })}</a>
              <button className="btn outline sm" disabled={!key.trim() || check === 'busy'} onClick={runTest}>
                {check === 'busy' ? <span className="spinner sm" /> : <Icon name="check" size={15} />}{t('Test key')}</button>
            </div>
            {check && check !== 'busy' && (
              <div className={`note${check === 'ok' ? ' ok' : ' warn'}`} role="status"><Icon name={check === 'ok' ? 'check-circle:fill' : 'warning-circle'} size={16} />
                <span>{check === 'ok' ? t('The key works.') : check}</span></div>
            )}
            {adv ? (
              <label className="field"><span className="label">{t('Model (optional)')}</span>
                <input className="input" value={model} placeholder={info.smart} autoComplete="off" spellCheck={false}
                  onChange={(e) => { setModels((m) => ({ ...m, [prov]: e.target.value })); setCheck(null); }} />
              </label>
            ) : <button className="linkbtn ai-adv" onClick={() => setAdv(true)}>{t('Choose a model')}</button>}
            {saved.keys[prov as keyof typeof saved.keys] && (
              <button className="linkbtn ai-adv" onClick={() => { forgetKey(prov as any); setKeys((k) => { const n = { ...k }; delete n[prov]; return n; }); setCheck(null); }}>
                <Icon name="trash" size={14} /> {t('Remove the key from this device')}</button>
            )}
          </div>
        )}

        <ul className="ai-points">
          <li><Icon name="cloud-slash" size={19} /><span>{t('Everything else in Paginka keeps working on this device only.')}</span></li>
          <li><Icon name="paper-plane-right" size={19} /><span>{t('Only when you tap an AI action, what it needs (the text of the pages, a page picture, the form fields and your details for filling) is sent over an encrypted connection to {target}.', { target })}</span></li>
          {own
            ? <li><Icon name="lock-key:fill" size={19} /><span>{t('Your key is stored only on this device and sent only to {company}. Use and costs go to your own {company} account and its terms.', { company: info!.company })}</span></li>
            : <li><Icon name="shield-check" size={19} /><span>{t('Paginka stores nothing. Anthropic does not train on it and deletes it within 30 days. You can switch AI off at any time.')}</span></li>}
          <li><Icon name="warning-circle" size={19} /><span>{t('AI can make mistakes. Check the answers before you send or sign anything.')}</span></li>
        </ul>
        <div className="foot">
          {settings && saved.on
            ? <button className="btn outline lg" onClick={() => { setAiOn(false); onAnswer(false); }}>{t('Switch off AI')}</button>
            : <button className="btn outline lg" onClick={() => onAnswer(false)}>{t('Not now')}</button>}
          <button className="btn primary lg" disabled={(own && !key.trim()) || check === 'busy'} onClick={go}>
            {check === 'busy' ? <span className="spinner sm" /> : <Icon name="sparkle:fill" size={18} />}{settings && saved.on ? t('Save') : t('Switch on AI')}</button>
        </div>
      </div>
    </div>
  );
}
