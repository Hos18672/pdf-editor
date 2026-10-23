import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { appBase } from './assets';
import type { Theme } from './hooks';
import { ago, listRecent, onRecentChange, removeRecent, type RecentDoc } from './recent';

export type OpenState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string; progress: number; detail: string; done?: number; total?: number }
  | { kind: 'password'; name: string; wrong: boolean }
  | { kind: 'error'; message: string };

export type QuickAction = 'scan' | 'sign' | 'fill' | 'combine' | 'convert' | 'tools';

const ANDROID_URL = 'https://github.com/Hos18672/pdf-editor/releases/latest';

export function ThemeButton({ theme, onToggle, round }: { theme: Theme; onToggle: () => void; round?: boolean }) {
  return (
    <button className={round ? 's2-round' : 'ibtn muted'} onClick={onToggle} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
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

export function Start({ state, onFile, onPick, onPassword, onTools, onQuick, onRecent, onShareRecent, theme, onTheme, mobile, isNative }: {
  state: OpenState; onFile: (f: File) => void; onPick: () => void; onPassword: (pw: string) => void; onTools: () => void;
  onQuick: (q: QuickAction) => void; onRecent: (d: RecentDoc) => void; onShareRecent?: (d: RecentDoc) => void; theme: Theme; onTheme: () => void; mobile: boolean; isNative?: boolean;
}) {
  const [recent, setRecent] = useState<RecentDoc[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => listRecent().then((l) => { if (alive) setRecent(l); });
    load();
    const off = onRecentChange(load);
    return () => { alive = false; off(); };
  }, []);
  const [over, setOver] = useState(false);
  const [pw, setPw] = useState('');
  const depth = useRef(0);
  const isFile = (e: React.DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const drop = {
    onDragEnter: (e: React.DragEvent) => { if (!isFile(e)) return; e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => { if (isFile(e)) e.preventDefault(); },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); },
  };

  // paste a PDF (Ctrl+V) anywhere on the start screen
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
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
        <div className="s2-ct"><b>Release to open</b><span>Drop your PDF anywhere on this page</span></div>
      </div>
    );
  } else if (state.kind === 'loading') {
    const pct = Math.round(state.progress * 100);
    card = (
      <div className="s2-card row" role="status" aria-live="polite">
        <div className="s2-mini" aria-hidden="true"><i className="t" /><i /><i /><i className="s" /><i /><span className="scan" /></div>
        <div className="s2-load">
          <div className="top"><b>Opening {state.name}</b>{state.total ? <span className="num">{state.done ?? 0} / {state.total}</span> : <span className="num">{pct}%</span>}</div>
          <div className="s2-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Opening"><div style={{ width: `${Math.max(4, pct)}%` }} /></div>
          <span className="sub">{state.done !== undefined ? 'Reading fonts so your edits match the original' : state.detail}</span>
        </div>
      </div>
    );
  } else if (state.kind === 'password') {
    card = (
      <form className="s2-card stack" onSubmit={(e) => { e.preventDefault(); if (pw) onPassword(pw); }}>
        <div className="s2-head"><div className="s2-tile warn"><Icon name="lock-key:fill" size={26} /></div>
          <div className="s2-ct"><b>This PDF is password-protected</b>
            <span>{state.wrong ? 'That password didn’t work. Try again.' : `Enter the password for ${state.name}. It’s checked on this device only.`}</span></div></div>
        <div className="pw">
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus aria-label="Password" />
          <button className="btn primary lg" type="submit" disabled={!pw}>Unlock</button>
        </div>
        <button type="button" className="btn ghost" onClick={onPick}><Icon name="open" size={17} />Choose another file</button>
      </form>
    );
  } else if (state.kind === 'error') {
    card = (
      <div className="s2-card stack" role="alert">
        <div className="s2-head"><div className="s2-tile err"><Icon name="warning-circle" size={28} /></div>
          <div className="s2-ct"><b>This file couldn’t be opened</b><span>{state.message}</span></div></div>
        <button className="btn primary lg" onClick={onPick}><Icon name="open" size={18} />Choose another file</button>
      </div>
    );
  } else {
    card = (
      <div className="s2-card drop" onClick={onPick}>
        <svg className="dash" aria-hidden="true"><rect x="0" y="0" width="100%" height="100%" rx="22" ry="22" pathLength="1000" /></svg>
        <div className="s2-head">
          <div className="s2-tile"><Icon name="file-arrow-up:bold" size={28} /></div>
          <div className="s2-ct"><b>{mobile ? 'Open a PDF' : 'Drop a PDF anywhere'}</b><span>{mobile ? 'From Files, Drive or Downloads' : 'Or paste one with Ctrl+V'}</span></div>
        </div>
        <button className="btn primary xl s2-cta" onClick={(e) => { e.stopPropagation(); onPick(); }}>Choose PDF<Icon name="arrow-right:bold" size={18} /></button>
      </div>
    );
  }

  return (
    <div className={`start${over ? ' dragging' : ''}`} {...drop}>
      <div className="s2-glow" aria-hidden="true" />
      <header className="s2-nav">
        <LogoMark />
        <span className="s2-brand">Paginka</span>
        <span className="sp" />
        {mobile
          ? <button className="s2-navbtn" onClick={onTools} aria-label="All tools"><Icon name="tools" size={18} /><span className="lbl">Tools</span></button>
          : <button className="s2-navbtn" onClick={onTools}><Icon name="tools" size={18} />All tools</button>}
        {!mobile && !isNative && <a className="s2-navbtn" href={ANDROID_URL} target="_blank" rel="noopener noreferrer"><Icon name="android-logo" size={18} />Android app</a>}
        <ThemeButton theme={theme} onToggle={onTheme} round />
      </header>
      <main className="s2-hero">
        <div className="s2-copy">
          <div className="s2-pill"><span className="lk"><Icon name="lock" size={13} /></span>Files never leave your device</div>
          <h1>Edit any PDF.<br /><span className="mk">Right here.</span></h1>
          <p className="s2-lead">{mobile ? 'Change text in its own font, sign, fill, scan and merge. Offline, on your phone.' : 'Retype existing text in its original font, sign, fill forms, scan, merge and convert. All in your browser, all offline.'}</p>
          {card}
          {idle && !over && (
            <div className="s2-chips" role="list" aria-label="Quick tools">
              {QUICK.map(([q, label, icon, bg]) => (
                <button key={q} role="listitem" className="s2-chip" onClick={() => onQuick(q)}>
                  <span style={{ background: bg }}><Icon name={icon} size={18} /></span>{label}
                </button>
              ))}
            </div>
          )}
        </div>
        {!mobile && <Demo />}
      </main>
      {idle && !over && recent.length > 0 && (
        <section className="s2-recent" aria-label="Recent documents">
          <div className="rh"><h2>Recent</h2><span className="rs">Kept on this device only</span></div>
          <div className="rl">
            {recent.map((d) => (
              <div key={d.id} className={`rc${d.hasBytes ? '' : ' off'}${d.hasBytes && onShareRecent ? ' sh' : ''}`}>
                <button className="ro" onClick={() => d.hasBytes && onRecent(d)} disabled={!d.hasBytes} aria-label={`Open ${d.name}`}>
                  <span className="rt">{d.thumb ? <img src={d.thumb} alt="" draggable={false} /> : <Icon name="file-pdf:duotone" size={26} />}</span>
                  <span className="ri">
                    <b title={d.name}>{d.name.replace(/\.pdf$/i, '')}</b>
                    <span><i className={`rk ${d.kind}`}>{d.kind === 'edited' ? 'Edited' : d.kind === 'scanned' ? 'Scanned' : 'Opened'}</i>{d.pages} {d.pages === 1 ? 'page' : 'pages'} · {ago(d.at)}</span>
                  </span>
                </button>
                {d.hasBytes && onShareRecent && <button className="rsh" onClick={() => onShareRecent(d)} aria-label={`Share ${d.name}`} title="Share"><Icon name="share-network" size={17} /></button>}
                <button className="rx" onClick={() => removeRecent(d.id)} aria-label={`Remove ${d.name} from the list`} title="Remove from the list"><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
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
        <div className="ttl">Lease Agreement</div>
        <div className="ln" />
        <div className="edit">and <span className="box">Maya R. Okafor</span><span className="caret" /></div>
        <div className="ln" style={{ width: '92%' }} />
        <div className="hl"><span className="ln" /><span className="sweep" /></div>
        <div className="ln" style={{ width: '84%' }} />
        <div className="ln" style={{ width: '70%' }} />
        <div className="sp" />
        <div className="sig">
          <div className="bar"><span><Icon name="move" size={14} /></span><span><Icon name="copy" size={14} /></span><span className="del"><Icon name="trash" size={14} /></span></div>
          <div className="name">Jordan Ellis</div>
          <div className="lbl">Tenant signature</div>
        </div>
      </div>
      <div className="s2-badge"><span><Icon name="check" size={16} /></span><span className="t">Font matched<small>Source Serif · 11 pt</small></span></div>
    </div>
  );
}
