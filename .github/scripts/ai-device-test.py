#!/usr/bin/env python3
"""
Writes out/ai-test.js: an expression for cdp-eval.mjs that runs, inside the app's WebView, the
scanner's classical worker and its AI worker on a synthetic curved page (test/scan-bench/sample-curl.jpg)
and reports load / run times, the AI decision and memory. Used by smoke-ai.sh.
"""
import base64, json, os

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
img = base64.b64encode(open(os.path.join(root, 'test/scan-bench/sample-curl.jpg'), 'rb').read()).decode()
meta = json.load(open(os.path.join(root, 'test/scan-bench/sample-curl.json')))
js = r"""
(async () => {
  const out = { ua: navigator.userAgent, cores: navigator.hardwareConcurrency };
  try {
    const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'scan/';
    const get = (u, type) => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', u); x.responseType = type || 'arraybuffer';
      x.onload = () => (x.status === 200 || (x.status === 0 && x.response) ? ok(x.response) : no(new Error('load ' + u))); x.onerror = () => no(new Error('load ' + u)); x.send(); });
    const start = (js) => { const w = new Worker(URL.createObjectURL(new Blob([js], { type: 'application/javascript' }))); let seq = 0; const wait = new Map();
      w.onmessage = (e) => { const t = wait.get(e.data.id); wait.delete(e.data.id); if (t) e.data.err ? t[1](new Error(e.data.err)) : t[0](e.data.r); };
      w.onerror = (e) => { for (const t of wait.values()) t[1](new Error('worker ' + e.message)); };
      return { w, post: (m, tr) => new Promise((ok, no) => { const id = ++seq; wait.set(id, [ok, no]); w.postMessage({ ...m, id }, tr || []); }) }; };
    const bytes = Uint8Array.from(atob('__IMG__'), (c) => c.charCodeAt(0));
    const bmp = () => createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
    const meta = __META__;
    const job = { quad: meta.quad.flat(), bend: null, outW: 1131, outH: 1600, sharpen: 'auto', flatten: 'rows' };
    // classical pipeline (scan worker, as the app runs it)
    const S = start(await get(base + 'worker.js', 'text'));
    let t = performance.now();
    const b0 = await bmp();
    const p = await S.post({ type: 'process', src: { bmp: b0 }, job: { ...job, filter: 'auto', radius: 0 }, orient: false, jpeg: 0.85 }, [b0]);
    out.classicMs = Math.round(performance.now() - t); out.classicTimes = p.times;
    // AI worker: load the runtime and the model, then flatten (twice: cold and warm)
    t = performance.now();
    const [js, wasm, model] = await Promise.all([get(base + 'ai.js', 'text'), get(base + 'ort.wasm'), get(base + 'uvdoc.onnx')]);
    out.loadMs = Math.round(performance.now() - t); out.bytes = { wasm: wasm.byteLength, model: model.byteLength };
    const A = start(js);
    t = performance.now();
    out.init = await A.post({ type: 'init', wasm, model }, [wasm, model]);
    out.initMs = Math.round(performance.now() - t);
    for (const k of ['flat1', 'flat2']) {
      const b = await bmp();
      t = performance.now();
      const r = await A.post({ type: 'flat', src: { bmp: b }, job: { ...job, sharpen: 'off', flatten: null } }, [b]);
      out[k] = { ms: Math.round(performance.now() - t), info: r.info, grid: !!r.grid };
    }
    if (performance.memory) out.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
    A.w.terminate(); S.w.terminate();
  } catch (e) { out.error = String(e && e.stack || e); }
  return JSON.stringify(out);
})()
""".replace('__IMG__', img).replace('__META__', json.dumps(meta))
os.makedirs('out', exist_ok=True)
open('out/ai-test.js', 'w').write(js)
print('out/ai-test.js', len(js), 'chars')
