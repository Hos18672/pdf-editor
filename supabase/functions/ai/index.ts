// Supabase Edge Function entry (Deno). Deploy:  supabase functions deploy ai --no-verify-jwt
// Secrets:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-…  (optional: AI_APP_KEY, AI_PER_DEVICE, AI_PER_IP, AI_MODEL_FAST, AI_MODEL_SMART)
import { handle, type Env } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

/** daily counter in Postgres (migration 20261105_ai_usage.sql); only hashed keys are stored */
const take = url && service
  ? async (key: string, limit: number) => {
    const r = await fetch(`${url}/rest/v1/rpc/ai_take`, {
      method: 'POST',
      headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_key: key, p_limit: limit }),
    });
    if (!r.ok) throw new Error('counter');
    return (await r.json()) === true;
  }
  : undefined;

/** reported answers (table ai_reports): reviewed by the developer, deleted after 90 days */
const report = url && service
  ? async (r: { task: string; text: string; reason: string }) => {
    const res = await fetch(`${url}/rest/v1/ai_reports`, {
      method: 'POST',
      headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(r),
    });
    if (!res.ok) throw new Error('report');
  }
  : undefined;

const env: Env = {
  apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
  fastModel: Deno.env.get('AI_MODEL_FAST') ?? 'claude-haiku-5-5',
  smartModel: Deno.env.get('AI_MODEL_SMART') ?? 'claude-sonnet-5-5',
  perDevice: Number(Deno.env.get('AI_PER_DEVICE') ?? 60),
  perIp: Number(Deno.env.get('AI_PER_IP') ?? 150),
  appKey: Deno.env.get('AI_APP_KEY') ?? '',
  take,
  report,
};

Deno.serve((req) => handle(req, env));
