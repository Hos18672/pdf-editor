// "My details": what forms are filled in with. Kept in this browser / on this phone only.
import React, { useState } from 'react';
import { useBack } from './back';
import { Icon } from './icons';
import { t } from './i18n';
import { PROFILE_FIELDS, loadProfile, saveProfile, type Profile } from './profile';

export function ProfileModal({ sheet, onClose, onSaved, fillLabel }: {
  sheet: boolean; onClose: () => void; onSaved: (p: Profile) => void;
  /** the main button also fills in the form */
  fillLabel?: string;
}) {
  useBack(onClose);
  const [p, setP] = useState<Profile>(loadProfile);
  const any = Object.values(p).some((v) => v?.trim());
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal profmodal" role="dialog" aria-modal="true" aria-label={t('My details')}>
        <div className="grab" />
        <div className="mhead">
          <h2><Icon name="address-book:duotone" size={24} />{t('My details')}</h2>
          <button className="ibtn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        <div className="note"><Icon name="lock" size={15} /><span>{t('Saved only on this device. Forms are filled in with these details in one tap, and nothing is sent anywhere.')}</span></div>
        <form className="profgrid" onSubmit={(e) => { e.preventDefault(); onSaved(saveProfile(p)); }}>
          {PROFILE_FIELDS.map(([k, label, ph, type], i) => (
            <label key={k} className={`pf pf-${k}`} style={{ ['--i' as any]: i }}>
              <span className="label">{t(label)}</span>
              <input className="input" type={type} value={p[k] ?? ''} placeholder={ph} autoComplete="off"
                onChange={(e) => setP((o) => ({ ...o, [k]: e.target.value }))} onKeyDown={(e) => e.stopPropagation()} />
            </label>
          ))}
          <button type="submit" hidden />
        </form>
        <div className="foot">
          {any && <button className="btn outline lg" onClick={() => { setP({}); }}><Icon name="trash" size={17} />{t('Clear all')}</button>}
          <button className="btn primary lg" onClick={() => onSaved(saveProfile(p))}><Icon name={fillLabel ? 'magic-wand' : 'check'} size={18} />{fillLabel ?? t('Save')}</button>
        </div>
      </div>
    </div>
  );
}
