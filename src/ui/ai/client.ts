// The AI assistant's connection. Two ways:
// - "Paginka AI": the app's own proxy (supabase/functions/ai), which holds a Claude key (only in builds with EXPO_PUBLIC_AI_URL);
// - the user's own key for Claude, OpenAI or Gemini: the app calls that provider directly; the key stays on this device.
// Nothing is sent before the user has switched AI on and agreed (see Consent.tsx); each call sends only
// what that action needs (a line, the form's fields, the document's text or page pictures).
import { useSyncExternalStore } from 'react';
import { getLang } from '../i18n';
import type { Provider } from '../../../supabase/functions/_shared/providers';
// prompts and provider calls load only when an own-key request is made (keeps the start screen small)
const loadDirect = () => Promise.all([import('../../../supabase/functions/_shared/prompts'), import('../../../supabase/functions/_shared/providers')]);

export type AiTask = 'rewrite' | 'fill' | 'detect' | 'overview' | 'ask' | 'reply' | 'pii' | 'name';
export type AiLang = 'en' | 'de' | 'fa';
export type AiProvider = 'paginka' | Provider;

/** the providers a user can bring a key for */
export const PROVIDERS: { id: Provider; name: string; company: string; keyUrl: string; prefix: string; fast: string; smart: string }[] = [
  { id: 'anthropic', name: 'Claude', company: 'Anthropic', keyUrl: 'https://console.anthropic.com/settings/keys', prefix: 'sk-ant-', fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', prefix: 'sk-', fast: 'gpt-5.4-mini', smart: 'gpt-5.4-mini' },
  { id: 'gemini', name: 'Gemini', company: 'Google', keyUrl: 'https://aistudio.google.com/apikey', prefix: 'AI', fast: 'gemini-flash-latest', smart: 'gemini-flash-latest' },
];
export const providerInfo = (p: Provider) => PROVIDERS.find((x) => x.id === p)!;

const SET = 'pe.ai', URL_KEY = 'pe.ai.url', DEV = 'pe.ai.device';
interface Settings {
  on: boolean; agreed: number;
  provider?: AiProvider;
  /** the user's own keys, only on this device */
  keys?: Partial<Record<Provider, string>>;
  /** a model the user picked instead of the default (one per provider) */
  models?: Partial<Record<Provider, string>>;
}

const read = (): Settings => { try { return { on: false, agreed: 0, ...JSON.parse(localStorage.getItem(SET) || '{}') }; } catch { return { on: false, agreed: 0 }; } };
const write = (s: Settings) => { try { localStorage.setItem(SET, JSON.stringify(s)); } catch { /* storage unavailable */ } emit(); };

/** the proxy's address: set at build time (EXPO_PUBLIC_AI_URL), or on this device for testing */
export function aiUrl(): string {
  try { const o = localStorage.getItem(URL_KEY); if (o) return o; } catch { /* fine */ }
  return (process.env.EXPO_PUBLIC_AI_URL ?? '').trim();
}
const appKey = () => (process.env.EXPO_PUBLIC_AI_APP_KEY ?? '').trim();
/** Paginka's own AI is part of this build */
export const hostedAi = () => !!aiUrl();
/** AI can be used in this build (always: with Paginka AI or the user's own key) */
export const aiAvailable = () => true;
/** the provider in use (or to suggest) */
export const aiProvider = (s = read()): AiProvider => s.provider === 'paginka' ? (hostedAi() ? 'paginka' : 'anthropic') : s.provider ?? (hostedAi() ? 'paginka' : 'anthropic');
const ready = (s: Settings) => { const p = aiProvider(s); return p === 'paginka' ? hostedAi() : !!s.keys?.[p]?.trim(); };
/** the user switched AI on, agreed, and the provider can be reached (Paginka AI, or a key is saved) */
export const aiAllowed = () => { const s = read(); return s.on && s.agreed > 0 && ready(s); };
export const setAiOn = (on: boolean) => write({ ...read(), on, agreed: on ? Date.now() : read().agreed });
/** the saved settings for the setup sheet */
export const aiSettings = () => { const s = read(); return { provider: aiProvider(s), keys: { ...(s.keys ?? {}) }, models: { ...(s.models ?? {}) }, on: aiAllowed() }; };
/** save the provider (and its key / model) and switch AI on */
export function saveAi(provider: AiProvider, key?: string, model?: string) {
  const s = read();
  const keys = { ...(s.keys ?? {}) }, models = { ...(s.models ?? {}) };
  if (provider !== 'paginka') {
    if (key !== undefined) { if (key.trim()) keys[provider] = key.trim(); else delete keys[provider]; }
    if (model !== undefined) { if (model.trim()) models[provider] = model.trim(); else delete models[provider]; }
  }
  write({ ...s, provider, keys, models, on: true, agreed: Date.now() });
}
/** remove a saved key from this device */
export function forgetKey(p: Provider) {
  const s = read();
  const keys = { ...(s.keys ?? {}) };
  delete keys[p];
  write({ ...s, keys, on: s.on && (aiProvider(s) !== p) });
}
/** the name shown to the user for where AI requests go */
export function aiTarget(): string {
  const p = aiProvider();
  if (p === 'paginka') return 'Claude (Anthropic)';
  const i = providerInfo(p);
  return `${i.name} (${i.company})`;
}

// ----- listeners (settings change, consent asked) -----
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const onAiChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

let asker: ((why: string) => Promise<boolean>) | null = null;
/** the editor's consent sheet registers here */
export const setConsentAsker = (f: typeof asker) => { asker = f; };
/** ask once (switch AI on), then run; false when the user said no */
export async function ensureAi(why = ''): Promise<boolean> {
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
  /** detail: the provider's own message (own key), shown under ours so the cause is visible */
  constructor(public code: 'off' | 'offline' | 'limit' | 'busy' | 'too_big' | 'not_configured' | 'failed' | 'aborted' | 'bad_key' | 'quota' | 'bad_model', public detail = '') { super(code); }
}

/** the answer language: the app's language unless the user picked another */
export const answerLang = (): AiLang => (getLang() === 'de' ? 'de' : 'en');

export async function ai<T = any>(task: AiTask, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  if (!aiAllowed()) throw new AiError('off');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('offline');
  const p = aiProvider();
  if (p !== 'paginka') { const s = read(); return direct<T>(p, s.keys![p]!, s.models?.[p], task, input, signal); }
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

/** test address for a provider (end-to-end tests only) */
const baseFor = (p: Provider) => { try { return localStorage.getItem(`pe.ai.base.${p}`) || undefined; } catch { return undefined; } };

/** other models to try with the user's key when the default one is overloaded or unknown */
const FALLBACK: Record<Provider, string[]> = {
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
  openai: ['gpt-5.4-mini', 'gpt-5-mini'],
  gemini: ['gemini-2.5-flash', 'gemini-flash-lite-latest'],
};

/** a provider error → our error code (with the provider's own message) */
function mapError(e: any, name: string, errorMessage: (d: string) => string): AiError {
  const d = (e.detail ?? '').toLowerCase();
  const said = e.status ? `${name}: ${errorMessage(e.detail ?? '') || `HTTP ${e.status}`}` : `${name}: ${e.detail}`;
  if (e.status === 0) return new AiError('failed', said);
  if (e.status === 401 || e.status === 403 || e.status === 400 && /api key|api_key|invalid.*key|x-api-key|permission/.test(d)) return new AiError('bad_key', said);
  if (e.status === 404 || /model.*(not found|does not exist|not supported)|unknown model|not_found_error/.test(d)) return new AiError('bad_model', said);
  if (e.status === 429 || e.status === 402 || /quota|credit|billing|insufficient|resource_exhausted/.test(d)) return new AiError('quota', said);
  if (e.status === 413 || e.status === 400 && /too long|too large|maximum context|context length|token/.test(d)) return new AiError('too_big', said);
  if (e.status >= 500) return new AiError('busy', said);
  return new AiError('failed', said);
}

/** the user's own key: the app calls the provider itself (same prompts and answer formats as the proxy) */
async function direct<T>(p: Provider, key: string, model: string | undefined, task: AiTask, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  let mods;
  try { mods = await loadDirect(); } catch { throw new AiError('offline'); }
  const [{ buildSpec }, { callModel, ProviderError, errorMessage }] = mods;
  let spec;
  try { spec = buildSpec(task, { today: new Date().toISOString().slice(0, 10), ...input }); } catch { throw new AiError('failed'); }
  const info = providerInfo(p);
  const first = model || (spec.model === 'fast' ? info.fast : info.smart);
  // a model the user typed is used alone; the default may fall back to others when it is busy, unknown or gives no answer
  const models = model ? [model] : [first, ...FALLBACK[p].filter((m) => m !== first)];
  let err: AiError | undefined;
  for (const m of models) {
    try {
      return await callModel({ provider: p, key, model: m, browser: true, signal, base: baseFor(p) }, spec) as T;
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new AiError('aborted');
      if (!(e instanceof ProviderError)) throw new AiError('offline', `${info.name}: ${e?.message ?? e}`);
      const mapped = mapError(e, info.name, errorMessage);
      // the first error is the one to show (a fallback model's "not found" would hide the real cause)
      err ??= mapped;
      if (!['busy', 'bad_model', 'failed'].includes(mapped.code)) throw err;
    }
  }
  throw err!;
}

/** check a key with a tiny request; null when it works, else the error */
export async function testKey(p: Provider, key: string, model?: string): Promise<AiError | null> {
  try { await direct(p, key.trim(), model?.trim() || undefined, 'name', { text: 'Wien, 15.10.2026\nRechnung Nr. 1\nMuster GmbH' }); return null; }
  catch (e) { return e instanceof AiError ? e : new AiError('failed'); }
}

/** report an answer as offensive or wrong (sent to the developer; only this answer) */
export async function aiReport(task: string, text: string, reason = 'offensive'): Promise<boolean> {
  if (!hostedAi()) {
    // no Paginka server: the report goes to the developer by e-mail
    const body = encodeURIComponent(`Feature: ${task}\nReason: ${reason}\nProvider: ${aiTarget()}\n\n${text.slice(0, 1500)}`);
    try { window.open(`mailto:rezahosseiniafg@gmail.com?subject=${encodeURIComponent('Paginka AI report')}&body=${body}`, '_blank'); return true; } catch { return false; }
  }
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
    case 'bad_key': return 'The API key was not accepted. Check it in AI settings.';
    case 'quota': return 'Your AI account has no credit left or reached its limit. Check it with your AI provider.';
    case 'bad_model': return 'That model is not available for your key. Clear the model field to use the default.';
    case 'aborted': return 'Stopped';
    default: return 'The AI could not answer. Try again.';
  }
}

/** our message (translated) plus the provider's own words, when there are any */
export function aiErrorMsg(e: unknown, tr: (s: string) => string): string {
  const m = tr(aiErrorText(e));
  const d = e instanceof AiError ? e.detail : '';
  return d ? `${m} (${d})` : m;
}

/** re-renders when AI is switched on or off */
export function useAiOn(): boolean {
  return useSyncExternalStore(onAiChange, aiAllowed, aiAllowed);
}
