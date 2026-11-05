// The AI assistant's connection: Paginka's own proxy (supabase/functions/ai), which holds the Claude key.
// Nothing is sent before the user has switched AI on and agreed (see AiConsent); each call sends only
// what that action needs (a line, the form's fields, the document's text or page pictures).
import { useSyncExternalStore } from 'react';
import { getLang } from '../i18n';

export type AiTask = 'rewrite' | 'fill' | 'detect' | 'overview' | 'ask' | 'reply' | 'pii' | 'name';
export type AiLang = 'en' | 'de' | 'fa';

const SET = 'pe.ai', URL_KEY = 'pe.ai.url', DEV = 'pe.ai.device';
interface Settings { on: boolean; agreed: number }

const read = (): Settings => { try { return { on: false, agreed: 0, ...JSON.parse(localStorage.getItem(SET) || '{}') }; } catch { return { on: false, agreed: 0 }; } };
const write = (s: Settings) => { try { localStorage.setItem(SET, JSON.stringify(s)); } catch { /* storage unavailable */ } emit(); };

/** the proxy's address: set at build time (EXPO_PUBLIC_AI_URL), or on this device for testing */
export function aiUrl(): string {
  try { const o = localStorage.getItem(URL_KEY); if (o) return o; } catch { /* fine */ }
  return (process.env.EXPO_PUBLIC_AI_URL ?? '').trim();
}
const appKey = () => (process.env.EXPO_PUBLIC_AI_APP_KEY ?? '').trim();
/** this build can reach the assistant at all */
export const aiAvailable = () => !!aiUrl();
/** the user switched AI on and agreed to send content for AI actions */
export const aiAllowed = () => { const s = read(); return aiAvailable() && s.on && s.agreed > 0; };
export const setAiOn = (on: boolean) => write({ ...read(), on, agreed: on ? Date.now() : read().agreed });

// ----- listeners (settings change, consent asked) -----
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const onAiChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

let asker: ((why: string) => Promise<boolean>) | null = null;
/** the editor's consent sheet registers here */
export const setConsentAsker = (f: typeof asker) => { asker = f; };
/** ask once (switch AI on), then run; false when the user said no or AI isn't available */
export async function ensureAi(why = ''): Promise<boolean> {
  if (!aiAvailable()) return false;
  if (aiAllowed()) return true;
  return asker ? asker(why) : false;
}

function deviceId(): string {
  try {
    let d = localStorage.getItem(DEV);
    if (!d) { d = (crypto as any).randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(DEV, d!); }
    return d!;
  } catch { return ''; }
}

export class AiError extends Error {
  constructor(public code: 'off' | 'offline' | 'limit' | 'busy' | 'too_big' | 'not_configured' | 'failed' | 'aborted') { super(code); }
}

/** the answer language: the app's language unless the user picked another */
export const answerLang = (): AiLang => (getLang() === 'de' ? 'de' : 'en');

export async function ai<T = any>(task: AiTask, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!aiAllowed()) throw new AiError('off');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');
  let res: Response;
  try {
    res = await fetch(aiUrl(), {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-device': deviceId(), ...(appKey() ? { 'x-app-key': appKey() } : {}) },
      body: JSON.stringify({ task, input: { today: new Date().toISOString().slice(0, 10), ...input } }),
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new AiError('aborted');
    throw new AiError('offline');
  }
  if (res.status === 429) throw new AiError('limit');
  if (res.status === 413) throw new AiError('too_big');
  if (res.status === 503) {
    const b = await res.json().catch(() => ({}));
    throw new AiError(b?.error === 'not_configured' ? 'not_configured' : 'busy');
  }
  if (!res.ok) throw new AiError('failed');
  const b = await res.json().catch(() => null);
  if (!b || b.result === undefined) throw new AiError('failed');
  return b.result as T;
}

/** report an answer as offensive or wrong (sent to the developer; only this answer) */
export async function aiReport(task: string, text: string, reason = 'offensive'): Promise<boolean> {
  try {
    const r = await fetch(aiUrl(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': deviceId(), ...(appKey() ? { 'x-app-key': appKey() } : {}) },
      body: JSON.stringify({ task: 'report', input: { task, text: text.slice(0, 4000), reason } }) });
    return r.ok;
  } catch { return false; }
}

/** the message for a failed call (English source, translated by t()) */
export function aiErrorText(e: unknown): string {
  const c = e instanceof AiError ? e.code : 'failed';
  switch (c) {
    case 'offline': return 'No internet connection. AI needs to be online; everything else works offline.';
    case 'limit': return 'Daily AI limit reached. Try again tomorrow.';
    case 'busy': return 'The AI is busy right now. Try again in a moment.';
    case 'too_big': return 'The document is too long for one AI request. Try fewer pages.';
    case 'not_configured': return 'AI is not set up on the server yet.';
    case 'off': return 'AI is switched off.';
    case 'aborted': return 'Stopped';
    default: return 'The AI could not answer. Try again.';
  }
}

/** re-renders when AI is switched on or off */
export function useAiOn(): boolean {
  return useSyncExternalStore(onAiChange, aiAllowed, aiAllowed);
}
