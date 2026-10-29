// Find text in the document, and the privacy check (personal data found and blacked out in one go).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { findText, privacyScan, KIND_LABEL, type DocRef, type Hit, type Kind } from './search';

export function FindBar({ doc, onHits, onGo, onRedact, onClose, mobile }: {
  doc: () => DocRef; onHits: (h: Hit[], cur: number) => void; onGo: (h: Hit) => void;
  onRedact: (h: Hit[]) => void; onClose: () => void; mobile: boolean;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [cur, setCur] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  // desktop: centred over the page area, so it stays clear of the Pages / properties panels beside it
  const bar = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<React.CSSProperties | undefined>();
  useLayoutEffect(() => {
    if (mobile) { setPlace(undefined); return; }
    const fit = () => {
      const el = bar.current, wrap = document.querySelector('.canvasWrap') as HTMLElement | null, par = el?.offsetParent as HTMLElement | null;
      if (!el || !wrap || !par) return;
      const w = wrap.getBoundingClientRect(), o = par.getBoundingClientRect();
      setPlace({ left: w.left - o.left + w.width / 2, width: Math.min(560, w.width - 24) });
    };
    fit();
    const wrap = document.querySelector('.canvasWrap');
    const ro = typeof ResizeObserver !== 'undefined' && wrap ? new ResizeObserver(fit) : null;
    if (wrap) ro?.observe(wrap);
    window.addEventListener('resize', fit);
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
  }, [mobile]);
  useEffect(() => {
    if (!q.trim()) { setHits([]); onHits([], -1); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(async () => {
      const h = await findText(doc(), q);
      if (!alive) return;
      setBusy(false);
      setHits(h); setCur(0); onHits(h, 0);
      if (h[0]) onGo(h[0]);
    }, 220);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const step = (d: number) => {
    if (!hits.length) return;
    const n = (cur + d + hits.length) % hits.length;
    setCur(n); onHits(hits, n); onGo(hits[n]);
  };
  return (
    <div ref={bar} className={`findbar${mobile ? ' m' : ''}`} role="search" style={place}>
      <Icon name="magnifying-glass" size={18} />
      <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in document" aria-label="Find in document"
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') onClose(); }} />
      <span className="fcount" aria-live="polite">{busy ? '…' : q.trim() ? (hits.length ? `${cur + 1}/${hits.length}` : '0') : ''}</span>
      <button className="ibtn" onClick={() => step(-1)} disabled={!hits.length} aria-label="Previous match"><Icon name="caret-up:bold" size={16} /></button>
      <button className="ibtn" onClick={() => step(1)} disabled={!hits.length} aria-label="Next match"><Icon name="caret-down:bold" size={16} /></button>
      <button className="ibtn" onClick={() => onRedact(hits)} disabled={!hits.length} aria-label="Black out all matches" title="Black out all matches (redact)"><Icon name="eye-slash" size={18} /></button>
      <button className="ibtn" onClick={onClose} aria-label="Close search"><Icon name="close" size={17} /></button>
    </div>
  );
}

const mask = (s: string) => {
  const t = s.trim();
  if (t.length <= 6) return t[0] + '•'.repeat(Math.max(1, t.length - 1));
  return t.slice(0, 3) + ' •••• ' + t.slice(-3);
};

export function PrivacyCheck({ doc, scannedLeft, onHits, onGo, onRedact, onClose, onReadScans, mobile }: {
  doc: () => DocRef; scannedLeft: number; onHits: (h: Hit[]) => void; onGo: (h: Hit) => void;
  onRedact: (h: Hit[]) => void; onClose: () => void; onReadScans?: () => void; mobile: boolean;
}) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [off, setOff] = useState<Set<Kind>>(new Set());
  useEffect(() => {
    let alive = true;
    privacyScan(doc()).then((h) => { if (!alive) return; setHits(h); onHits(h); }).catch(() => { if (alive) setHits([]); });
    return () => { alive = false; onHits([]); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedLeft]);
  const kinds = (Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ k, list: (hits ?? []).filter((h) => h.kind === k) })).filter((x) => x.list.length);
  const chosen = (hits ?? []).filter((h) => !off.has(h.kind as Kind));
  const toggle = (k: Kind) => setOff((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); onHits((hits ?? []).filter((h) => !n.has(h.kind as Kind))); return n; });
  return (
    <>
      {mobile && <div className="sheet-scrim" onClick={onClose} />}
      <div className={mobile ? 'bsheet privsheet' : 'privpanel'} role="dialog" aria-label="Privacy check">
        {mobile && <div className="grab" />}
        <div className="props">
          <div className="ap-h">
            <div><h3><Icon name="shield-check:duotone" size={22} />Privacy check</h3><span className="label">Personal data in this document, found on this device</span></div>
            <button className="ibtn muted" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
          {hits === null ? <div className="pc-wait"><span className="spinner" />Looking through the pages…</div> : !kinds.length ? (
            <div className="note"><Icon name="check" size={16} /><span>Nothing found: no bank accounts, ID or social security numbers, birth dates, phone numbers or e-mail addresses.</span></div>
          ) : (
            <div className="pc-list">
              {kinds.map(({ k, list }) => (
                <div key={k} className={`pc-k${off.has(k) ? ' off' : ''}`}>
                  <label className="pc-top">
                    <input type="checkbox" checked={!off.has(k)} onChange={() => toggle(k)} />
                    <span className="pc-t"><b>{KIND_LABEL[k][0]}</b>{KIND_LABEL[k][1] && <span>{KIND_LABEL[k][1]}</span>}</span>
                    <span className="pc-n">{list.length}</span>
                  </label>
                  <div className="pc-vals">
                    {list.slice(0, 4).map((h, i) => <button key={i} onClick={() => onGo(h)} title="Show on the page">{mask(h.text)}<small>p.{h.page + 1}</small></button>)}
                    {list.length > 4 && <span>+{list.length - 4}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {scannedLeft > 0 && (
            <div className="note warn"><Icon name="info" size={16} /><span>{scannedLeft} scanned {scannedLeft === 1 ? 'page has' : 'pages have'} not been read yet, so they weren’t checked.{onReadScans && <> <button className="linkbtn" onClick={onReadScans}>Read them now</button></>}</span></div>
          )}
          <button className="btn primary lg block" disabled={!chosen.length} onClick={() => onRedact(chosen)}>
            <Icon name="eye-slash" size={18} />{chosen.length ? `Black out ${chosen.length} ${chosen.length === 1 ? 'item' : 'items'}` : 'Nothing to black out'}
          </button>
          <span className="hint">Blacked-out parts are deleted from the file when you download it: they can’t be copied, searched or uncovered. You can still remove a box before that.</span>
        </div>
      </div>
    </>
  );
}
