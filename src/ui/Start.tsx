import React, { useRef, useState } from 'react';
import { Icon } from './icons';
import type { Theme } from './hooks';

export type OpenState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string; progress: number; detail: string }
  | { kind: 'password'; name: string; wrong: boolean }
  | { kind: 'error'; message: string };

export function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <button className="ibtn muted" onClick={onToggle} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19} />
    </button>
  );
}

export function Start({ state, onFile, onPick, onPassword, onTools, theme, onTheme, mobile }: {
  state: OpenState; onFile: (f: File) => void; onPick: () => void; onPassword: (pw: string) => void; onTools: () => void;
  theme: Theme; onTheme: () => void; mobile: boolean;
}) {
  const [over, setOver] = useState(false);
  const [pw, setPw] = useState('');
  const depth = useRef(0);
  const drop = {
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); depth.current++; setOver(true); },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); },
  };
  return (
    <div className="start" {...drop}>
      <header className="brandbar">
        <div className="logo" aria-hidden="true" />
        <div className="brand">PDF Editor</div>
        <div className="sp" />
        {!mobile && <div className="offline"><Icon name="offline" size={15} /><span>Works offline</span></div>}
        <button className="btn ghost" onClick={onTools}><Icon name="tools" size={18} />{mobile ? 'Tools' : 'All tools'}</button>
        <ThemeButton theme={theme} onToggle={onTheme} />
      </header>
      <main className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <div className="chip"><Icon name="lock" size={14} />Processed on your device</div>
            <h1>Edit any PDF <mark>without uploading it.</mark></h1>
            <p className="lead">Retype existing text in its original font, sign, fill forms, highlight and reorder pages — all in your browser. Your file never leaves this device.</p>
            <div className="feats">
              <span><Icon name="edit" size={18} />Edit existing text</span>
              <span><Icon name="sign" size={18} />Sign &amp; fill</span>
              <span><Icon name="pages" size={18} />Organize pages</span>
            </div>
          </div>
          <div className={`zone${over ? ' over' : ''}`} aria-live="polite">
            {(state.kind === 'idle') && (
              <>
                <div className="paper-ill" aria-hidden="true"><i /><i /><i /><i /><i /></div>
                <div className="zt">
                  <h2>{over ? 'Drop to open' : mobile ? 'Open a PDF' : 'Drop a PDF here'}</h2>
                  <p>{over ? 'Release anywhere on the page' : mobile ? 'From Files, Drive or Downloads' : 'or choose one from your computer'}</p>
                </div>
                <button className="btn primary xl" onClick={onPick}><Icon name="open" size={19} />Open PDF</button>
                <button className="more-tools" onClick={onTools}>More tools: combine, extract, convert<Icon name="right" size={16} /></button>
              </>
            )}
            {state.kind === 'loading' && (
              <>
                <div className="spinner" role="progressbar" aria-label="Opening" />
                <div className="zt"><h2 style={{ wordBreak: 'break-word' }}>Opening {state.name}</h2><p>{state.detail}</p></div>
                <div className="progress"><div style={{ width: `${Math.round(state.progress * 100)}%` }} /></div>
              </>
            )}
            {state.kind === 'password' && (
              <form className="zt" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); if (pw) onPassword(pw); }}>
                <div className="err-ic"><Icon name="lock-key:fill" size={28} /></div>
                <div className="zt"><h2>This PDF is password-protected</h2>
                  <p>{state.wrong ? 'That password didn’t work. Try again.' : `Enter the password for ${state.name}. It’s checked on this device only.`}</p></div>
                <div className="pw">
                  <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus aria-label="Password" />
                  <button className="btn primary" style={{ height: 44 }} type="submit" disabled={!pw}>Unlock</button>
                </div>
                <button type="button" className="btn ghost" onClick={onPick}><Icon name="open" size={17} />Choose another file</button>
              </form>
            )}
            {state.kind === 'error' && (
              <>
                <div className="err-ic"><Icon name="warning-circle" size={28} /></div>
                <div className="zt"><h2>This file couldn’t be opened</h2><p>{state.message}</p></div>
                <div className="acts"><button className="btn primary lg" onClick={onPick}><Icon name="open" size={18} />Choose another file</button></div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
