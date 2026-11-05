// Local stand-in for the AI proxy: the real handler (prompts, limits, checks) with a fake Claude that
// answers from the request. Logs every call to /tmp/ai-log.jsonl.  Run: npx tsx test/ai/mock-server.ts
import http from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { handle } from '../../supabase/functions/ai/handler';

const LOG = '/tmp/ai-log.jsonl';
writeFileSync(LOG, '');
const txt = (content: any[]) => content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const tag = (s: string, name: string) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s); return m ? m[1] : ''; };

function answer(tool: string, body: any): any {
  const content = body.messages[0].content;
  const all = txt(content);
  switch (tool) {
    case 'result': {
      const t = tag(all, 'text');
      if (/Translate it into English/.test(body.system)) return { text: 'Payment due by 12 November 2026' };
      if (/formal/.test(body.system)) return { text: 'Wir ersuchen höflich um Zahlung bis 12.11.2026.' };
      return { text: 'Neu: ' + t };
    }
    case 'answers': {
      const fields = JSON.parse(tag(all, 'fields') || '[]');
      const me = JSON.parse(tag(all, 'user_details') || '{}');
      const notes = tag(all, 'user_notes');
      const values: any[] = [], questions: any[] = [];
      for (const f of fields) {
        const l = (f.label || f.near).toLowerCase();
        const v = /vorname/.test(l) ? me.first : /nachname/.test(l) ? me.last : /geburt/.test(l) ? me.birth : /aktenzeichen/.test(l) ? (/(MA35-\d{4}\/\d+)/.exec(all)?.[1]) : /ort, datum/.test(l) ? `${me.city}, 05.11.2026`
          : /telefon/.test(l) ? me.phone : /mail/.test(l) ? me.email : f.kind === 'check' ? 'yes' : /kursniveau/.test(l) ? (/(A1|A2|B1)/.exec(notes)?.[1]) : undefined;
        if (v) values.push({ id: f.id, value: v, from: /aktenzeichen/.test(l) ? 'document' : /kursniveau/.test(l) ? 'notes' : 'details' });
        else if (/kursniveau/.test(l)) questions.push({ id: f.id, question: 'Welches Kursniveau möchten Sie?' });
      }
      return { values, questions };
    }
    case 'fields': {
      const out: any[] = [];
      for (const c of content) {
        if (c.type !== 'text' || !/^Page \d+\./.test(c.text)) continue;
        const page = +/^Page (\d+)/.exec(c.text)![1];
        const pw = +/is (\d+) ×/.exec(c.text)![1];
        const s = pw / 595.28;
        for (const ln of c.text.split('\n')) {
          const m = /^(\d+),(\d+),(\d+),(\d+): (.*)$/.exec(ln);
          if (!m) continue;
          const [x, y, w, h] = [+m[1], +m[2], +m[3], +m[4]];
          const t = m[5];
          if (/Kursniveau/.test(t)) out.push({ page, label: 'Kursniveau', kind: 'text', x: 220 * s, y: y - 2 * s, w: 120 * s, h: 18 * s });
          if (/^Unterschrift/.test(t)) out.push({ page, label: 'Unterschrift', kind: 'sign', x: x + 70 * s, y, w: 150 * s, h });
          if (/^E-Mail:/.test(t)) out.push({ page, label: 'E-Mail', kind: 'text', x: x + w + 8 * s, y: y - 3 * s, w: 260 * s, h: h + 6 * s });
        }
      }
      return { fields: out };
    }
    case 'overview': return { kind: 'invoice', title: 'Jahresabrechnung Strom', from: 'Wien Energie GmbH', summary: ['Nachzahlung von EUR 249,90 für 2025/26.', 'Rechnung Nr. 2026-004187.'],
      todo: ['EUR 249,90 bis 12.11.2026 überweisen.'], dates: [{ date: '2026-11-12', what: 'Zahlung fällig', deadline: true, page: 1 }], amounts: [{ amount: 'EUR 249,90', what: 'Nachzahlung', page: 1 }],
      facts: [{ label: 'IBAN', value: 'AT61 1904 3002 3457 3201', page: 1 }] };
    case 'answer': return { answer: 'Sie müssen EUR 249,90 bis 12.11.2026 überweisen.\nSonst kommt eine Mahnung.', pages: [1] };
    case 'letter': return { subject: 'Einspruch gegen Rechnung Nr. 2026-004187', body: 'Sehr geehrte Damen und Herren,\n\nich erhebe Einspruch gegen die Rechnung.\n\nMit freundlichen Grüßen\nMaria Muster' };
    case 'items': {
      const items = [];
      if (/Maria Muster/.test(all)) items.push({ text: 'Maria Muster', kind: 'name' });
      if (/Hauptstrasse 1\/4/.test(all)) items.push({ text: 'Hauptstrasse 1/4, 1010 Wien', kind: 'address' });
      return { items };
    }
    case 'name': return { name: '2026-10-15 Rechnung Wien Energie' };
  }
}

const fakeFetch = (async (_url: any, init: any) => {
  const body = JSON.parse(init.body);
  const tool = body.tools[0].name;
  const images = body.messages[0].content.filter((c: any) => c.type === 'image').length;
  appendFileSync(LOG, JSON.stringify({ tool, model: body.model, images, chars: init.body.length, text: txt(body.messages[0].content).slice(0, 4000) }) + '\n');
  await new Promise((r) => setTimeout(r, 250));
  return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: tool, input: answer(tool, body) }] }), { status: 200 });
}) as typeof fetch;

// ----- the providers themselves (own-key mode): same fake answers, in each provider's format -----
const PCORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
const asAnthropic = (path: string, b: any): any => {
  if (path.startsWith('/anthropic/')) return b;
  if (path.startsWith('/openai/')) {
    const user = b.messages.find((m: any) => m.role === 'user');
    return { system: b.messages[0].content, tools: [{ name: b.tool_choice.function.name }], messages: [{ content: user.content.map((c: any) => c.type === 'text' ? c : { type: 'image' }) }] };
  }
  return { system: b.systemInstruction.parts[0].text, tools: [{ name: b.toolConfig.functionCallingConfig.allowedFunctionNames[0] }],
    messages: [{ content: b.contents[0].parts.map((p: any) => p.text !== undefined ? { type: 'text', text: p.text } : { type: 'image' }) }] };
};
async function provider(path: string, headers: any, raw: string): Promise<{ status: number; body: any }> {
  const key = headers['x-api-key'] ?? (headers['authorization'] ?? '').replace(/^Bearer /, '') ?? headers['x-goog-api-key'];
  const k = headers['x-goog-api-key'] ?? key;
  if (!k || k.includes('bad')) return { status: 401, body: { error: { message: 'invalid api key' } } };
  if (path.startsWith('/anthropic/') && headers['anthropic-dangerous-direct-browser-access'] !== 'true') return { status: 401, body: { error: { message: 'CORS requests must set anthropic-dangerous-direct-browser-access' } } };
  const b = JSON.parse(raw);
  const a = asAnthropic(path, b);
  const tool = a.tools[0].name;
  const images = a.messages[0].content.filter((c: any) => c.type === 'image').length;
  appendFileSync(LOG, JSON.stringify({ tool, via: path.split('/')[1], model: b.model ?? path.split('/models/')[1]?.split(':')[0], images, chars: raw.length, text: txt(a.messages[0].content).slice(0, 4000) }) + '\n');
  await new Promise((r) => setTimeout(r, 200));
  const input = answer(tool, a);
  if (path.startsWith('/anthropic/')) return { status: 200, body: { content: [{ type: 'tool_use', name: tool, input }] } };
  if (path.startsWith('/openai/')) return { status: 200, body: { choices: [{ message: { tool_calls: [{ type: 'function', function: { name: tool, arguments: JSON.stringify(input) } }] } }] } };
  return { status: 200, body: { candidates: [{ content: { parts: [{ functionCall: { name: tool, args: input } }] } }] } };
}

const env = { apiKey: 'test', fastModel: 'claude-haiku-5-5', smartModel: 'claude-sonnet-5-5', perDevice: 1000, perIp: 1000, fetch: fakeFetch };
http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (/^\/(anthropic|openai|gemini)\//.test(req.url ?? '')) {
    if (req.method === 'OPTIONS') { res.writeHead(204, PCORS); res.end(); return; }
    const out = await provider(req.url!, req.headers, Buffer.concat(chunks).toString());
    res.writeHead(out.status, { ...PCORS, 'content-type': 'application/json' }); res.end(JSON.stringify(out.body)); return;
  }
  const r = await handle(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as any, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('mock AI on :8787'));
