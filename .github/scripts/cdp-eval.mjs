// Evaluates one expression in the app's WebView (DevTools on :9222) and prints the result.
// (an argument starting with @ names a file holding the expression)
import { readFileSync } from 'node:fs';
const arg = process.argv[2];
const expr = arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg;
const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('no page'); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id === 1) { console.log(JSON.stringify(m.result?.result?.value ?? m.result?.exceptionDetails?.text ?? null)); ws.close(); process.exit(0); }
});
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
setTimeout(() => { console.log('timeout'); process.exit(0); }, Number(process.env.CDP_TIMEOUT || 120000));
