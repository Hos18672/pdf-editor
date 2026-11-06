// One AI request (a task's prompt, content and output format) sent to Claude, OpenAI or Gemini, with the
// answer read back as the output tool's JSON. Used by the Paginka proxy (Claude) and by the app when the
// user brings their own key. No imports: runs in Deno, Node and the browser.

export type Provider = 'anthropic' | 'openai' | 'gemini';

/** a task's request in provider-neutral form (content blocks as in the Anthropic API) */
export interface Req {
  system: string;
  content: ({ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } })[];
  tool: { name: string; description: string; input_schema: any };
  maxTokens: number;
}

export interface Call {
  provider: Provider;
  key: string;
  model: string;
  /** another address for the API (tests, proxies); default: the provider's own */
  base?: string;
  /** called from a browser / the app (Anthropic needs a header for that) */
  browser?: boolean;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** waits between retries (tests pass a fast one) */
  wait?: (ms: number) => Promise<void>;
}

export class ProviderError extends Error {
  /** status 0: the provider answered, but not with the output tool */
  constructor(public status: number, public detail: string) { super(`${status}`); }
}

/** the provider's own error text ("The model is overloaded…") out of its JSON error body */
export function errorMessage(detail: string): string {
  try {
    const j = JSON.parse(detail);
    const m = j?.error?.message ?? j?.message ?? (typeof j?.error === 'string' ? j.error : '');
    if (m) return String(m).slice(0, 200);
  } catch { /* not JSON */ }
  return detail.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** overloaded / temporary server trouble: worth trying again */
const temporary = (status: number) => status >= 500;

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, no) => {
  const t = setTimeout(ok, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); no(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

const BASE: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

async function post(c: Call, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const f = c.fetch ?? fetch;
  // free keys (Gemini especially) often get "model overloaded" for a moment: try again twice
  const waits = [1500, 4000];
  for (let i = 0; ; i++) {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: c.signal });
    if (res.ok) return res.json();
    const detail = (await res.text().catch(() => '')).slice(0, 500);
    if (i < waits.length && temporary(res.status)) { await (c.wait ? c.wait(waits[i]) : sleep(waits[i], c.signal)); continue; }
    throw new ProviderError(res.status, detail);
  }
}

/** a JSON object written as text (a model that answered without calling the tool) */
function jsonIn(text: string): any {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try { const j = JSON.parse(text.slice(a, b + 1)); return j && typeof j === 'object' && !Array.isArray(j) ? j : undefined; } catch { return undefined; }
}

export async function callModel(c: Call, r: Req): Promise<any> {
  const base = (c.base ?? BASE[c.provider]).replace(/\/+$/, '');
  if (c.provider === 'anthropic') {
    const out = await post(c, `${base}/v1/messages`, {
      'x-api-key': c.key, 'anthropic-version': '2023-06-01', ...(c.browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
    }, {
      model: c.model, max_tokens: r.maxTokens, system: r.system,
      messages: [{ role: 'user', content: r.content }], tools: [r.tool], tool_choice: { type: 'tool', name: r.tool.name },
    });
    const use = (out.content ?? []).find((b: any) => b.type === 'tool_use');
    if (!use) throw new ProviderError(0, `no tool answer (${out.stop_reason ?? '?'})`);
    return use.input;
  }
  if (c.provider === 'openai') {
    const parts = r.content.map((b) => b.type === 'text' ? { type: 'text', text: b.text }
      : { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}`, detail: 'high' } });
    const out = await post(c, `${base}/v1/chat/completions`, { authorization: `Bearer ${c.key}` }, {
      model: c.model,
      // reasoning models spend part of the budget thinking
      max_completion_tokens: Math.max(r.maxTokens * 2, 4000),
      messages: [{ role: 'system', content: r.system }, { role: 'user', content: parts }],
      tools: [{ type: 'function', function: { name: r.tool.name, description: r.tool.description, parameters: r.tool.input_schema } }],
      tool_choice: { type: 'function', function: { name: r.tool.name } },
    });
    const call = out.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call) throw new ProviderError(0, `no tool answer (${out.choices?.[0]?.finish_reason ?? '?'})`);
    try { return JSON.parse(call.arguments); } catch { throw new ProviderError(0, 'bad tool answer'); }
  }
  // Gemini
  const parts = r.content.map((b) => b.type === 'text' ? { text: b.text } : { inlineData: { mimeType: b.source.media_type, data: b.source.data } });
  const body = (decl: Record<string, unknown>, max = Math.max(r.maxTokens * 2, 4000)) => ({
    systemInstruction: { parts: [{ text: r.system }] },
    contents: [{ role: 'user', parts }],
    tools: [{ functionDeclarations: [{ name: r.tool.name, description: r.tool.description, ...decl }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [r.tool.name] } },
    generationConfig: { maxOutputTokens: max },
  });
  const url = `${base}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
  let decl: Record<string, unknown> = { parametersJsonSchema: r.tool.input_schema };
  let out: any;
  try {
    out = await post(c, url, { 'x-goog-api-key': c.key }, body(decl));
  } catch (e) {
    // older API versions only know the OpenAPI-style "parameters"
    if (!(e instanceof ProviderError && e.status === 400 && /parameters_?json_?schema|Unknown name/i.test(e.detail))) throw e;
    decl = { parameters: openApi(r.tool.input_schema) };
    out = await post(c, url, { 'x-goog-api-key': c.key }, body(decl));
  }
  const answer = (o: any) => {
    const parts = o.candidates?.[0]?.content?.parts ?? [];
    const fc = parts.find((p: any) => p.functionCall)?.functionCall;
    if (fc) return fc.args ?? {};
    // some models write the JSON as text instead of calling the function
    return jsonIn(parts.filter((p: any) => typeof p.text === 'string' && !p.thought).map((p: any) => p.text).join('\n'));
  };
  let res = answer(out);
  // thinking models count their thinking in maxOutputTokens: with a short budget nothing is left for the answer
  if (res === undefined && out.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    out = await post(c, url, { 'x-goog-api-key': c.key }, body(decl, 16000));
    res = answer(out);
  }
  if (res === undefined) {
    const why = out.candidates?.[0]?.finishReason ?? out.promptFeedback?.blockReason ?? '?';
    throw new ProviderError(0, `no tool answer (${why})`);
  }
  return res;
}

/** JSON schema → Gemini's OpenAPI subset (upper-case types) */
function openApi(s: any): any {
  if (!s || typeof s !== 'object') return s;
  const o: any = {};
  if (s.type) o.type = String(s.type).toUpperCase();
  for (const k of ['description', 'enum', 'required']) if (s[k] !== undefined) o[k] = s[k];
  if (s.properties) o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, openApi(v)]));
  if (s.items) o.items = openApi(s.items);
  return o;
}
