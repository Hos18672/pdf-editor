// The AI assistant's screens: consent, the assistant sheet (overview, ask, reply, personal data),
// rewriting a line, reviewing smart-fill answers and the fields found on a flat form.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBack } from '../back';
import { Icon } from '../icons';
import { t, tn } from '../i18n';
import { ai, aiErrorText, aiErrorMsg, aiReport, aiTarget, answerLang, AiError, type AiLang } from './client';
export { AiConsent } from './Consent';

const LANGS: [AiLang, string][] = [['en', 'English'], ['de', 'Deutsch'], ['fa', 'فارسی']];
const LANG_KEY = 'pe.ai.lang';
const readLang = (): AiLang => { try { const v = localStorage.getItem(LANG_KEY); if (v === 'en' || v === 'de' || v === 'fa') return v; } catch { /* fine */ } return answerLang(); };
const rtl = (l: AiLang) => (l === 'fa' ? 'rtl' : undefined);

export function Sheet({ sheet, cls, label, icon, onClose, children, foot }: {
  sheet: boolean; cls: string; label: string; icon: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode;
}) {
  useBack(onClose);
  return (
    <div className={`scrim${sheet ? ' sheet' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal aimodal ${cls}`} role="dialog" aria-modal="true" aria-label={label} onKeyDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mhead">
          <h2><span className="ai-mark"><Icon name={icon} size={20} /></span>{label}</h2>
          <button className="ibtn" onClick={onClose} aria-label={t('Close')}><Icon name="close" /></button>
        </div>
        {children}
        {foot && <div className="foot">{foot}</div>}
      </div>
    </div>
  );
}

function LangPick({ value, onChange }: { value: AiLang; onChange: (l: AiLang) => void }) {
  return (
    <div className="ai-langs" role="radiogroup" aria-label={t('Answer language')}>
      {LANGS.map(([l, name]) => (
        <button key={l} role="radio" aria-checked={value === l} className={value === l ? 'on' : ''} lang={l} onClick={() => onChange(l)}>{name}</button>
      ))}
    </div>
  );
}

/** Flag an answer as offensive or wrong (Google Play: AI content can be reported inside the app). */
function ReportBtn({ task, text }: { task: string; text: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'done' | 'err'>('idle');
  if (st === 'done') return <span className="ai-reported"><Icon name="check" size={14} />{t('Reported. Thank you.')}</span>;
  return (
    <button className="ibtn ai-flag" disabled={st === 'busy'} title={t('Report this answer')} aria-label={t('Report this answer')}
      onClick={async () => { setSt('busy'); setSt((await aiReport(task, text)) ? 'done' : 'err'); }}>
      <Icon name="flag" size={16} />
    </button>
  );
}

const Spinner = ({ label }: { label: string }) => (
  <div className="ai-wait" role="status"><span className="spinner" /><span>{label}</span></div>
);

// ---------------------------------------------------------------- rewrite
type RewriteAct = 'improve' | 'shorten' | 'fix' | 'formal' | 'friendly' | 'simple' | 'longer' | 'translate' | 'custom';
const ACTS: [RewriteAct, string, string][] = [
  ['fix', 'Fix spelling', 'check'], ['improve', 'Improve', 'sparkle'], ['shorten', 'Shorter', 'arrows-in-simple'], ['longer', 'Longer', 'arrows-out-simple:bold'],
  ['formal', 'More formal', 'article'], ['friendly', 'Friendlier', 'chat-centered-text'], ['simple', 'Simpler', 'text-aa'],
];

/** Rewrite a line or a text box with AI; the result keeps the line's font (it is just new text). */
export function AiRewrite({ sheet, text, oneLine, maxChars, context, onApply, onClose }: {
  sheet: boolean; text: string; oneLine: boolean; maxChars?: number; context?: string;
  onApply: (text: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async (action: RewriteAct, extra: Record<string, unknown> = {}) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(action); setErr(null);
    try {
      const r = await ai<{ text: string }>('rewrite', { text: out ?? text, action, oneLine, maxChars, context, ...extra }, c.signal);
      const v = oneLine ? r.text.replace(/\s*\n\s*/g, ' ').trim() : r.text.trim();
      setOut(v);
    } catch (e) { if (!(e instanceof AiError && e.code === 'aborted')) setErr(aiErrorMsg(e, t)); } finally { if (ctl.current === c) setBusy(null); }
  };
  return (
    <Sheet sheet={sheet} cls="ai-rewrite" label={t('Rewrite with AI')} icon="sparkle:fill" onClose={onClose}
      foot={<>
        {out !== null && <button className="btn outline lg ai-icon" onClick={() => setOut(null)} aria-label={t('Start over')} title={t('Start over')}><Icon name="arrow-counter-clockwise" size={19} /></button>}
        <button className="btn primary lg" disabled={!out || !!busy} onClick={() => out && onApply(out)}><Icon name="check" size={18} />{t('Use this text')}</button>
      </>}>
      <div className="ai-text-cmp">
        <div className="ai-was"><span className="label">{t('Now')}</span><p>{text}</p></div>
        {(out !== null || busy) && <div className="ai-now"><span className="label">{t('New')}</span>
          {busy ? <Spinner label={t('Writing…')} /> : <textarea className="input" value={out ?? ''} rows={oneLine ? 2 : 5} dir="auto"
            onChange={(e) => setOut(oneLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)} />}
          {!busy && out && <ReportBtn task="rewrite" text={out} />}</div>}
      </div>
      {err && <div className="note warn"><Icon name="warning-circle" size={16} /><span>{err}</span></div>}
      <div className="ai-acts">
        {ACTS.map(([a, label, ic]) => (
          <button key={a} className={`ai-chip${busy === a ? ' on' : ''}`} disabled={!!busy} onClick={() => run(a)}><Icon name={ic} size={16} />{t(label)}</button>
        ))}
      </div>
      <div className="ai-acts">
        <span className="label" style={{ alignSelf: 'center' }}><Icon name="translate" size={15} /> {t('Translate to')}</span>
        {LANGS.map(([l, name]) => (
          <button key={l} className={`ai-chip${busy === 'translate' ? ' on' : ''}`} disabled={!!busy} lang={l} onClick={() => run('translate', { lang: l })}>{name}</button>
        ))}
      </div>
      <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) run('custom', { request: custom.trim() }); }}>
        <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('Or say what to change, e.g. “add the date”')} dir="auto" />
        <button className="btn primary" type="submit" disabled={!custom.trim() || !!busy} aria-label={t('Rewrite')}><Icon name="paper-plane-right:fill" size={18} /></button>
      </form>
      {oneLine && maxChars ? <div className="hint">{t('The new text replaces this line in the same font. Much longer text may run into the next words.')}</div> : null}
    </Sheet>
  );
}

// ---------------------------------------------------------------- assistant
export interface AiDoc { text: string; images: { page: number; jpeg: string }[]; pages: number }
interface Overview {
  kind: string; title: string; from?: string; summary: string[]; todo?: string[];
  dates?: { date: string; time?: string; what: string; deadline?: boolean; page?: number }[];
  amounts?: { amount: string; what: string; page?: number }[];
  facts?: { label: string; value: string; page?: number }[];
}
interface Msg { role: 'user' | 'assistant'; content: string; pages?: number[]; err?: boolean }
export interface AiCache { overview?: Record<string, Overview>; chat?: Msg[]; pii?: { text: string; kind: string }[] }
type Tab = 'overview' | 'ask' | 'reply' | 'privacy';

const KIND_ICON: Record<string, string> = { letter: 'envelope-simple', invoice: 'receipt', receipt: 'receipt', contract: 'article', form: 'textbox', notice: 'warning-circle', report: 'file-text' };
const PII_LABEL: Record<string, string> = { name: 'Name', address: 'Address', birth: 'Date of birth', phone: 'Phone', email: 'E-mail', id: 'ID number', bank: 'Bank details', health: 'Health', other: 'Personal' };

export function AiSheet({ sheet, initial = 'overview', getDoc, cache, onGoPage, onCalendar, onRedact, onReplyPdf, onCopy, onClose, onSettings }: {
  /** provider, key, switch off */ onSettings: () => void;
  sheet: boolean; initial?: Tab;
  /** the document as the AI reads it (pictures only for pages without text) */
  getDoc: (o: { images: boolean }) => Promise<AiDoc>;
  cache: AiCache;
  onGoPage: (n: number) => void;
  onCalendar: (e: { title: string; date: string; time?: string; note: string }) => void;
  /** black out these exact pieces of text; resolves to how many places were covered */
  onRedact: (texts: string[]) => Promise<number>;
  onReplyPdf: (subject: string, body: string) => void;
  onCopy: (s: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initial);
  const [lang, setLangRaw] = useState<AiLang>(readLang);
  const setLang = (l: AiLang) => { setLangRaw(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* fine */ } };
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, bump] = useState(0);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);
  const run = async <T,>(what: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(what); setErr(null);
    try { return await fn(c.signal); } catch (e) {
      if (!(e instanceof AiError && e.code === 'aborted')) setErr(aiErrorMsg(e, t));
      return null;
    } finally { if (ctl.current === c) setBusy(null); }
  };
  const stop = () => { ctl.current?.abort(); setBusy(null); };

  // ----- overview -----
  const ov = cache.overview?.[lang];
  const loadOverview = () => run('overview', async (signal) => {
    const d = await getDoc({ images: true });
    const r = await ai<Overview>('overview', { text: d.text, images: d.images, lang }, signal);
    cache.overview = { ...(cache.overview ?? {}), [lang]: r };
    bump((n) => n + 1);
  });
  useEffect(() => { if (tab === 'overview' && !ov && !busy) loadOverview(); }, [tab, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- ask -----
  const chat = cache.chat ?? (cache.chat = []);
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [chat.length, busy]);
  const ask = async (question: string) => {
    const qq = question.trim();
    if (!qq || busy) return;
    setQ('');
    const history = chat.filter((m) => !m.err).slice(-8).map(({ role, content }) => ({ role, content }));
    chat.push({ role: 'user', content: qq });
    bump((n) => n + 1);
    const r = await run('ask', async (signal) => {
      const d = await getDoc({ images: true });
      return ai<{ answer: string; pages?: number[] }>('ask', { text: d.text, images: d.images, question: qq, history, lang }, signal);
    });
    chat.push(r ? { role: 'assistant', content: r.answer, pages: (r.pages ?? []).filter((n) => Number.isFinite(n)).slice(0, 8) } : { role: 'assistant', content: t('No answer. Try again.'), err: true });
    bump((n) => n + 1);
  };
  const SUGGEST = ['Explain this document in simple words', 'What do I have to do, and by when?', 'Are there costs or fees?', 'What happens if I do nothing?'];

  // ----- reply -----
  const [notes, setNotes] = useState('');
  const [letter, setLetter] = useState<{ subject: string; body: string } | null>(null);
  const writeReply = () => run('reply', async (signal) => {
    const d = await getDoc({ images: true });
    let sender: Record<string, string> = {};
    try { sender = JSON.parse(localStorage.getItem('pe.profile') || '{}'); } catch { /* fine */ }
    const keep = ['first', 'last', 'street', 'zip', 'city', 'country', 'phone', 'email'];
    const r = await ai<{ subject: string; body: string }>('reply', { text: d.text, images: d.images, notes, lang, sender: Object.fromEntries(Object.entries(sender).filter(([k]) => keep.includes(k))) }, signal);
    setLetter(r);
  });

  // ----- personal data -----
  const pii = cache.pii;
  const [pick, setPick] = useState<Set<number>>(new Set());
  const findPii = () => run('pii', async (signal) => {
    const d = await getDoc({ images: false });
    if (!d.text.trim()) throw new AiError('failed');
    const r = await ai<{ items: { text: string; kind: string }[] }>('pii', { text: d.text }, signal);
    const seen = new Set<string>();
    cache.pii = (r.items ?? []).filter((i) => i.text?.trim() && !seen.has(i.text) && seen.add(i.text));
    setPick(new Set(cache.pii.map((_, i) => i)));
  });

  const tabs: [Tab, string, string][] = [['overview', 'Overview', 'list-bullets'], ['ask', 'Ask', 'chats-circle'], ['reply', 'Reply', 'arrow-bend-up-left'], ['privacy', 'Personal data', 'eye-slash']];
  const PageChips = ({ pages }: { pages?: number[] }) => pages?.length ? (
    <span className="ai-pages">{[...new Set(pages)].map((n) => <button key={n} onClick={() => { onGoPage(n); if (sheet) onClose(); }}>{t('p. {n}', { n })}</button>)}</span>
  ) : null;

  return (
    <Sheet sheet={sheet} cls="ai-sheet" label={t('AI assistant')} icon="sparkle:fill" onClose={onClose}>
      <div className="ai-tabs" role="tablist">
        {tabs.map(([k, label, ic]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={17} /><span>{t(label)}</span></button>
        ))}
      </div>
      {tab !== 'privacy' && <LangPick value={lang} onChange={setLang} />}
      {err && <div className="note warn" role="alert"><Icon name="warning-circle" size={16} /><span>{err}</span></div>}

      {tab === 'overview' && (
        busy === 'overview' ? <Spinner label={t('Reading the document…')} /> : ov ? (
          <div className="ai-ov" dir={rtl(lang)}>
            <div className="ai-ov-head">
              <span className="ai-kind"><Icon name={KIND_ICON[ov.kind] ?? 'file-text'} size={22} /></span>
              <div><b>{ov.title}</b>{ov.from && <small>{ov.from}</small>}</div>
            </div>
            <ul className="ai-bullets">{ov.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            {!!ov.todo?.length && <div className="ai-block todo"><div className="label">{t('To do')}</div><ul className="ai-bullets">{ov.todo.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            {!!ov.dates?.length && (
              <div className="ai-block"><div className="label">{t('Dates')}</div>
                {ov.dates.map((d, i) => (
                  <div key={i} className={`ai-row${d.deadline ? ' dl' : ''}`}>
                    <Icon name={d.deadline ? 'timer' : 'calendar-blank'} size={18} />
                    <span className="ai-rt"><b>{fmtDate(d.date, lang)}{d.time ? `, ${d.time}` : ''}</b><small>{d.what}</small></span>
                    <PageChips pages={d.page ? [d.page] : undefined} />
                    {/^\d{4}-\d{2}-\d{2}/.test(d.date) && <button className="ibtn" title={t('Add to calendar')} aria-label={t('Add to calendar')}
                      onClick={() => onCalendar({ title: d.what, date: d.date.slice(0, 10), time: d.time, note: ov.title })}><Icon name="calendar-plus" size={19} /></button>}
                  </div>
                ))}
              </div>
            )}
            {!!ov.amounts?.length && (
              <div className="ai-block"><div className="label">{t('Amounts')}</div>
                {ov.amounts.map((a, i) => (
                  <div key={i} className="ai-row"><Icon name="currency-eur" size={18} /><span className="ai-rt"><b>{a.amount}</b><small>{a.what}</small></span><PageChips pages={a.page ? [a.page] : undefined} /></div>
                ))}
              </div>
            )}
            {!!ov.facts?.length && (
              <div className="ai-block"><div className="label">{t('Details')}</div>
                {ov.facts.map((f, i) => (
                  <button key={i} className="ai-row ai-fact" onClick={() => onCopy(f.value)} title={t('Copy')}>
                    <span className="ai-rt"><small>{f.label}</small><b dir="auto">{f.value}</b></span><Icon name="copy" size={17} />
                  </button>
                ))}
              </div>
            )}
            <div className="ai-foot-row">
              <span className="ai-foot-acts"><button className="linkbtn" onClick={() => { delete cache.overview?.[lang]; loadOverview(); }}><Icon name="arrow-clockwise" size={15} /> {t('Read again')}</button>
                <ReportBtn task="overview" text={[ov.title, ...ov.summary, ...(ov.todo ?? [])].join('\n')} /></span>
              <span className="hint">{t('AI can make mistakes. Check important details on the page.')}</span>
            </div>
          </div>
        ) : !err ? <Spinner label={t('Reading the document…')} /> : <button className="btn outline" onClick={loadOverview}>{t('Try again')}</button>
      )}

      {tab === 'ask' && (
        <div className="ai-chat">
          <div className="ai-msgs" ref={listRef}>
            {!chat.length && (
              <div className="ai-suggest">
                {SUGGEST.map((s) => <button key={s} className="ai-chip" onClick={() => ask(t(s))}>{t(s)}</button>)}
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`ai-msg ${m.role}${m.err ? ' err' : ''}`} dir="auto">
                <div className="ai-bubble">{m.content.split(/\n+/).map((p, k) => <p key={k}>{p}</p>)}</div>
                {m.role === 'assistant' && !m.err && <div className="ai-msg-acts"><PageChips pages={m.pages} /><button className="ibtn" onClick={() => onCopy(m.content)} aria-label={t('Copy')}><Icon name="copy" size={16} /></button><ReportBtn task="ask" text={m.content} /></div>}
              </div>
            ))}
            {busy === 'ask' && <div className="ai-msg assistant"><div className="ai-bubble"><span className="ai-dots"><i /><i /><i /></span></div></div>}
          </div>
          <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Ask about this document…')} dir="auto" enterKeyHint="send" />
            {busy === 'ask'
              ? <button className="btn outline" type="button" onClick={stop} aria-label={t('Stop')}><Icon name="stop:fill" size={16} /></button>
              : <button className="btn primary" type="submit" disabled={!q.trim()} aria-label={t('Send')}><Icon name="paper-plane-right:fill" size={18} /></button>}
          </form>
        </div>
      )}

      {tab === 'reply' && (
        <div className="ai-reply">
          {!letter ? (
            <>
              <label className="field"><span className="label">{t('What should the reply say?')}</span>
                <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} dir="auto"
                  placeholder={t('e.g. I object to the invoice because the meter reading is wrong; please send a corrected bill.')} /></label>
              <div className="hint">{t('Your name and address from My details are used as the sender.')}</div>
              {busy === 'reply' ? <Spinner label={t('Writing the letter…')} />
                : <button className="btn primary lg" onClick={writeReply}><Icon name="sparkle:fill" size={18} />{t('Write the reply')}</button>}
            </>
          ) : (
            <>
              <label className="field"><span className="label">{t('Subject')}</span>
                <input className="input" value={letter.subject} dir="auto" onChange={(e) => setLetter({ ...letter, subject: e.target.value })} /></label>
              <label className="field"><span className="label">{t('Letter')}</span>
                <textarea className="input ai-letter" rows={12} value={letter.body} dir="auto" onChange={(e) => setLetter({ ...letter, body: e.target.value })} /></label>
              <div className="ai-row-btns">
                <button className="btn outline" onClick={() => setLetter(null)}><Icon name="arrow-counter-clockwise" size={17} />{t('Start over')}</button>
                <button className="btn outline" onClick={() => onCopy(`${letter.subject}\n\n${letter.body}`)}><Icon name="copy" size={17} />{t('Copy')}</button>
                <button className="btn primary" onClick={() => onReplyPdf(letter.subject, letter.body)}><Icon name="file-pdf:duotone" size={17} />{t('Save as PDF')}</button>
              </div>
              <div className="ai-foot-row"><span className="hint">{t('Fill in the parts in [ … ] before you send it.')}</span><ReportBtn task="reply" text={letter.body} /></div>
            </>
          )}
        </div>
      )}

      {tab === 'privacy' && (
        <div className="ai-pii">
          {!pii ? (
            <>
              <p className="ai-why">{t('Before you share this file: the AI looks for names, addresses, birth dates, ID and account numbers and other personal data, also ones the quick privacy check misses.')}</p>
              {busy === 'pii' ? <Spinner label={t('Looking for personal data…')} />
                : <button className="btn primary lg" onClick={findPii}><Icon name="magnifying-glass" size={18} />{t('Find personal data')}</button>}
            </>
          ) : pii.length ? (
            <>
              <div className="ai-pii-list">
                {pii.map((it, i) => (
                  <label key={i} className="ai-row">
                    <input type="checkbox" checked={pick.has(i)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(i); else n.delete(i); return n; })} />
                    <span className="ai-rt"><small>{t(PII_LABEL[it.kind] ?? 'Personal')}</small><b dir="auto">{it.text}</b></span>
                  </label>
                ))}
              </div>
              <div className="ai-row-btns">
                <button className="btn outline" onClick={() => { cache.pii = undefined; bump((n) => n + 1); }}>{t('Look again')}</button>
                <button className="btn primary" disabled={!pick.size || busy === 'redact'} onClick={async () => {
                  setBusy('redact');
                  try {
                    const n = await onRedact(pii.filter((_, i) => pick.has(i)).map((i) => i.text));
                    if (n) onClose(); else setErr(t('Those words were not found on the pages.'));
                  } finally { setBusy(null); }
                }}><Icon name="eye-slash" size={17} />{tn(pick.size, 'Black out {n} item', 'Black out {n} items')}</button>
              </div>
            </>
          ) : <div className="rc-ok"><span className="rc-badge"><Icon name="seal-check:fill" size={42} /></span><p>{t('No personal data found.')}</p></div>}
        </div>
      )}
      <div className="ai-legal"><Icon name="lock" size={13} /><span>{t('Sent to {target} only for this answer; not stored by Paginka.', { target: aiTarget() })}</span>
        <button className="linkbtn" onClick={onSettings}>{t('AI settings')}</button></div>
    </Sheet>
  );
}

function fmtDate(iso: string, lang: AiLang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  try { return d.toLocaleDateString(lang === 'de' ? 'de-AT' : lang === 'fa' ? 'fa-IR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch { return iso; }
}

// ---------------------------------------------------------------- smart fill review
export interface FillItem { id: string; label: string; page: number; kind: 'text' | 'check' | 'choice'; options?: string[]; value: string; from?: string; on: boolean }
export interface FillQuestion { id: string; question: string; answer: string }

export function AiFillReview({ sheet, items, questions, busy, err, onAgain, onApply, onClose }: {
  sheet: boolean; items: FillItem[] | null; questions: FillQuestion[]; busy: boolean; err: string | null;
  /** ask again with what the user wrote (answers to the questions, notes) */
  onAgain: (notes: string) => void;
  onApply: (items: FillItem[]) => void; onClose: () => void;
}) {
  const [list, setList] = useState<FillItem[]>(items ?? []);
  useEffect(() => { setList(items ?? []); }, [items]);
  const [qs, setQs] = useState(questions);
  useEffect(() => { setQs(questions); }, [questions]);
  const [notes, setNotes] = useState('');
  const chosen = list.filter((i) => i.on && i.value.trim()).length;
  const FROM: Record<string, string> = { details: 'My details', notes: 'Your notes', document: 'The document', today: 'Today' };
  const again = () => {
    const ans = qs.filter((q) => q.answer.trim()).map((q) => `${q.question} → ${q.answer.trim()}`).join('\n');
    onAgain([notes.trim(), ans].filter(Boolean).join('\n'));
  };
  return (
    <Sheet sheet={sheet} cls="ai-fill" label={t('Smart fill')} icon="magic-wand:duotone" onClose={onClose}
      foot={items && !busy ? <>
        <button className="btn outline lg" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary lg" disabled={!chosen} onClick={() => onApply(list.filter((i) => i.on && i.value.trim()))}><Icon name="check" size={18} />{tn(chosen, 'Fill in {n} field', 'Fill in {n} fields')}</button>
      </> : undefined}>
      {busy ? <Spinner label={t('Reading the form and your details…')} /> : err ? (
        <div className="note warn"><Icon name="warning-circle" size={16} /><span>{err}</span></div>
      ) : items && (
        <>
          {!list.length && <p className="ai-why">{t('The AI found nothing it can fill in safely. Tell it more below.')}</p>}
          {!!list.length && <div className="ai-fill-list">
            {list.map((it, k) => (
              <div key={it.id} className={`ai-fi${it.on ? '' : ' off'}`}>
                <input type="checkbox" checked={it.on} aria-label={it.label} onChange={(e) => setList((l) => l.map((x, j) => (j === k ? { ...x, on: e.target.checked } : x)))} />
                <div className="ai-fi-b">
                  <div className="ai-fi-h"><span className="nm">{it.label}</span><span className="k">{t('p. {n}', { n: it.page })}{it.from ? ` · ${t(FROM[it.from] ?? it.from)}` : ''}</span></div>
                  {it.kind === 'check'
                    ? <div className="ai-yn">{['yes', 'no'].map((v) => <button key={v} className={it.value === v ? 'on' : ''} onClick={() => setList((l) => l.map((x, j) => (j === k ? { ...x, value: v, on: true } : x)))}>{t(v === 'yes' ? 'Yes' : 'No')}</button>)}</div>
                    : it.kind === 'choice' && it.options?.length
                      ? <select className="input" value={it.value} onChange={(e) => setList((l) => l.map((x, j) => (j === k ? { ...x, value: e.target.value, on: true } : x)))}>{it.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      : <input className="input" value={it.value} dir="auto" onChange={(e) => setList((l) => l.map((x, j) => (j === k ? { ...x, value: e.target.value, on: true } : x)))} />}
                </div>
              </div>
            ))}
          </div>}
          {!!qs.length && (
            <div className="ai-block"><div className="label">{t('The AI needs to know')}</div>
              {qs.map((q, k) => (
                <label key={q.id + k} className="field ai-q"><span dir="auto">{q.question}</span>
                  <input className="input" value={q.answer} dir="auto" onChange={(e) => setQs((l) => l.map((x, j) => (j === k ? { ...x, answer: e.target.value } : x)))} /></label>
              ))}
            </div>
          )}
          <label className="field"><span className="label">{t('Anything else the form should say?')}</span>
            <input className="input" value={notes} dir="auto" onChange={(e) => setNotes(e.target.value)} placeholder={t('e.g. I am applying for my daughter Sara, born 3.4.2015')} /></label>
          {(notes.trim() || qs.some((q) => q.answer.trim())) && <button className="btn outline" onClick={again}><Icon name="sparkle" size={17} />{t('Fill again with this')}</button>}
          <div className="hint">{t('Check every answer. Signature fields are never filled by the AI.')}</div>
        </>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- found fields
export interface FoundField { page: number; label: string; kind: 'text' | 'multiline' | 'date' | 'check' | 'sign'; x: number; y: number; w: number; h: number; src: number }

export function AiFieldsResult({ sheet, found, by, pageLabel, onShow, onMake, onAiBetter, onClose }: {
  sheet: boolean; found: FoundField[]; by: 'device' | 'ai'; pageLabel: (src: number) => number;
  onShow: (f: FoundField) => void; onMake: (f: FoundField[]) => void; onAiBetter?: () => void; onClose: () => void;
}) {
  const fillable = useMemo(() => found.filter((f) => f.kind !== 'sign'), [found]);
  const signs = found.length - fillable.length;
  const IC: Record<FoundField['kind'], string> = { text: 'textbox', multiline: 'text-columns', date: 'calendar-blank', check: 'check-square:fill', sign: 'signature' };
  return (
    <Sheet sheet={sheet} cls="ai-found" label={t('Fields found')} icon={by === 'ai' ? 'sparkle:fill' : 'textbox'} onClose={onClose}
      foot={<>
        <button className="btn outline lg" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary lg" disabled={!fillable.length} onClick={() => onMake(fillable)}><Icon name="textbox" size={18} />{tn(fillable.length, 'Make {n} field fillable', 'Make {n} fields fillable')}</button>
      </>}>
      <p className="ai-why">{fillable.length
        ? t('These places become real form fields: tap to type, Smart fill and My details fill them, and they stay fillable in the saved PDF.')
        : t('No places to write were found on these pages.')}</p>
      {signs > 0 && <div className="note"><Icon name="signature" size={16} /><span>{tn(signs, '{n} signature line found: use Sign to sign it.', '{n} signature lines found: use Sign to sign them.')}</span></div>}
      <div className="ai-fill-list">
        {found.map((f, i) => (
          <button key={i} className="ai-row" onClick={() => onShow(f)}>
            <Icon name={IC[f.kind]} size={18} /><span className="ai-rt"><b dir="auto">{f.label || t('Field')}</b><small>{t('p. {n}', { n: pageLabel(f.src) })}</small></span>
          </button>
        ))}
      </div>
      {by === 'device' && onAiBetter && <button className="btn outline" onClick={onAiBetter}><Icon name="sparkle" size={17} />{t('Find more with AI (reads the page pictures)')}</button>}
    </Sheet>
  );
}
