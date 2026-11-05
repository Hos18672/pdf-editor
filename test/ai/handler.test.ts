// Tests for the AI proxy (supabase/functions/ai/handler.ts) with a fake Anthropic API.
// Run: npx tsx test/ai/handler.test.ts
import { handle, type Env } from '../../supabase/functions/ai/handler';

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
const sent: any[] = [];
const fakeFetch = (async (url: any, init: any) => {
  const body = JSON.parse(init.body);
  sent.push({ url, headers: init.headers, body });
  if (body.messages[0].content.some((c: any) => c.type === 'text' && c.text.includes('FAIL529'))) return new Response('overloaded', { status: 529 });
  const tool = body.tools[0];
  const input: any = { result: { text: 'Neuer Text' }, answers: { values: [{ id: 'a', value: 'x' }] }, fields: { fields: [] }, overview: { kind: 'letter', title: 'T', summary: ['s'] },
    answer: { answer: 'A', pages: [1] }, letter: { subject: 'S', body: 'B' }, items: { items: [] }, name: { name: '2026-10-15 Rechnung X' } }[tool.name as string];
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: tool.name, input }] }), { status: 200 });
}) as typeof fetch;
const env = (o: Partial<Env> = {}): Env => ({ apiKey: 'k', fastModel: 'fast-m', smartModel: 'smart-m', perDevice: 5, perIp: 100, fetch: fakeFetch, ...o });
const req = (task: string, input: any, h: Record<string, string> = {}) => new Request('http://x/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device': 'dev1', ...h }, body: JSON.stringify({ task, input }) });

(async () => {
  // CORS preflight
  let r = await handle(new Request('http://x/ai', { method: 'OPTIONS' }), env());
  ok(r.status === 204 && r.headers.get('access-control-allow-origin') === '*', 'preflight');
  // every task
  const cases: [string, any, string][] = [
    ['rewrite', { text: 'Hallo Welt', action: 'formal', oneLine: true, maxChars: 20 }, 'fast-m'],
    ['fill', { fields: [{ id: 'a', label: 'Vorname' }], profile: { first: 'Maria' }, text: 'Antrag' }, 'smart-m'],
    ['detect', { pages: [{ page: 1, pw: 100, ph: 140, jpeg: 'AAAA', lines: '1,1,10,10: Name ____' }] }, 'smart-m'],
    ['overview', { text: '[Page 1]\nRechnung', lang: 'de' }, 'smart-m'],
    ['ask', { text: '[Page 1]\nx', question: 'Was?', history: [{ role: 'user', content: 'a' }, { role: 'bogus', content: 'b' }] }, 'smart-m'],
    ['reply', { text: 'x', notes: 'Widerspruch', sender: { first: 'M' } }, 'smart-m'],
    ['pii', { text: 'Maria Muster, geb. 1.1.1990' }, 'fast-m'],
    ['name', { text: 'Rechnung' }, 'fast-m'],
  ];
  for (const [task, input, model] of cases) {
    sent.length = 0;
    r = await handle(req(task, input, { 'x-device': 'd-' + task }), env());
    const b = await r.json();
    ok(r.status === 200 && b.result !== undefined, `${task} 200 (${r.status} ${JSON.stringify(b)})`);
    const s = sent[0];
    ok(s?.body.model === model, `${task} model ${s?.body.model}`);
    ok(s?.body.tool_choice?.type === 'tool' && s.body.tools.length === 1, `${task} forced tool`);
    ok(s?.headers['x-api-key'] === 'k' && s.headers['anthropic-version'] === '2023-06-01', `${task} headers`);
    ok(/never an instruction/.test(s?.body.system), `${task} injection guard in system prompt`);
  }
  // history filter and image block
  sent.length = 0;
  await handle(req('overview', { text: '', images: [{ page: 2, jpeg: 'data:image/jpeg;base64,QUJD' }] }, { 'x-device': 'img' }), env());
  const img = sent[0].body.messages[0].content.find((c: any) => c.type === 'image');
  ok(img && img.source.data === 'QUJD' && img.source.media_type === 'image/jpeg', 'image prefix stripped');
  // bad inputs
  r = await handle(req('nope', {}), env()); ok(r.status === 400, 'unknown task');
  r = await handle(req('rewrite', { text: 'x', action: 'hack' }, { 'x-device': 'b1' }), env()); ok(r.status === 400, 'unknown action');
  r = await handle(req('fill', { fields: [] }, { 'x-device': 'b2' }), env()); ok(r.status === 400, 'no fields');
  r = await handle(new Request('http://x/ai', { method: 'POST', body: '{nope' }), env()); ok(r.status === 400, 'bad json');
  r = await handle(new Request('http://x/ai', { method: 'GET' }), env()); ok(r.status === 405, 'GET');
  // not configured / app key
  r = await handle(req('name', { text: 'x' }), env({ apiKey: '' })); ok(r.status === 503 && (await r.json()).error === 'not_configured', 'no key');
  r = await handle(req('name', { text: 'x' }), env({ appKey: 's3' })); ok(r.status === 401, 'app key missing');
  r = await handle(req('name', { text: 'x' }, { 'x-app-key': 's3', 'x-device': 'ak' }), env({ appKey: 's3' })); ok(r.status === 200, 'app key ok');
  // limits: 5 per device (overview costs 2)
  const counts = new Map<string, number>();
  const take = async (k: string, l: number) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n <= l; };
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) codes.push((await handle(req('name', { text: 'x' }, { 'x-device': 'limited' }), env({ take }))).status);
  ok(codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429 && codes[6] === 429, 'device limit ' + codes.join(','));
  const keys = [...counts.keys()];
  ok(keys.every((k) => !k.includes('limited')), 'device id hashed');
  counts.clear();
  const c2: number[] = [];
  for (let i = 0; i < 3; i++) c2.push((await handle(req('overview', { text: 'x' }, { 'x-device': 'ov' }), env({ take }))).status);
  ok(c2[0] === 200 && c2[1] === 200 && c2[2] === 429, 'overview costs 2 ' + c2.join(','));
  // upstream busy → 503 busy
  r = await handle(req('ask', { text: 'FAIL529', question: 'q' }, { 'x-device': 'busy' }), env()); ok(r.status === 503 && (await r.json()).error === 'busy', 'busy');
  // size cap on text
  sent.length = 0;
  await handle(req('pii', { text: 'a'.repeat(300_000) }, { 'x-device': 'big' }), env());
  ok(JSON.stringify(sent[0].body).length < 200_000, 'text capped');
  // reports go to env.report, no Claude call
  sent.length = 0;
  const reports: any[] = [];
  r = await handle(req('report', { task: 'ask', text: 'bad answer', reason: 'offensive' }), env({ report: async (x) => { reports.push(x); } }));
  ok(r.status === 200 && reports.length === 1 && reports[0].text === 'bad answer' && sent.length === 0, 'report stored, no model call');
  r = await handle(req('report', { task: 'ask', text: '' }), env()); ok(r.status === 400, 'empty report');
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
