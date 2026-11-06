// Request shapes and answer parsing for Claude, OpenAI and Gemini (supabase/functions/_shared/providers.ts).
// Run: npx tsx test/ai/providers.test.ts
import { callModel, ProviderError, errorMessage } from '../../supabase/functions/_shared/providers';
import { buildSpec } from '../../supabase/functions/_shared/prompts';

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
const spec = buildSpec('overview', { text: '[Page 1]\nRechnung', images: [{ page: 2, jpeg: 'QUJD' }], lang: 'de' });
const reply = (j: any, status = 200) => new Response(JSON.stringify(j), { status });

(async () => {
  // Anthropic
  let seen: any;
  let f = (async (url: any, init: any) => { seen = { url, h: init.headers, b: JSON.parse(init.body) }; return reply({ content: [{ type: 'tool_use', name: 'overview', input: { title: 'A' } }] }); }) as typeof fetch;
  let r = await callModel({ provider: 'anthropic', key: 'k1', model: 'm1', browser: true, fetch: f }, spec);
  ok(r.title === 'A', 'anthropic answer');
  ok(seen.url === 'https://api.anthropic.com/v1/messages' && seen.h['x-api-key'] === 'k1' && seen.h['anthropic-dangerous-direct-browser-access'] === 'true', 'anthropic headers');
  ok(seen.b.tool_choice.name === 'overview' && seen.b.messages[0].content.some((c: any) => c.type === 'image'), 'anthropic body');
  // OpenAI
  f = (async (url: any, init: any) => { seen = { url, h: init.headers, b: JSON.parse(init.body) };
    return reply({ choices: [{ message: { tool_calls: [{ function: { name: 'overview', arguments: '{"title":"B","summary":["x"]}' } }] } }] }); }) as typeof fetch;
  r = await callModel({ provider: 'openai', key: 'k2', model: 'gpt-x', fetch: f, base: 'http://h/openai/' }, spec);
  ok(r.title === 'B' && r.summary[0] === 'x', 'openai answer');
  ok(seen.url === 'http://h/openai/v1/chat/completions' && seen.h.authorization === 'Bearer k2', 'openai url + auth');
  const img = seen.b.messages[1].content.find((c: any) => c.type === 'image_url');
  ok(img && img.image_url.url === 'data:image/jpeg;base64,QUJD', 'openai image as data url');
  ok(seen.b.messages[0].role === 'system' && seen.b.tool_choice.function.name === 'overview' && seen.b.tools[0].function.parameters.type === 'object', 'openai tools');
  ok(seen.b.max_completion_tokens >= 4000 && seen.b.max_tokens === undefined, 'openai token field');
  // Gemini, first form works
  const calls: any[] = [];
  f = (async (url: any, init: any) => { const b = JSON.parse(init.body); calls.push({ url, h: init.headers, b });
    return reply({ candidates: [{ content: { parts: [{ text: 'hm' }, { functionCall: { name: 'overview', args: { title: 'C' } } }] } }] }); }) as typeof fetch;
  r = await callModel({ provider: 'gemini', key: 'k3', model: 'gemini-flash-latest', fetch: f }, spec);
  ok(r.title === 'C', 'gemini answer');
  ok(calls[0].url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent' && calls[0].h['x-goog-api-key'] === 'k3', 'gemini url + key header');
  ok(calls[0].b.tools[0].functionDeclarations[0].parametersJsonSchema.type === 'object' && calls[0].b.toolConfig.functionCallingConfig.mode === 'ANY', 'gemini tools');
  ok(calls[0].b.contents[0].parts.some((p: any) => p.inlineData?.data === 'QUJD') && calls[0].b.systemInstruction.parts[0].text.includes('Paginka'), 'gemini parts');
  // Gemini: older API rejects parametersJsonSchema → retried with OpenAPI "parameters"
  calls.length = 0;
  f = (async (url: any, init: any) => { const b = JSON.parse(init.body); calls.push(b);
    if (b.tools[0].functionDeclarations[0].parametersJsonSchema) return reply({ error: { message: 'Invalid JSON payload received. Unknown name "parametersJsonSchema"' } }, 400);
    return reply({ candidates: [{ content: { parts: [{ functionCall: { name: 'overview', args: { title: 'D' } } }] } }] }); }) as typeof fetch;
  r = await callModel({ provider: 'gemini', key: 'k', model: 'g', fetch: f }, spec);
  const params = calls[1]?.tools[0].functionDeclarations[0].parameters;
  ok(r.title === 'D' && params.type === 'OBJECT' && params.properties.summary.type === 'ARRAY' && params.properties.summary.items.type === 'STRING', 'gemini fallback schema');
  // errors
  f = (async () => reply({ error: { message: 'invalid x-api-key' } }, 401)) as typeof fetch;
  try { await callModel({ provider: 'anthropic', key: 'bad', model: 'm', fetch: f }, spec); ok(false, 'should throw'); }
  catch (e) { ok(e instanceof ProviderError && e.status === 401, 'error status kept'); }
  f = (async () => reply({ choices: [{ message: { content: 'no tool' } }] })) as typeof fetch;
  try { await callModel({ provider: 'openai', key: 'k', model: 'm', fetch: f }, spec); ok(false, 'should throw'); }
  catch (e) { ok(e instanceof ProviderError && e.status === 0 && /no tool answer/.test(e.detail), 'no tool answer'); }
  // overloaded: tried again (twice), then the error is kept
  const waited: number[] = []; const wait = async (ms: number) => { waited.push(ms); };
  let n = 0;
  f = (async () => ++n < 3 ? reply({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }, 503)
    : reply({ candidates: [{ content: { parts: [{ functionCall: { name: 'overview', args: { title: 'E' } } }] } }] })) as typeof fetch;
  r = await callModel({ provider: 'gemini', key: 'k', model: 'g', fetch: f, wait }, spec);
  ok(r.title === 'E' && n === 3 && waited.length === 2, 'gemini overloaded → retried');
  n = 0; waited.length = 0;
  f = (async () => { n++; return reply({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529); }) as typeof fetch;
  try { await callModel({ provider: 'anthropic', key: 'k', model: 'm', fetch: f, wait }, spec); ok(false, 'should throw'); }
  catch (e) { ok(e instanceof ProviderError && e.status === 529 && n === 3 && errorMessage(e.detail) === 'Overloaded', 'anthropic 529 → 3 tries, message kept'); }
  n = 0;
  f = (async () => { n++; return reply({ error: { message: 'invalid x-api-key' } }, 401); }) as typeof fetch;
  try { await callModel({ provider: 'anthropic', key: 'k', model: 'm', fetch: f, wait }, spec); } catch { /* expected */ }
  ok(n === 1, 'no retry for a bad key');
  // thinking used up the tokens: asked again with a larger budget
  const budgets: number[] = [];
  f = (async (_u: any, init: any) => { const b = JSON.parse(init.body); budgets.push(b.generationConfig.maxOutputTokens);
    return budgets.length === 1 ? reply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'thinking', thought: true }] } }] })
      : reply({ candidates: [{ content: { parts: [{ functionCall: { name: 'overview', args: { title: 'F' } } }] } }] }); }) as typeof fetch;
  r = await callModel({ provider: 'gemini', key: 'k', model: 'g', fetch: f, wait }, spec);
  ok(r.title === 'F' && budgets[1] === 16000 && budgets[0] < 16000, 'gemini MAX_TOKENS → bigger budget');
  // JSON written as text instead of a function call
  f = (async () => reply({ candidates: [{ content: { parts: [{ text: 'Here:\n```json\n{"title":"G","summary":["y"]}\n```' }] } }] })) as typeof fetch;
  r = await callModel({ provider: 'gemini', key: 'k', model: 'g', fetch: f, wait }, spec);
  ok(r.title === 'G' && r.summary[0] === 'y', 'gemini JSON as text');
  f = (async () => reply({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })) as typeof fetch;
  try { await callModel({ provider: 'gemini', key: 'k', model: 'g', fetch: f, wait }, spec); ok(false, 'should throw'); }
  catch (e) { ok(e instanceof ProviderError && e.status === 0 && /SAFETY/.test(e.detail), 'gemini no answer: reason kept'); }
  ok(errorMessage('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}') === 'API key not valid. Please pass a valid API key.', 'errorMessage gemini');
  ok(errorMessage('upstream connect error') === 'upstream connect error', 'errorMessage plain text');
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
