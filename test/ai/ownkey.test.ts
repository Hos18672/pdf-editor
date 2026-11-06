// The user's own key (src/ui/ai/client.ts): model fallback when the default is busy, and the provider's own words in errors.
// Run: npx tsx test/ai/ownkey.test.ts
const store: Record<string, string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } };
const realTimeout = setTimeout;
(globalThis as any).setTimeout = (f: () => void) => realTimeout(f, 1); // no real waits between retries

let fails = 0, passes = 0;
const ok = (c: unknown, m: string) => { if (c) passes++; else { fails++; console.log('FAIL', m); } };
const reply = (j: any, status = 200) => new Response(JSON.stringify(j), { status });
const answer = { candidates: [{ content: { parts: [{ functionCall: { name: 'name', args: { name: 'Rechnung' } } }] } }] };
const claudeAnswer = { content: [{ type: 'tool_use', name: 'name', input: { name: 'Rechnung' } }] };

(async () => {
  const { testKey, aiErrorMsg } = await import('../../src/ui/ai/client');
  const tr = (s: string) => s;
  let seen: string[] = [];
  const route = (fn: (model: string, url: string) => Response) => {
    seen = [];
    (globalThis as any).fetch = async (url: string, init: any) => {
      const model = /models\/([^:]+):/.exec(url)?.[1] ?? JSON.parse(init.body).model;
      seen.push(decodeURIComponent(model)); return fn(decodeURIComponent(model), url);
    };
  };
  const overloaded = () => reply({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }, 503);

  // Gemini default overloaded every time → next model answers
  route((m) => m === 'gemini-flash-latest' ? overloaded() : reply(answer));
  ok(await testKey('gemini', 'AIza1') === null && seen[0] === 'gemini-flash-latest' && seen.at(-1) === 'gemini-2.5-flash', 'gemini falls back to another model');
  // all overloaded → busy, with Google's words
  route(() => overloaded());
  let e = await testKey('gemini', 'AIza1');
  ok(e?.code === 'busy' && /Gemini: The model is overloaded/.test(aiErrorMsg(e, tr)), 'gemini busy shows the reason');
  // a model the user typed: no fallback
  route(() => overloaded());
  await testKey('gemini', 'AIza1', 'gemini-x');
  ok(seen.every((m) => m === 'gemini-x'), 'typed model used alone');
  // bad key: stops at once, Google's words shown
  route(() => reply({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400));
  e = await testKey('gemini', 'AIzaBad');
  ok(e?.code === 'bad_key' && seen.length === 1 && /API key not valid/.test(aiErrorMsg(e, tr)), 'gemini bad key');
  // free tier quota
  route(() => reply({ error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED' } }, 429));
  e = await testKey('gemini', 'AIza1');
  ok(e?.code === 'quota' && /exceeded your current quota/.test(aiErrorMsg(e, tr)), 'gemini quota');
  // Claude: no credit
  route(() => reply({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, 400));
  e = await testKey('anthropic', 'sk-ant-1');
  ok(e?.code === 'quota' && /Claude: Your credit balance is too low/.test(aiErrorMsg(e, tr)), 'claude no credit');
  // Claude: wrong key
  route(() => reply({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401));
  e = await testKey('anthropic', 'sk-ant-bad');
  ok(e?.code === 'bad_key' && /invalid x-api-key/.test(aiErrorMsg(e, tr)), 'claude bad key');
  // Claude: default model unknown to this key → older model works
  route((m) => m === 'claude-haiku-4-5' ? reply(claudeAnswer) : reply({ type: 'error', error: { type: 'not_found_error', message: `model: ${m}` } }, 404));
  ok(await testKey('anthropic', 'sk-ant-1') === null && seen.at(-1) === 'claude-haiku-4-5', 'claude model fallback');
  // network blocked
  (globalThis as any).fetch = async () => { throw new TypeError('Failed to fetch'); };
  e = await testKey('anthropic', 'sk-ant-1');
  ok(e?.code === 'offline' && /Failed to fetch/.test(e.detail), 'network error kept');
  console.log(`${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
