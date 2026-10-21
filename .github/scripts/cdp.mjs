// Reads the state of the app's WebView through DevTools (adb-forwarded to :9222).
const list = await (await fetch('http://127.0.0.1:9222/json')).json();
console.log('targets', JSON.stringify(list.map((t) => ({ type: t.type, url: t.url })), null, 1));
const page = list.find((t) => t.type === 'page');
if (!page) { console.log('no page target'); process.exit(0); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let n = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
console.log('href', await ev('location.href'));
console.log('readyState', await ev('document.readyState'));
console.log('pageErrors', JSON.stringify(await ev('window.__pageErrors'), null, 1));
console.log('host os', await ev('String(window.$$EXPO_DOM_HOST_OS)'), 'props', await ev('JSON.stringify(window.$$EXPO_INITIAL_PROPS)'));
console.log('root html', await ev('document.getElementById("root") ? document.getElementById("root").innerHTML.slice(0, 600) : "no root"'));
console.log('scripts', JSON.stringify(await ev('[...document.scripts].map(s => s.src || "inline")')));
console.log('resources', JSON.stringify(await ev('performance.getEntriesByType("resource").map(e => e.name.split("/").pop() + " " + Math.round(e.duration))')));
console.log('size', await ev('innerWidth + "x" + innerHeight + " body " + document.body.scrollHeight'));
console.log('ua', await ev('navigator.userAgent'));
console.log('text', JSON.stringify(await ev('document.body.innerText.slice(0, 400)')));
console.log('tree', await ev(`(() => {
  const out = [];
  const walk = (el, d) => {
    if (d > 7 || out.length > 60) return;
    if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') return;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    out.push('  '.repeat(d) + el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '') +
      ' ' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
      ' disp=' + cs.display + ' op=' + cs.opacity + ' vis=' + cs.visibility + (cs.containerType && cs.containerType !== 'normal' ? ' ct=' + cs.containerType : ''));
    for (const c of el.children) walk(c, d + 1);
  };
  walk(document.documentElement, 0);
  return out.join('\\n');
})()`));
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) { (await import('node:fs')).writeFileSync('out/webview-shot.png', Buffer.from(shot.result.data, 'base64')); console.log('saved webview-shot.png'); }
ws.close();
process.exit(0);
