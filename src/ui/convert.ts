// Turning other files into PDFs on the device. Heavy libraries are loaded only when needed.
import { PDFDocument } from 'pdf-lib';
import { addImagePage, imageBytes, PageSize } from './pdfops';

export interface ConvertOptions { size: PageSize; orient: 'auto' | 'portrait' | 'landscape'; margin: 'none' | 'small' | 'normal' }
export type Progress = (f: number) => void;

export const KINDS: Record<string, { label: string; accept: string; exts: string[] }> = {
  image: { label: 'Images', accept: 'image/*,.heic,.heif', exts: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'] },
  word: { label: 'Word', accept: '.docx', exts: ['docx'] },
  excel: { label: 'Excel', accept: '.xlsx,.xls,.csv,.ods,.tsv', exts: ['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods'] },
  ppt: { label: 'PowerPoint', accept: '.pptx', exts: ['pptx'] },
  text: { label: 'Text & web', accept: '.txt,.md,.markdown,.html,.htm', exts: ['txt', 'md', 'markdown', 'html', 'htm', 'text', 'log'] },
};
export const ALL_ACCEPT = Object.values(KINDS).map((k) => k.accept).join(',');

export function kindOf(name: string, type = ''): string | null {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  for (const [k, v] of Object.entries(KINDS)) if (v.exts.includes(ext)) return k;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('text/')) return 'text';
  return null;
}

const MARGIN = { none: 0, small: 28, normal: 56 };
const PAPER = { a4: [595.28, 841.89], letter: [612, 792] } as const;

/** Convert one file to PDF bytes. Throws Error('unsupported') for formats we can't do well here. */
export async function convertFile(file: File, opt: ConvertOptions, progress: Progress): Promise<{ bytes: Uint8Array; pages: number }> {
  const kind = kindOf(file.name, file.type);
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  const doc = await PDFDocument.create();
  if (kind === 'image') {
    progress(0.3);
    await addImagePage(doc, await imageBytes(file), opt.size, MARGIN[opt.margin]);
  } else if (kind === 'ppt') {
    await pptxToPdf(doc, file, progress);
  } else {
    let html: string;
    let css = '';
    if (kind === 'word') {
      const mammoth: any = await import('mammoth');
      progress(0.15);
      const r = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      html = r.value;
      css = 'body{font-family:Carlito,Calibri,Arial,sans-serif;font-size:11pt;line-height:1.35}p{margin:0 0 8pt}table{border-collapse:collapse;margin:6pt 0}td,th{border:1px solid #999;padding:3pt 5pt;vertical-align:top}img{max-width:100%;height:auto}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}';
    } else if (kind === 'excel') {
      const XLSX: any = await import('xlsx');
      progress(0.15);
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
      html = wb.SheetNames.map((n: string, i: number) => {
        const t = XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' });
        return `<section class="${i ? 'pb' : ''}"><h2>${esc(n)}</h2>${t}</section>`;
      }).join('');
      css = 'body{font-family:Arial,sans-serif;font-size:9pt}h2{font-size:12pt;margin:0 0 6pt}table{border-collapse:collapse}td,th{border:1px solid #c8c8c8;padding:2pt 4pt;white-space:nowrap}';
    } else if (kind === 'text') {
      const text = await file.text();
      if (ext === 'html' || ext === 'htm') html = text;
      else if (ext === 'md' || ext === 'markdown') {
        const { marked } = await import('marked');
        html = await marked.parse(text);
        css = 'body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.45}pre{background:#f4f4f4;padding:8pt;white-space:pre-wrap}code{font-family:Courier New,monospace}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:3pt 5pt}img{max-width:100%}';
      } else {
        html = `<pre>${esc(text)}</pre>`;
        css = 'pre{font-family:"Courier New",monospace;font-size:10pt;white-space:pre-wrap;word-break:break-word;margin:0}';
      }
    } else throw new Error('unsupported');
    await htmlToPdf(doc, html, css, opt, kind === 'excel', progress);
  }
  progress(0.97);
  return { bytes: await doc.save({ useObjectStreams: true }), pages: doc.getPageCount() };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Remove scripts, event handlers and anything that would load from the network. */
function sanitize(html: string): { body: string; style: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, link, meta, base, form, noscript').forEach((n) => n.remove());
  let style = '';
  doc.querySelectorAll('style').forEach((n) => { style += (n.textContent ?? '').replace(/@import[^;]+;/g, '').replace(/url\(\s*['"]?(?!data:)[^)]*\)/g, 'none'); n.remove(); });
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'src' || n === 'srcset' || n === 'href' || n === 'xlink:href' || n === 'poster' || n === 'background') && !v.startsWith('data:') && !v.startsWith('#')) {
        if (n === 'href' && el.tagName === 'A') continue; // links don't load anything
        el.removeAttribute(a.name);
      } else if (n === 'style' && /url\(/i.test(v)) el.setAttribute('style', a.value.replace(/url\(\s*['"]?(?!data:)[^)]*\)/gi, 'none'));
    }
  });
  return { body: doc.body?.innerHTML ?? '', style };
}

/** Lay out HTML at the page width, break it into pages between blocks, and print each page as an image. */
async function htmlToPdf(doc: PDFDocument, html: string, css: string, opt: ConvertOptions, wide: boolean, progress: Progress) {
  const html2canvas: any = (await import('html2canvas')).default;
  const { body, style } = sanitize(html);
  let [pw, ph]: number[] = [...PAPER[opt.size === 'letter' ? 'letter' : 'a4']];
  if (opt.orient === 'landscape' || (opt.orient === 'auto' && wide)) [pw, ph] = [ph, pw];
  const m = MARGIN[opt.margin];
  const PX = 96 / 72; // CSS px per pt
  const cw = (pw - 2 * m) * PX, chH = (ph - 2 * m) * PX;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${cw}px;background:#fff;color:#000;`;
  const shadowHost = document.createElement('div');
  shadowHost.className = 'convert-root';
  shadowHost.innerHTML = `<style>.convert-root{all:initial;display:block;font-family:Arial,sans-serif;font-size:11pt;color:#000;background:#fff;line-height:1.4;width:${cw}px;overflow-wrap:break-word}
    .convert-root *{box-sizing:border-box}.convert-root img{max-width:100%}.convert-root table{max-width:100%}
    ${scope(css)}${scope(style)}</style><div class="cbody">${body}</div>`;
  host.appendChild(shadowHost);
  document.body.appendChild(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete ? null : im.decode().catch(() => null))));
    await (document as any).fonts?.ready;
    // wide tables: shrink to fit the page width
    const root = host.querySelector<HTMLElement>('.cbody')!;
    const sw = root.scrollWidth;
    let k = 1;
    if (sw > cw + 1) { k = cw / sw; root.style.transform = `scale(${k})`; root.style.transformOrigin = '0 0'; root.style.width = `${sw}px`; }
    const total = root.scrollHeight * k;
    // break points: bottoms of blocks; forced breaks before .pb
    const top0 = root.getBoundingClientRect().top;
    const blocks = [...root.querySelectorAll<HTMLElement>('p,li,tr,h1,h2,h3,h4,h5,h6,pre,img,blockquote,div,section,table,hr,dt,dd,figure')];
    const ends = new Set<number>();
    const forced: number[] = [];
    for (const b of blocks) {
      const r = b.getBoundingClientRect();
      ends.add(Math.round(r.bottom - top0));
      if (b.classList.contains('pb')) forced.push(Math.round(r.top - top0));
    }
    const sorted = [...ends].sort((a, b) => a - b);
    const cuts: number[] = [0];
    while (cuts[cuts.length - 1] < total - 1) {
      const start = cuts[cuts.length - 1];
      const limit = start + chH;
      const f = forced.find((y) => y > start + 4 && y < limit);
      if (f !== undefined) { cuts.push(f); continue; }
      if (limit >= total) { cuts.push(total); break; }
      const cand = sorted.filter((y) => y > start + chH * 0.5 && y <= limit);
      cuts.push(cand.length ? cand[cand.length - 1] : limit);
    }
    const n = cuts.length - 1;
    const scale = 2;
    // the text as laid out (lines with position and size), written as an invisible layer so the
    // converted PDF can be searched and edited like an OCR'd scan
    const lines = layoutLines(root);
    const { addTextLayer } = await import('../engine/textLayer');
    const { StandardFonts } = await import('pdf-lib');
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    // print each page through a window the size of the page
    host.style.overflow = 'hidden';
    for (let i = 0; i < n; i++) {
      const y0 = cuts[i], h = Math.max(1, Math.ceil(cuts[i + 1] - cuts[i]));
      host.style.height = `${h}px`;
      shadowHost.style.transform = `translateY(${-y0}px)`;
      const canvas = await html2canvas(host, { backgroundColor: '#ffffff', scale, logging: false, useCORS: false });
      const jpg: Blob = await new Promise((res) => canvas.toBlob((b: Blob) => res(b), 'image/jpeg', 0.9));
      const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const page = doc.addPage([pw, ph]);
      page.drawImage(img, { x: m, y: ph - m - h / PX, width: cw / PX, height: h / PX });
      const onPage = lines.filter((l) => l.base >= y0 && l.base < y0 + h);
      await addTextLayer(doc, page, onPage.map((l) => ({
        text: l.text, size: l.size / PX,
        x0: m + l.x0 / PX, x1: m + l.x1 / PX, y0: ph - m - (l.base - y0) / PX, y1: ph - m - (l.base - y0) / PX,
      })), helv);
      progress(0.3 + 0.65 * ((i + 1) / n));
    }
  } finally {
    host.remove();
  }
}

/** Lines of text as laid out in the conversion box (CSS px, relative to its top-left; scaled boxes included). */
function layoutLines(root: HTMLElement): { text: string; x0: number; x1: number; base: number; size: number }[] {
  const r0 = root.getBoundingClientRect();
  type W = { t: string; x0: number; x1: number; top: number; bottom: number; size: number; block: Element | null };
  const words: W[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const el = node.parentElement;
    if (!el || !node.data.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const k = el.getBoundingClientRect().height && el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1;
    const size = parseFloat(cs.fontSize) * (k || 1);
    const block = el.closest('p,li,td,th,h1,h2,h3,h4,h5,h6,pre,blockquote,dt,dd,figcaption,div');
    for (const m of node.data.matchAll(/\S+/g)) {
      range.setStart(node, m.index!);
      range.setEnd(node, m.index! + m[0].length);
      const rects = range.getClientRects();
      const rc = rects[0];
      if (!rc || !rc.width) continue;
      words.push({ t: m[0], x0: rc.left - r0.left, x1: rc.right - r0.left, top: rc.top - r0.top, bottom: rc.bottom - r0.top, size, block });
    }
  }
  // words on the same visual line of the same block, close together → one line
  words.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const lines: { ws: W[] }[] = [];
  for (const w of words) {
    const l = lines.find((x) => {
      const last = x.ws[x.ws.length - 1];
      return last.block === w.block && Math.abs(last.bottom - w.bottom) < w.size * 0.4 && w.x0 >= last.x1 - 1 && w.x0 - last.x1 < w.size * 1.5;
    });
    if (l) l.ws.push(w); else lines.push({ ws: [w] });
  }
  return lines.map(({ ws }) => {
    const size = Math.max(...ws.map((w) => w.size));
    const bottom = Math.max(...ws.map((w) => w.bottom));
    return { text: ws.map((w) => w.t).join(' '), x0: ws[0].x0, x1: ws[ws.length - 1].x1, base: bottom - size * 0.22, size };
  });
}

/** Prefix every selector so a document's own CSS stays inside the conversion box. */
function scope(css: string): string {
  return css.replace(/(^|})\s*([^{}@]+)\{/g, (_m, close, sel) => `${close} ${sel.split(',').map((s: string) => {
    const t = s.trim();
    if (!t) return t;
    if (/^(html|body|:root)$/i.test(t)) return '.convert-root .cbody';
    return `.convert-root ${t.replace(/^(html|body)\s+/i, '')}`;
  }).join(', ')}{`);
}

// ---------------- PowerPoint (.pptx): text boxes, shapes and pictures ----------------

const EMU_PX = 96 / 914400;

async function pptxToPdf(doc: PDFDocument, file: File, progress: Progress) {
  const JSZip = (await import('jszip')).default;
  const html2canvas: any = (await import('html2canvas')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = async (path: string) => { const f = zip.file(path); return f ? new DOMParser().parseFromString(await f.async('text'), 'application/xml') : null; };
  const pres = await xml('ppt/presentation.xml');
  if (!pres) throw new Error('unsupported');
  const sz = pres.getElementsByTagName('p:sldSz')[0];
  const sw = +(sz?.getAttribute('cx') ?? 12192000), sh = +(sz?.getAttribute('cy') ?? 6858000);
  const rels = await xml('ppt/_rels/presentation.xml.rels');
  const relMap = new Map<string, string>();
  for (const r of [...(rels?.getElementsByTagName('Relationship') ?? [])]) relMap.set(r.getAttribute('Id')!, r.getAttribute('Target')!);
  const ids = [...pres.getElementsByTagName('p:sldId')].map((e) => e.getAttribute('r:id')!);
  const slides = ids.map((id) => 'ppt/' + relMap.get(id)!.replace(/^\/?ppt\//, '').replace(/^\.\.\//, ''));
  const W = sw * EMU_PX, H = sh * EMU_PX;
  for (let si = 0; si < slides.length; si++) {
    const path = slides[si];
    const sx = await xml(path);
    if (!sx) continue;
    const relPath = path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
    const srels = await xml(relPath);
    const media = new Map<string, string>();
    for (const r of [...(srels?.getElementsByTagName('Relationship') ?? [])]) {
      const t = r.getAttribute('Target') ?? '';
      if (!/media\//.test(t)) continue;
      const mp = 'ppt/' + t.replace(/^\.\.\//, '');
      const f = zip.file(mp);
      if (!f) continue;
      const ext = mp.split('.').pop()!.toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
      if (!['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) continue;
      media.set(r.getAttribute('Id')!, `data:${mime};base64,${await f.async('base64')}`);
    }
    // placeholders without their own position take it from the slide layout
    const layoutTarget = [...(srels?.getElementsByTagName('Relationship') ?? [])].find((r) => /slideLayout/.test(r.getAttribute('Target') ?? ''))?.getAttribute('Target');
    const layout = layoutTarget ? await xml('ppt/' + layoutTarget.replace(/^\.\.\//, '')) : null;
    const phXfrm = (ph: Element | undefined) => {
      if (!ph || !layout) return null;
      const type = ph.getAttribute('type') ?? 'body', idx = ph.getAttribute('idx');
      for (const sp of [...layout.getElementsByTagName('p:sp')]) {
        const lph = sp.getElementsByTagName('p:ph')[0];
        if (!lph) continue;
        const lt = lph.getAttribute('type') ?? 'body';
        const same = (idx && lph.getAttribute('idx') === idx) || lt === type || (type === 'ctrTitle' && lt === 'title') || (type === 'subTitle' && lt === 'body');
        const x = sp.getElementsByTagName('a:xfrm')[0];
        if (same && x) return x;
      }
      return null;
    };
    const bg = sx.getElementsByTagName('p:bg')[0]?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
    let out = '';
    let flowY = 0.06 * H;
    const shapes = [...sx.getElementsByTagName('p:spTree')[0]?.children ?? []];
    const walk = (els: Element[], off: [number, number], scl: [number, number]) => {
      for (const el of els) {
        const tag = el.tagName;
        const ph = el.getElementsByTagName('p:ph')[0];
        const xfrm = el.getElementsByTagName('a:xfrm')[0] ?? phXfrm(ph);
        const o = xfrm?.getElementsByTagName('a:off')[0], ex = xfrm?.getElementsByTagName('a:ext')[0];
        let x = o ? +o.getAttribute('x')! * EMU_PX : 0.06 * W, y = o ? +o.getAttribute('y')! * EMU_PX : flowY;
        let w = ex ? +ex.getAttribute('cx')! * EMU_PX : 0.88 * W, h = ex ? +ex.getAttribute('cy')! * EMU_PX : 0;
        x = off[0] + x * scl[0]; y = off[1] + y * scl[1]; w *= scl[0]; h *= scl[1];
        if (tag === 'p:grpSp') {
          const g = el.getElementsByTagName('a:xfrm')[0];
          const co = g?.getElementsByTagName('a:chOff')[0], ce = g?.getElementsByTagName('a:chExt')[0];
          const cx = co ? +co.getAttribute('x')! * EMU_PX : 0, cy = co ? +co.getAttribute('y')! * EMU_PX : 0;
          const cw = ce ? +ce.getAttribute('cx')! * EMU_PX : w, chh = ce ? +ce.getAttribute('cy')! * EMU_PX : h;
          const k: [number, number] = [cw ? w / cw : 1, chh ? h / chh : 1];
          walk([...el.children].filter((c) => c.tagName !== 'p:grpSpPr' && c.tagName !== 'p:nvGrpSpPr'), [x - cx * k[0], y - cy * k[1]], k);
          continue;
        }
        if (tag === 'p:pic') {
          const id = el.getElementsByTagName('a:blip')[0]?.getAttribute('r:embed');
          const src = id ? media.get(id) : undefined;
          if (src) out += `<img src="${src}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:fill">`;
          continue;
        }
        if (tag !== 'p:sp') continue;
        const spPr = el.getElementsByTagName('p:spPr')[0];
        const fill = spPr && [...spPr.children].find((c) => c.tagName === 'a:solidFill')?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
        const ln = spPr?.getElementsByTagName('a:ln')[0];
        const lnc = ln?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
        const geom = spPr?.getElementsByTagName('a:prstGeom')[0]?.getAttribute('prst');
        const body = el.getElementsByTagName('p:txBody')[0];
        const anchor = body?.getElementsByTagName('a:bodyPr')[0]?.getAttribute('anchor');
        let text = '';
        for (const p of [...(body?.getElementsByTagName('a:p') ?? [])]) {
          const algn = p.getElementsByTagName('a:pPr')[0]?.getAttribute('algn');
          const bullet = p.getElementsByTagName('a:buChar')[0]?.getAttribute('char');
          let line = '';
          for (const r of [...p.children].filter((c) => c.tagName === 'a:r' || c.tagName === 'a:br' || c.tagName === 'a:fld')) {
            if (r.tagName === 'a:br') { line += '<br>'; continue; }
            const rp = r.getElementsByTagName('a:rPr')[0];
            const szv = rp?.getAttribute('sz');
            const col = rp?.getElementsByTagName('a:srgbClr')[0]?.getAttribute('val');
            const st = [
              szv ? `font-size:${(+szv / 100) * (96 / 72)}px` : '', rp?.getAttribute('b') === '1' ? 'font-weight:700' : '',
              rp?.getAttribute('i') === '1' ? 'font-style:italic' : '', col ? `color:#${col}` : '', rp?.getAttribute('u') && rp.getAttribute('u') !== 'none' ? 'text-decoration:underline' : '',
            ].filter(Boolean).join(';');
            line += `<span style="${st}">${esc(r.getElementsByTagName('a:t')[0]?.textContent ?? '')}</span>`;
          }
          const ta = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : algn === 'l' ? 'left' : 'inherit';
          text += `<div style="text-align:${ta};min-height:1em">${bullet && line ? esc(bullet) + ' ' : ''}${line}</div>`;
        }
        if (!h) h = Math.max(40, (body?.getElementsByTagName('a:p').length ?? 1) * 32);
        if (!o) flowY += h + 12;
        const radius = geom === 'ellipse' ? 'border-radius:50%;' : geom === 'roundRect' ? 'border-radius:12px;' : '';
        const jc = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
        const pt = /title/i.test(ph?.getAttribute('type') ?? '') ? (ph?.getAttribute('type') === 'ctrTitle' ? 44 : 36) : ph ? 22 : 18;
        const jc2 = anchor ? jc : /title/i.test(ph?.getAttribute('type') ?? '') ? 'center' : jc;
        out += `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;${fill ? `background:#${fill};` : ''}${lnc ? `border:1px solid #${lnc};` : ''}${radius}display:flex;flex-direction:column;justify-content:${jc2};${ph?.getAttribute('type') === 'ctrTitle' || ph?.getAttribute('type') === 'subTitle' ? 'text-align:center;' : ''}padding:4px 8px;font-size:${pt * 96 / 72}px;line-height:1.15;overflow:hidden">${text}</div>`;
      }
    };
    walk(shapes, [0, 0], [1, 1]);
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-30000px;top:0;width:${W}px;height:${H}px;background:${bg ? '#' + bg : '#fff'};color:#000;font-family:Calibri,Carlito,Arial,sans-serif;overflow:hidden`;
    host.innerHTML = `<div style="position:relative;width:${W}px;height:${H}px">${out}</div>`;
    document.body.appendChild(host);
    try {
      await Promise.all([...host.querySelectorAll('img')].map((im) => im.decode().catch(() => null)));
      const canvas = await html2canvas(host, { backgroundColor: bg ? '#' + bg : '#ffffff', scale: Math.min(2, 1920 / W * 1.5), logging: false });
      const jpg: Blob = await new Promise((res) => canvas.toBlob((b: Blob) => res(b), 'image/jpeg', 0.9));
      const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const pw = sw / 12700, ph = sh / 12700;
      doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    } finally { host.remove(); }
    progress(0.1 + 0.85 * ((si + 1) / slides.length));
  }
  if (!doc.getPageCount()) throw new Error('No slides found');
}
