import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { LegalLinks, LegalSheet, LEGAL_PAGES, legalUrl, type LegalPage } from './Legal';
import { isPdf, useFileDrop } from './drop';
import { appBase } from './assets';
import { useFitLabels, type Theme } from './hooks';
import { ago, listRecent, onRecentChange, removeRecent, type RecentDoc } from './recent';
import { t, tn, useLang } from './i18n';
import { useBack } from './back';
import { aiAllowed, useAiOn } from './ai/client';
import { AiConsent } from './ai/Consent';

export type OpenState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string; progress: number; detail: string; done?: number; total?: number }
  | { kind: 'password'; name: string; wrong: boolean }
  | { kind: 'error'; message: string };

export type HomeTab = 'home' | 'files';
export type QuickAction = 'scan' | 'sign' | 'fill' | 'combine' | 'convert' | 'tools';

const ANDROID_URL = 'https://github.com/Hos18672/pdf-editor/releases/latest';

/** Switches the interface language between German and English. */
export function LangButton({ round }: { round?: boolean }) {
  const [lang, setLang] = useLang();
  const next = lang === 'de' ? 'en' : 'de';
  return (
    <button className={round ? 's2-round lang' : 'ibtn muted lang'} onClick={() => setLang(next)} aria-label={next === 'de' ? 'Auf Deutsch umstellen' : 'Switch to English'} title={next === 'de' ? 'Deutsch' : 'English'}>
      <span className="lang-code">{next.toUpperCase()}</span>
    </button>
  );
}

export function ThemeButton({ theme, onToggle, round }: { theme: Theme; onToggle: () => void; round?: boolean }) {
  return (
    <button className={round ? 's2-round' : 'ibtn muted'} onClick={onToggle} aria-label={theme === 'dark' ? t('Use light theme') : t('Use dark theme')} title={theme === 'dark' ? t('Light theme') : t('Dark theme')}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={round ? 18 : 19} />
    </button>
  );
}

/** The app mark: a page with a PDF label, a scan line and a pen. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <span className="logo3" style={{ width: size, height: size }} aria-hidden="true"><img src={appBase() + 'logo.png'} alt="" draggable={false} /></span>;
}

const QUICK: [QuickAction, string, string, string][] = [
  ['scan', 'Scan', 'scan:duotone', '#DDF1E4'],
  ['sign', 'Sign', 'signature:duotone', '#FFE14D'],
  ['fill', 'Fill a form', 'textbox:duotone', '#DDE2FF'],
  ['combine', 'Combine', 'stack:duotone', '#E3F1E9'],
  ['convert', 'Convert to PDF', 'file-arrow-down:duotone', '#FCE3D8'],
  ['tools', 'More tools', 'squares-four:duotone', '#ECEEF3'],
];

export function Start({ state, onFile, onImport, onPick, onPassword, onTools, onQuick, onRecent, onShareRecent, theme, onTheme, mobile, isNative, v3, tab = 'home', onTab }: {
  state: OpenState; onFile: (f: File) => void;
  /** files that aren't PDFs (pictures, Office files, text): turned into one PDF and opened */
  onImport?: (files: File[]) => void; onPick: () => void; onPassword: (pw: string) => void; onTools: () => void;
  onQuick: (q: QuickAction) => void; onRecent: (d: RecentDoc) => void; onShareRecent?: (d: RecentDoc) => void; theme: Theme; onTheme: () => void; mobile: boolean; isNative?: boolean;
  /** phones and tablets: the v3 home (navy open card, recent row, tool tiles) */
  v3?: boolean;
  /** phones: which tab of the bottom bar is shown */
  tab?: HomeTab; onTab?: (t: HomeTab) => void;
}) {
  useAiOn(); // the privacy lines change with the AI switch
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => listRecent().then((l) => { if (alive) setRecent(l); });
    load();
    const off = onRecentChange(load);
    return () => { alive = false; off(); };
  }, []);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [legal, setLegal] = useState<LegalPage | null>(null);
  // a PDF opens; other files (pictures, Office files) are turned into one first
  const { over, bind: drop } = useFileDrop((f) => { const pdf = f.find(isPdf); if (pdf || !onImport) onFile(pdf ?? f[0]); else onImport(f); });

  // paste a PDF (Ctrl+V) anywhere on the start screen
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(isPdf);
      if (f) { e.preventDefault(); onFile(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile]);

  const idle = state.kind === 'idle';
  let card: React.ReactNode;
  if (over) {
    card = (
      <div className="s2-card over" aria-live="polite">
        <div className="s2-tile y"><Icon name="hand-grabbing:bold" size={28} /></div>
        <div className="s2-ct"><b>{t('Release to open')}</b><span>{t('Drop your PDF anywhere on this page')}</span></div>
      </div>
    );
  } else if (state.kind === 'loading') {
    const pct = Math.round(state.progress * 100);
    card = (
      <div className="s2-card row" role="status" aria-live="polite">
        <div className="s2-mini" aria-hidden="true"><i className="t" /><i /><i /><i className="s" /><i /><span className="scan" /></div>
        <div className="s2-load">
          <div className="top"><b>Opening {state.name}</b>{state.total ? <span className="num">{state.done ?? 0} / {state.total}</span> : <span className="num">{pct}%</span>}</div>
          <div className="s2-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('Opening')}><div style={{ width: `${Math.max(4, pct)}%` }} /></div>
          <span className="sub">{state.done !== undefined ? t('Reading fonts so your edits match the original') : state.detail}</span>
        </div>
      </div>
    );
  } else if (state.kind === 'password') {
    card = (
      <form className="s2-card stack" onSubmit={(e) => { e.preventDefault(); if (pw) onPassword(pw); }}>
        <div className="s2-head"><div className="s2-tile warn"><Icon name="lock-key:fill" size={26} /></div>
          <div className="s2-ct"><b>{t('This PDF is password-protected')}</b>
            <span>{state.wrong ? t('That password didn’t work. Try again.') : t('Enter the password for {name}. It’s checked on this device only.', { name: state.name })}</span></div></div>
        <div className="pw">
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Password')} autoFocus aria-label={t('Password')} />
          <button className="btn primary lg" type="submit" disabled={!pw}>{t('Unlock')}</button>
        </div>
        <button type="button" className="btn ghost" onClick={onPick}><Icon name="open" size={17} />{t('Choose another file')}</button>
      </form>
    );
  } else if (state.kind === 'error') {
    card = (
      <div className="s2-card stack" role="alert">
        <div className="s2-head"><div className="s2-tile err"><Icon name="warning-circle" size={28} /></div>
          <div className="s2-ct"><b>{t('This file couldn’t be opened')}</b><span>{state.message}</span></div></div>
        <button className="btn primary lg" onClick={onPick}><Icon name="open" size={18} />{t('Choose another file')}</button>
      </div>
    );
  } else {
    card = (
      <div className="s2-card drop" onClick={onPick}>
        <svg className="dash" aria-hidden="true"><rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" pathLength="1000" /></svg>
        <div className="s2-head">
          <div className="s2-tile"><Icon name="file-arrow-up:bold" size={28} /></div>
          <div className="s2-ct"><b>{mobile ? t('Open a PDF') : t('Drop a PDF anywhere')}</b><span>{mobile ? t('From Files, Drive or Downloads') : t('Or paste one with Ctrl+V')}</span></div>
        </div>
        <button className="btn primary xl s2-cta" onClick={(e) => { e.stopPropagation(); onPick(); }}>{t('Choose PDF')}<Icon name="arrow-right:bold" size={18} /></button>
      </div>
    );
  }

  if (v3) {
    const tiles = mobile ? QUICK.filter(([q]) => q === 'sign' || q === 'fill' || q === 'combine' || q === 'tools') : QUICK;
    const cls = `start h3${mobile ? ' p' : ' t'}${over ? ' dragging' : ''}`;
    // opening: the page skeleton with real progress, instead of the home
    if (state.kind === 'loading') {
      const pct = Math.round(state.progress * 100);
      return (
        <div className={`${cls} h3-opening`} role="status" aria-live="polite">
          <header className="h3-isl">
            <span className="h3-ipill"><b>{state.name}</b><small>{t('Opening…')}</small></span>
          </header>
          <div className="h3-skel" aria-hidden="true">
            <i className="t" /><i className="s" /><i /><i className="w" /><i /><i className="s" /><i className="w" /><i /><span className="scan" />
          </div>
          <div className="h3-prog">
            <span className="ring" style={{ ['--p' as any]: Math.max(4, pct) }}><b className="num">{pct}%</b></span>
            <span className="tx"><b>{t('Opening {name}', { name: state.name })}</b>
              <small>{state.total ? t('Page {p} of {n}', { p: state.done ?? 0, n: state.total }) + ' · ' + t('matching fonts') : state.detail}</small></span>
            <span className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('Opening')}><i style={{ width: `${Math.max(4, pct)}%` }} /></span>
          </div>
        </div>
      );
    }
    const sheet = state.kind === 'password' || state.kind === 'error';
    const sheetEl = sheet ? (
          <div className={`scrim${mobile ? ' sheet' : ''} h3-scrim`}>
            {state.kind === 'password' ? (
              <form className="modal h3-sheet" role="dialog" aria-modal="true" aria-label={t('This PDF is password-protected')} onSubmit={(e) => { e.preventDefault(); if (pw) onPassword(pw); }}>
                <div className="grab" />
                <span className="h3-sic warn"><Icon name="lock-key:fill" size={26} /></span>
                <h2>{t('This PDF is password-protected')}</h2>
                <p>{state.wrong ? t('That password didn’t work. Try again.') : t('Enter the password for {name}. It’s checked on this device only.', { name: state.name })}</p>
                <label className="h3-pw"><span>{t('Password')}</span>
                  <span className="f"><input className="input" type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus aria-invalid={state.wrong || undefined} />
                    <button type="button" className="ibtn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t('Hide password') : t('Show password')} aria-pressed={showPw}><Icon name={showPw ? 'eye-slash' : 'eye'} size={20} /></button></span>
                </label>
                <div className="h3-sacts">
                  <button type="button" className="btn outline lg" onClick={onPick}>{t('Choose another file')}</button>
                  <button className="btn primary lg" type="submit" disabled={!pw}><Icon name="lock-key-open" size={18} />{t('Unlock')}</button>
                </div>
              </form>
            ) : state.kind === 'error' ? (
              <div className="modal h3-sheet" role="alertdialog" aria-modal="true" aria-label={t('This file couldn’t be opened')}>
                <div className="grab" />
                <span className="h3-sic err"><Icon name="warning-circle" size={28} /></span>
                <h2>{t('This file couldn’t be opened')}</h2>
                <p>{state.message}</p>
                <div className="h3-sacts"><button className="btn primary lg" onClick={onPick} autoFocus><Icon name="open" size={18} />{t('Choose another file')}</button></div>
              </div>
            ) : null}
          </div>
    ) : null;
    if (mobile) return <PhoneHome {...{ state, recent, over, drop, card, onPick, onQuick, onRecent, onShareRecent, theme, onTheme, isNative, tab, onTab, legal, setLegal }} sheet={sheetEl} />;
    return (
      <div className={cls} {...drop}>
        <div className="h3-main" inert={sheet || undefined}>
          <header className="h3-nav">
            <LogoMark size={40} />
            <span className="h3-brand">{t('Paginka')}</span>
            <span className="sp" />
            {!mobile && <button className="h3-round" onClick={onTools} aria-label={t('All tools')} title={t('All tools')}><Icon name="tools" size={19} /></button>}
            <LangButton round />
            <ThemeButton theme={theme} onToggle={onTheme} round />
          </header>
          <div className="h3-top">
            <div className="h3-copy">
              <h1>{t('Edit any PDF.')}<br /><span className="mk">{t('Right here.')}</span></h1>
              {!mobile && <p className="h3-lead">{isNative ? t('Retype existing text in its original font, sign, fill forms, scan, merge and convert. Offline, on this device.') : t('Retype existing text in its original font, sign, fill forms, scan, merge and convert. All in your browser, all offline.')}</p>}
              {!mobile && <div className="h3-priv"><span><Icon name="lock-simple:fill" size={17} /></span><span><b>{t('Files stay on this device.')}</b> {t(aiAllowed() ? 'Nothing is uploaded unless you use AI.' : 'Nothing is uploaded, ever.')}</span></div>}
            </div>
            {over ? card : (
              <div className="h3-card" onClick={onPick}>
                <div className="h3-sheets" aria-hidden="true"><i className="b" /><i className="f"><em className="t" /><em /><em className="w" /><em className="y" /><em className="s" /></i></div>
                <div className="h3-ct"><b>{t('Open a PDF')}</b><span>{isNative ? t('From your files, Drive, or share one to this app') : mobile ? t('From Files, Drive or Downloads') : t('From your files, or drop one anywhere')}</span></div>
                <div className="h3-acts">
                  <button className="h3-choose" onClick={(e) => { e.stopPropagation(); onPick(); }}>{t('Choose PDF')}<Icon name="arrow-right:bold" size={18} /></button>
                  <button className="h3-cam" onClick={(e) => { e.stopPropagation(); onQuick('scan'); }} aria-label={t('Scan with camera')} title={t('Scan with camera')}><Icon name="camera" size={22} /></button>
                </div>
              </div>
            )}
          </div>
          {!over && recent.length > 0 && (
            <section className="h3-sec" aria-label={t('Recent documents')}>
              <div className="h3-sh"><h2>{t('Recent')}</h2><span>{t('Kept on this device only')}</span></div>
              <div className="h3-rec">
                {recent.map((d) => (
                  <div key={d.id} className={`h3-rc${d.hasBytes ? '' : ' off'}`}>
                    <button className="ro" onClick={() => d.hasBytes && onRecent(d)} disabled={!d.hasBytes} aria-label={t('Open {name}', { name: d.name })}>
                      <span className="th">{d.thumb ? <img src={d.thumb} alt="" draggable={false} /> : <Icon name="file-pdf:duotone" size={30} />}
                        {d.kind !== 'opened' && <i className="bd">{d.kind === 'edited' ? t('Edited') : t('Scanned')}</i>}</span>
                      <b title={d.name}>{d.name.replace(/\.pdf$/i, '')}</b>
                      <small>{tn(d.pages, '{n} page', '{n} pages')} · {ago(d.at)}</small>
                    </button>
                    <span className="ra">
                      {d.hasBytes && onShareRecent && <button onClick={() => onShareRecent(d)} aria-label={t('Share {name}', { name: d.name })} title={t('Share')}><Icon name="share-network" size={15} /></button>}
                      <button onClick={() => removeRecent(d.id)} aria-label={t('Remove {name} from the list', { name: d.name })} title={t('Remove from the list')}><Icon name="x" size={14} /></button>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {!over && (
            <section className="h3-sec" aria-label={t('Quick tools')}>
              <div className="h3-sh"><h2>{t('Tools')}</h2></div>
              <div className="h3-tools">
                {tiles.map(([q, label, icon, bg]) => (
                  <button key={q} className="h3-tile" onClick={() => onQuick(q)}>
                    <span style={{ background: bg }}><Icon name={icon} size={22} /></span>{q === 'tools' ? t('All tools') : t(label)}
                  </button>
                ))}
              </div>
            </section>
          )}
          {mobile && <div className="h3-priv"><span><Icon name="lock-simple:fill" size={17} /></span><span><b>{t('Files stay on this phone.')}</b> {t(aiAllowed() ? 'Nothing is uploaded unless you use AI.' : 'Nothing is uploaded, ever.')}</span></div>}
          <footer className="h3-foot"><LegalLinks onOpen={setLegal} /></footer>
        </div>
        {sheetEl}
        {legal && <LegalSheet page={legal} onClose={() => setLegal(null)} />}
      </div>
    );
  }

  return (
    <div className={`start${over ? ' dragging' : ''}`} {...drop}>
      <div className="s2-glow" aria-hidden="true" />
      <header className="s2-nav">
        <LogoMark />
        <span className="s2-brand">{t('Paginka')}</span>
        <span className="sp" />
        {mobile
          ? <button className="s2-navbtn" onClick={onTools} aria-label={t('All tools')}><Icon name="tools" size={18} /><span className="lbl">{t('Tools')}</span></button>
          : <button className="s2-navbtn" onClick={onTools}><Icon name="tools" size={18} />{t('All tools')}</button>}
        {!mobile && !isNative && <a className="s2-navbtn" href={ANDROID_URL} target="_blank" rel="noopener noreferrer"><Icon name="android-logo" size={18} />{t('Android app')}</a>}
        <LangButton round />
        <ThemeButton theme={theme} onToggle={onTheme} round />
      </header>
      <main className="s2-hero">
        <div className="s2-copy">
          <div className="s2-pill"><span className="lk"><Icon name="lock" size={13} /></span>{t(aiAllowed() ? 'Files stay on your device unless you use AI' : 'Files never leave your device')}</div>
          <h1>{t('Edit any PDF.')}<br /><span className="mk">{t('Right here.')}</span></h1>
          <p className="s2-lead">{mobile ? t('Change text in its own font, sign, fill, scan and merge. Offline, on your phone.') : t('Retype existing text in its original font, sign, fill forms, scan, merge and convert. All in your browser, all offline.')}</p>
          {card}
          {idle && !over && (
            <div className="s2-chips" role="list" aria-label={t('Quick tools')}>
              {QUICK.map(([q, label, icon, bg]) => (
                <button key={q} role="listitem" className="s2-chip" onClick={() => onQuick(q)}>
                  <span style={{ background: bg }}><Icon name={icon} size={18} /></span>{t(label)}
                </button>
              ))}
            </div>
          )}
        </div>
        {!mobile && <Demo />}
      </main>
      {idle && !over && recent.length > 0 && (
        <section className="s2-recent" aria-label={t('Recent documents')}>
          <div className="rh"><h2>{t('Recent')}</h2><span className="rs">{t('Kept on this device only')}</span></div>
          <div className="rl">
            {recent.map((d) => (
              <div key={d.id} className={`rc${d.hasBytes ? '' : ' off'}${d.hasBytes && onShareRecent ? ' sh' : ''}`}>
                <button className="ro" onClick={() => d.hasBytes && onRecent(d)} disabled={!d.hasBytes} aria-label={t('Open {name}', { name: d.name })}>
                  <span className="rt">{d.thumb ? <img src={d.thumb} alt="" draggable={false} /> : <Icon name="file-pdf:duotone" size={26} />}</span>
                  <span className="ri">
                    <b title={d.name}>{d.name.replace(/\.pdf$/i, '')}</b>
                    <span><i className={`rk ${d.kind}`}>{d.kind === 'edited' ? t('Edited') : d.kind === 'scanned' ? t('Scanned') : t('Opened')}</i>{tn(d.pages, '{n} page', '{n} pages')} · {ago(d.at)}</span>
                  </span>
                </button>
                {d.hasBytes && onShareRecent && <button className="rsh" onClick={() => onShareRecent(d)} aria-label={t('Share {name}', { name: d.name })} title={t('Share')}><Icon name="share-network" size={17} /></button>}
                <button className="rx" onClick={() => removeRecent(d.id)} aria-label={t('Remove {name} from the list', { name: d.name })} title={t('Remove from the list')}><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
      <footer className="s2-foot"><LegalLinks onOpen={setLegal} /></footer>
      {legal && <LegalSheet page={legal} onClose={() => setLegal(null)} />}
    </div>
  );
}

/** Decorative: three floating sheets; the front one shows an edit, a highlight sweep and a signature. */
function Demo() {
  return (
    <div className="s2-art" aria-hidden="true">
      <div className="sheet back l" />
      <div className="sheet back r" />
      <div className="sheet front">
        <div className="ttl">{t('Lease Agreement')}</div>
        <div className="ln" />
        <div className="edit">{t('and')} <span className="box">{t('Maya R. Okafor')}</span><span className="caret" /></div>
        <div className="ln" style={{ width: '92%' }} />
        <div className="hl"><span className="ln" /><span className="sweep" /></div>
        <div className="ln" style={{ width: '84%' }} />
        <div className="ln" style={{ width: '70%' }} />
        <div className="sp" />
        <div className="sig">
          <div className="bar"><span><Icon name="move" size={14} /></span><span><Icon name="copy" size={14} /></span><span className="del"><Icon name="trash" size={14} /></span></div>
          <div className="name">{t('Jordan Ellis')}</div>
          <div className="lbl">{t('Tenant signature')}</div>
        </div>
      </div>
      <div className="s2-badge"><span><Icon name="check" size={16} /></span><span className="t">{t('Font matched')}<small>{t('Source Serif · 11 pt')}</small></span></div>
    </div>
  );
}

/** Phones: the home tab (continue card, quick tools, recent files) and the Files tab; the bottom bar
 *  that switches between them lives in the app (BottomNav). */
function PhoneHome({ state, recent, over, drop, card, onPick, onQuick, onRecent, onShareRecent, theme, onTheme, isNative, tab, onTab, legal, setLegal, sheet }: {
  state: OpenState; recent: RecentDoc[]; over: boolean; drop: any; card: React.ReactNode;
  onPick: () => void; onQuick: (q: QuickAction) => void; onRecent: (d: RecentDoc) => void; onShareRecent?: (d: RecentDoc) => void;
  theme: Theme; onTheme: () => void; isNative?: boolean; tab: HomeTab; onTab?: (t: HomeTab) => void;
  legal: LegalPage | null; setLegal: (p: LegalPage | null) => void; sheet: React.ReactNode;
}) {
  useBack(() => onTab?.('home'), tab === 'files' && !!onTab);
  const [menu, setMenu] = useState(false);
  const [lang, setLang] = useLang();
  const last = recent.find((d) => d.hasBytes);
  const rest = recent.filter((d) => d !== last);
  const row = (d: RecentDoc) => (
    <div key={d.id} className={`hx-row${d.hasBytes ? '' : ' off'}`}>
      <button className="ro" onClick={() => d.hasBytes && onRecent(d)} disabled={!d.hasBytes} aria-label={t('Open {name}', { name: d.name })}>
        <span className="th">{d.thumb ? <img src={d.thumb} alt="" draggable={false} /> : <Icon name="file-pdf:duotone" size={24} />}</span>
        <span className="tx">
          <b title={d.name}>{d.name.replace(/\.pdf$/i, '')}</b>
          <small>{d.kind !== 'opened' && <i className={`pill ${d.kind}`}>{d.kind === 'edited' ? t('Edited') : t('Scanned')}</i>}<span className="num">{tn(d.pages, '{n} page', '{n} pages')} · {ago(d.at)}</span></small>
        </span>
      </button>
      {d.hasBytes && onShareRecent && <button className="ra" onClick={() => onShareRecent(d)} aria-label={t('Share {name}', { name: d.name })} title={t('Share')}><Icon name="share-network" size={19} /></button>}
      <button className="ra" onClick={() => removeRecent(d.id)} aria-label={t('Remove {name} from the list', { name: d.name })} title={t('Remove from the list')}><Icon name="x" size={18} /></button>
    </div>
  );
  const top = (
    <header className="hx-nav">
      <LogoMark size={36} />
      <span className="hx-brand">{tab === 'files' ? t('Files') : t('Paginka')}</span>
      <span className="sp" />
      <ThemeButton theme={theme} onToggle={onTheme} round />
      <button className="s2-round hx-menubtn" onClick={() => setMenu(true)} aria-label={t('Menu')} aria-haspopup="dialog" title={t('Menu')}><Icon name="list" size={20} /></button>
    </header>
  );
  const QT: [QuickAction, string, string, string, string][] = [
    ['sign', 'Sign', 'Draw or type your name', 'signature:duotone', '#FFE14D'],
    ['fill', 'Fill a form', 'Type into any form', 'textbox:duotone', '#DDE2FF'],
    ['combine', 'Combine', 'Merge PDFs into one', 'stack:duotone', '#E3F1E9'],
    ['convert', 'Convert', 'Photos, Word, Excel to PDF', 'file-arrow-down:duotone', '#FCE3D8'],
  ];
  return (
    <div className={`start hx${over ? ' dragging' : ''}`} {...drop}>
      <div className="hx-main" inert={!!sheet || undefined} key={tab}>
        {top}
        {tab === 'files' ? (
          <>
            <p className="hx-sub"><Icon name="lock-simple:fill" size={14} />{t('Kept on this device only')}</p>
            {recent.length ? <div className="hx-list">{recent.map(row)}</div> : (
              <div className="hx-empty">
                <span className="ic"><Icon name="files:duotone" size={34} /></span>
                <b>{t('No files yet')}</b>
                <span>{t('PDFs you open, edit or scan show up here.')}</span>
                <button className="hx-cta" onClick={onPick}>{t('Choose PDF')}<Icon name="arrow-right:bold" size={18} /></button>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className={`hx-h1${last ? ' sm' : ''}`}>{t('Edit any PDF.')}<br /><span className="mk">{t('Right here.')}</span></h1>
            {over ? card : last ? (
              <div className="hx-hero cont">
                <button className="hx-doc" onClick={() => onRecent(last)} aria-label={t('Open {name}', { name: last.name })}>
                  <span className="th">{last.thumb ? <img src={last.thumb} alt="" draggable={false} /> : <Icon name="file-pdf:duotone" size={30} />}</span>
                  <span className="tx">
                    <small>{t('Continue editing')}</small>
                    <b>{last.name.replace(/\.pdf$/i, '').replace(/([-_.])/g, '$1\u200b')}</b>
                    <span className="num">{tn(last.pages, '{n} page', '{n} pages')} · {ago(last.at)}</span>
                  </span>
                </button>
                <div className="hx-acts">
                  <button className="hx-cta" onClick={() => onRecent(last)}>{t('Open')}<Icon name="arrow-right:bold" size={18} /></button>
                  <button className="hx-ghost" onClick={onPick}><Icon name="file-plus" size={19} />{t('Another PDF')}</button>
                </div>
              </div>
            ) : (
              <div className="hx-hero" onClick={onPick}>
                <div className="hx-sheets" aria-hidden="true"><i className="b" /><i className="f"><em className="t" /><em /><em className="w" /><em className="y" /><em /></i></div>
                <div className="tx"><b>{t('Open a PDF')}</b><span>{isNative ? t('From your files, Drive, or share one to this app') : t('From Files, Drive or Downloads')}</span></div>
                <div className="hx-acts">
                  <button className="hx-cta" onClick={(e) => { e.stopPropagation(); onPick(); }}>{t('Choose PDF')}<Icon name="arrow-right:bold" size={18} /></button>
                </div>
              </div>
            )}
            {!over && (
              <section className="hx-sec" aria-label={t('Quick tools')}>
                <h2>{t('Quick tools')}</h2>
                <div className="hx-tools">
                  {QT.map(([q, label, desc, icon, bg]) => (
                    <button key={q} className="hx-tool" onClick={() => onQuick(q)}>
                      <span className="ic" style={{ background: bg }}><Icon name={icon} size={21} /></span>
                      <span className="tx"><b>{t(label)}</b><small>{t(desc)}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!over && rest.length > 0 && (
              <section className="hx-sec" aria-label={t('Recent documents')}>
                <h2>{t('Recent')}{onTab && rest.length > 2 && <button className="hx-all" onClick={() => onTab('files')}>{t('See all')}<Icon name="right" size={14} /></button>}</h2>
                <div className="hx-list">{rest.slice(0, 2).map(row)}</div>
              </section>
            )}
            {!over && <p className="hx-priv"><Icon name="lock-simple:fill" size={14} /><span><b>{t('Files stay on this phone.')}</b> {t(aiAllowed() ? 'Nothing is uploaded unless you use AI.' : 'Nothing is uploaded, ever.')}</span></p>}
          </>
        )}
      </div>
      {sheet}
      {menu && <HomeMenu lang={lang} setLang={setLang} theme={theme} onTheme={onTheme} onLegal={setLegal} onClose={() => setMenu(false)} />}
      {legal && <LegalSheet page={legal} onClose={() => setLegal(null)} />}
    </div>
  );
}

/** Phones: the home menu (language, appearance, legal pages) as a bottom sheet. */
function HomeMenu({ lang, setLang, theme, onTheme, onLegal, onClose }: {
  lang: string; setLang: (l: 'de' | 'en') => void; theme: Theme; onTheme: () => void; onLegal: (p: LegalPage) => void; onClose: () => void;
}) {
  useBack(onClose);
  const LI: Record<LegalPage, string> = { impressum: 'identification-card', privacy: 'shield-check', terms: 'file-text', licenses: 'code' };
  const aiOn = useAiOn();
  const [ask, setAsk] = useState(false);
  return (
    <div className="scrim sheet" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal hx-msheet" role="dialog" aria-modal="true" aria-label={t('Menu')}>
        <div className="grab" />
        <div className="mhead"><h2>{t('Menu')}</h2><button className="ibtn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button></div>
        <div className="hx-mgrp">
          <div className="hx-mrow"><span className="ic"><Icon name="translate" size={19} /></span><b>{t('Language')}</b>
            <span className="hx-seg" role="radiogroup" aria-label={t('Language')}>
              <button role="radio" aria-checked={lang === 'de'} className={lang === 'de' ? 'on' : ''} onClick={() => setLang('de')}>Deutsch</button>
              <button role="radio" aria-checked={lang !== 'de'} className={lang !== 'de' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
            </span></div>
          <button className="hx-mrow link" onClick={() => setAsk(true)}><span className="ic"><Icon name="sparkle" size={19} /></span><b>{t('AI assistant')}</b>
            <span className="hx-ai-st">{aiOn ? t('On|ai') : t('Off|ai')}</span><Icon name="right" size={16} /></button>
          <div className="hx-mrow"><span className="ic"><Icon name={theme === 'dark' ? 'moon' : 'sun'} size={19} /></span><b>{t('Appearance')}</b>
            <span className="hx-seg" role="radiogroup" aria-label={t('Appearance')}>
              <button role="radio" aria-checked={theme !== 'dark'} className={theme !== 'dark' ? 'on' : ''} onClick={() => theme === 'dark' && onTheme()}>{t('Light|theme')}</button>
              <button role="radio" aria-checked={theme === 'dark'} className={theme === 'dark' ? 'on' : ''} onClick={() => theme !== 'dark' && onTheme()}>{t('Dark|theme')}</button>
            </span></div>
        </div>
        <span className="kicker">{t('Legal')}</span>
        <nav className="hx-mgrp" aria-label={t('Legal')}>
          {LEGAL_PAGES.map(([p, label]) => (
            <a key={p} className="hx-mrow link" href={legalUrl(p)} onClick={(e) => { e.preventDefault(); onLegal(p); }}>
              <span className="ic"><Icon name={LI[p]} size={19} /></span><b>{t(label)}</b><Icon name="right" size={16} />
            </a>
          ))}
        </nav>
        {ask && <AiConsent sheet why="" settings onAnswer={() => setAsk(false)} />}
        <p className="hx-mnote"><Icon name="lock-simple:fill" size={14} />{t('Files stay on this phone.')} {t(aiAllowed() ? 'Nothing is uploaded unless you use AI.' : 'Nothing is uploaded, ever.')}</p>
      </div>
    </div>
  );
}

/** Phones: the rounded bottom bar of the home screens (Home, Files, open a PDF, Scan, Tools). */
export function BottomNav({ active, onHome, onFiles, onOpen, onScan, onTools }: {
  active: 'home' | 'files' | 'tools'; onHome: () => void; onFiles: () => void; onOpen: () => void; onScan: () => void; onTools: () => void;
}) {
  const fit = useFitLabels<HTMLElement>();
  const item = (k: string, label: string, icon: string, go: () => void) => {
    const on = active === k;
    return (
      <button key={k} className={`bn-it${on ? ' on' : ''}`} onClick={go} aria-current={on ? 'page' : undefined} data-tab={k}>
        <span className="ic"><Icon name={icon} size={22} weight={on ? 'fill' : 'regular'} /></span><span className="lb">{label}</span>
      </button>
    );
  };
  return (<>
    <div className="bnav-fade" aria-hidden="true" />
    <nav className="bnav" aria-label={t('Main')} ref={fit}>
      {item('home', t('Home|nav'), 'house', onHome)}
      {item('files', t('Files'), 'files', onFiles)}
      <button className="bn-open" onClick={onOpen} aria-label={t('Open a PDF')} title={t('Open a PDF')}><Icon name="plus:bold" size={26} /></button>
      {item('scan', t('Scan'), 'scan', onScan)}
      {item('tools', t('Tools|nav'), 'squares-four', onTools)}
    </nav>
  </>
  );
}
