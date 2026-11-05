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
}

export class ProviderError extends Error {
  constructor(public status: number, public detail: string) { super(`${status}`); }
}

const BASE: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

async function post(c: Call, url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const f = c.fetch ?? fetch;
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: c.signal });
  if (!res.ok) throw new ProviderError(res.status, (await res.text().catch(() => '')).slice(0, 500));
  return res.json();
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
    if (!use) throw new ProviderError(502, 'no tool answer');
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
    if (!call) throw new ProviderError(502, 'no tool answer');
    try { return JSON.parse(call.arguments); } catch { throw new ProviderError(502, 'bad tool answer'); }
  }
  // Gemini
  const parts = r.content.map((b) => b.type === 'text' ? { text: b.text } : { inlineData: { mimeType: b.source.media_type, data: b.source.data } });
  const body = (decl: Record<string, unknown>) => ({
    systemInstruction: { parts: [{ text: r.system }] },
    contents: [{ role: 'user', parts }],
    tools: [{ functionDeclarations: [{ name: r.tool.name, description: r.tool.description, ...decl }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [r.tool.name] } },
    generationConfig: { maxOutputTokens: Math.max(r.maxTokens * 2, 4000) },
  });
  const url = `${base}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
  let out: any;
  try {
    out = await post(c, url, { 'x-goog-api-key': c.key }, body({ parametersJsonSchema: r.tool.input_schema }));
  } catch (e) {
    // older API versions only know the OpenAPI-style "parameters"
    if (!(e instanceof ProviderError && e.status === 400 && /parameters_?json_?schema|Unknown name/i.test(e.detail))) throw e;
    out = await post(c, url, { 'x-goog-api-key': c.key }, body({ parameters: openApi(r.tool.input_schema) }));
  }
  const fc = (out.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)?.functionCall;
  if (!fc) throw new ProviderError(502, 'no tool answer');
  return fc.args ?? {};
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
