// Paginka AI proxy: the app sends a task and its inputs, this function holds the Anthropic key,
// the prompts and the limits, asks Claude and returns plain JSON. Nothing is stored here: no
// document text, no answers, no logs of the content. Only a per-device / per-IP counter is kept
// (as hashes) so one person can't use up the budget.
//
// Runtime-agnostic (Deno on Supabase, Node in tests): everything comes in through `Env`.

export interface Env {
  apiKey: string;
  /** quick text tasks */
  fastModel: string;
  /** reading page pictures, long documents, questions */
  smartModel: string;
  /** calls per device per day / per IP per day */
  perDevice: number;
  perIp: number;
  /** optional shared secret the app sends (x-app-key); empty = not checked */
  appKey?: string;
  /** count a call; false = over the limit. Default: an in-memory counter (per function instance). */
  take?: (key: string, limit: number) => Promise<boolean>;
  /** keep a user's report of a bad answer (Google Play: offensive AI content can be flagged in the app) */
  report?: (r: { task: string; text: string; reason: string }) => Promise<void>;
  fetch?: typeof fetch;
}

import { TASKS, Bad, buildSpec, optStr, type Spec, type Task } from '../_shared/prompts.ts';
import { callModel, ProviderError } from '../_shared/providers.ts';
export type { Task };

const MAX_BODY = 8 * 1024 * 1024; // pictures of a few pages

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-device, x-app-key, authorization, apikey',
  'Access-Control-Max-Age': '86400',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// ---------- limits ----------
const mem = new Map<string, number>();
const memTake = async (key: string, limit: number) => {
  const n = (mem.get(key) ?? 0) + 1;
  mem.set(key, n);
  if (mem.size > 50_000) mem.clear();
  return n <= limit;
};
async function hash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the call ----------
export async function callClaude(env: Env, spec: Spec): Promise<any> {
  try {
    return await callModel({ provider: 'anthropic', key: env.apiKey, model: spec.model === 'fast' ? env.fastModel : env.smartModel, fetch: env.fetch }, spec);
  } catch (e) {
    if (e instanceof ProviderError) { const x: any = new Error(`anthropic ${e.status}`); x.status = e.status; x.detail = e.detail; throw x; }
    throw e;
  }
}

export async function handle(req: Request, env: Env): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method' });
  if (!env.apiKey) return json(503, { error: 'not_configured' });
  if (env.appKey && req.headers.get('x-app-key') !== env.appKey) return json(401, { error: 'app_key' });
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json(413, { error: 'too_big' });
  let body: any;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: 'too_big' });
    body = JSON.parse(raw);
  } catch { return json(400, { error: 'bad_json' }); }
  const task = body?.task as Task | 'report';
  if (task === 'report') {
    // only what the user chose to report: the answer, which feature, why
    const r = { task: optStr(body.input?.task, 20), text: optStr(body.input?.text, 4000), reason: optStr(body.input?.reason, 40) || 'offensive' };
    if (!r.text) return json(400, { error: 'input' });
    try { if (env.report) await env.report(r); else console.warn('ai report', r.task, r.reason, r.text.slice(0, 200)); } catch { return json(502, { error: 'upstream' }); }
    return json(200, { result: { ok: true } });
  }
  if (!TASKS.includes(task)) return json(400, { error: 'task' });

  // limits: per device (random id the app keeps) and per network address, counted per day
  const day = new Date().toISOString().slice(0, 10);
  const device = (req.headers.get('x-device') ?? '').slice(0, 64);
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const take = env.take ?? memTake;
  // detect and overview count more (pictures, long documents)
  const cost = task === 'detect' || task === 'overview' || task === 'reply' ? 2 : 1;
  try {
    for (let i = 0; i < cost; i++) {
      if (device && !(await take(`d:${day}:${await hash(device)}`, env.perDevice))) return json(429, { error: 'limit' });
      if (!(await take(`i:${day}:${await hash(ip)}`, env.perIp))) return json(429, { error: 'limit' });
    }
  } catch { /* counter unavailable: allow */ }

  let spec: Spec;
  try { spec = buildSpec(task, body.input ?? {}); } catch (e) {
    if (e instanceof Bad) return json(400, { error: 'input', detail: e.message });
    throw e;
  }
  try {
    const result = await callClaude(env, spec);
    return json(200, { result });
  } catch (e: any) {
    if (e?.status === 429 || e?.status === 529) return json(503, { error: 'busy' });
    if (e?.status === 400 && /too long|prompt is too long|image/i.test(e.detail ?? '')) return json(413, { error: 'too_big' });
    console.error('ai failed', task, e?.status ?? '', e?.message ?? e);
    return json(502, { error: 'upstream' });
  }
}
