import React, { useEffect, useRef, useState } from 'react';
import { RemovePainter, type Pic } from './scan/EraseEditor';
import type { PixelImage, Stroke } from './scan/kernels';
import { eraseImage, turnStrokes } from './scan/engine';
import type { EditorObject, M } from '../engine/types';
import { PDFDocument, PDFName } from 'pdf-lib';
import { cutContent, pageFonts, underStrokes, type CutStroke } from '../engine/cut';
import { readContents } from '../engine/exporter';
import { openPdf } from './pdfjs';

/** longest side of the page picture painted on (pixels) */
const LONG = 2400;

type Patch = { src: string; x: number; y: number; w: number; h: number; cut?: CutStroke[]; vector?: boolean };

/** the page drawn at scale s, with what is already put on it (pictures, signatures, whiteouts) */
async function drawPage(page: any, s: number, objects: EditorObject[], src: number, area?: { x: number; y: number; w: number; h: number }): Promise<PixelImage> {
  const vp = page.getViewport({ scale: s });
  const c = document.createElement('canvas');
  // only an area of it (pixels at scale s): the rest is not needed
  const ax = area?.x ?? 0, ay = area?.y ?? 0;
  c.width = area?.w ?? Math.round(vp.width); c.height = area?.h ?? Math.round(vp.height);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp, ...(area ? { transform: [1, 0, 0, 1, -ax, -ay] } : {}) }).promise;
  if (area) x.translate(-ax, -ay);
  for (const o of objects) {
    if (o.page !== src) continue;
    x.save();
    x.globalAlpha = o.opacity ?? 1;
    if (o.rot) { x.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s); x.rotate(o.rot * Math.PI / 180); x.translate(-(o.x + o.w / 2) * s, -(o.y + o.h / 2) * s); }
    if (o.type === 'image' || o.type === 'signature') { try { x.drawImage(await loadImg(o.src), o.x * s, o.y * s, o.w * s, o.h * s); } catch { /* unreadable */ } }
    else if (o.type === 'whiteout') { x.fillStyle = o.fill; x.fillRect(o.x * s, o.y * s, o.w * s, o.h * s); }
    x.restore();
  }
  const d = x.getImageData(0, 0, c.width, c.height);
  c.width = 0;
  return { w: d.width, h: d.height, data: d.data };
}

/** the page alone in a small document whose content can be cut and drawn again */
async function cutter(bytes: Uint8Array, src: number) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const one = await PDFDocument.create();
  const [pg] = await one.copyPages(doc, [src]);
  one.addPage(pg);
  const original = readContents(one, pg.node);
  const fonts = pageFonts(one, pg.node);
  // one at a time: the page's content is swapped for each cut
  let chain: Promise<unknown> = Promise.resolve();
  return (strokes: CutStroke[], vm: M): Promise<any | null> => {
    const run = chain.then(async () => {
      const body = cutContent(original, fonts, strokes, vm);
      if (!body) return null;
      pg.node.set(PDFName.of('Contents'), one.context.register(one.context.flateStream(body)));
      return openPdf(await one.save());
    });
    chain = run.catch(() => null);
    return run;
  };
}

async function toUrl(img: PixelImage, rot: number): Promise<string> {
  const a = document.createElement('canvas');
  a.width = img.w; a.height = img.h;
  a.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  let c = a;
  if (rot) {
    c = document.createElement('canvas');
    c.width = rot % 2 ? img.h : img.w; c.height = rot % 2 ? img.w : img.h;
    const x = c.getContext('2d')!;
    x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 2); x.drawImage(a, -img.w / 2, -img.h / 2);
  }
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
  return URL.createObjectURL(blob!);
}

/**
 * a mask grown by r pixels: the picture of the change reaches a little past it (it is the same as the
 * page there), so scaled down on screen its edge doesn't let the removed letters' outlines through
 */
function spread(D: Float32Array, w: number, h: number, r: number): Float32Array {
  // separable box max: rows, then columns
  const a = new Float32Array(D.length), o = new Float32Array(D.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (D[y * w + x]) last = x; if (x - last <= r) a[y * w + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (D[y * w + x]) last = x; if (last - x <= r) a[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (a[y * w + x]) last = y; if (y - last <= r) o[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (a[y * w + x]) last = y; if (last - y <= r) o[y * w + x] = 1; }
  }
  return o;
}

/** a promise that gives up after ms (a phone's worker or renderer can stall) */
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

/**
 * Remove on a page of the document: the page is drawn as a picture (with the pictures, signatures and
 * whiteouts already put on it), the painted parts are filled in from around them, and the result goes on
 * the page as a picture of just those parts (see-through elsewhere), so it can be moved or deleted later.
 */
export function PageRemove({ pdf, bytes, vm, src, rotation, size, objects, onApply, onCancel }: {
  pdf: any; bytes: Uint8Array; vm: M; src: number; rotation: number; size: { w: number; h: number }; objects: EditorObject[];
  /** the change, and the painted strokes (page view units) */
  onApply: (patch: Patch | null, area: CutStroke[]) => void; onCancel: () => void;
}) {
  const rot = (((rotation / 90) % 4) + 4) % 4;
  const base = useRef<{ img: PixelImage; s: number } | null>(null);
  // Removes done before on this page are in the page's content (drawn with it, not as their pictures:
  // a picture that didn't load let the removed text come back into the next Remove)
  const prevCuts = objects.flatMap((o) => (o.page === src && o.type === 'image' && o.vector && o.cut?.length ? o.cut : []));
  const others = objects.filter((o) => !(o.type === 'image' && o.vector));
  const [plain, setPlain] = useState<Pic | null>(null);

  useEffect(() => {
    let gone = false, url = '';
    (async () => {
      const s = Math.min(3, LONG / Math.max(size.w, size.h));
      cut.current = cutter(bytes, src).catch(() => null);
      let img: PixelImage | null = null;
      if (prevCuts.length) {
        const fn = await cut.current;
        const doc = fn ? await fn(prevCuts, vm).catch(() => null) : null;
        if (doc) { try { img = await drawPage(await doc.getPage(1), s, others, src); } catch { img = null; } finally { doc.destroy?.(); } }
      }
      img ??= await drawPage(await pdf.getPage(src + 1), s, prevCuts.length ? objects : others, src);
      if (gone) return;
      base.current = { img, s };
      url = await toUrl(img, rot);
      if (gone) URL.revokeObjectURL(url);
      else setPlain({ url, w: rot % 2 ? img.h : img.w, h: rot % 2 ? img.w : img.h });
    })().catch(() => onCancel());
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [pdf, src]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the strokes on the page as it is in the file (they are painted on it as shown, turned) */
  const unturn = (st: Stroke[]) => turnStrokes(st, (4 - rot) % 4) ?? [];
  // the page's own texture (a printed pattern, paper grain) is copied in, not a smooth blend
  const cut = useRef<Promise<((s: CutStroke[], vm: M) => Promise<any | null>) | null> | null>(null);
  type Result = { key: string; img: PixelImage; M: Float32Array | null; cut?: CutStroke[] };
  const last = useRef<Result | null>(null);
  /**
   * Letters, shapes and pictures of the PDF under the paint are taken out of the page itself (its own
   * background shows exactly, at any zoom); when nothing there can be (a scan, a photo), the page's own
   * texture is copied in instead.
   */
  // previews one at a time, newest first: a preview asked for while one runs waits, and only the
  // latest of those waiting is made (phones are slow; overlapping full-page renders ran out of memory)
  const busy = useRef<Promise<unknown>>(Promise.resolve());
  const want = useRef('');
  const filled = (st: Stroke[], force = false): Promise<Result> => {
    const key = JSON.stringify(st);
    if (last.current?.key === key) return Promise.resolve(last.current);
    want.current = key;
    const run = busy.current.then(() => {
      if (last.current?.key === key) return last.current;
      if (want.current !== key && !force) throw new Error('outdated');
      return make(st, key);
    });
    busy.current = run.catch(() => null);
    return run;
  };
  const make = async (st: Stroke[], key: string): Promise<Result> => {
    const b = base.current!, un = unturn(st), L = Math.max(size.w, size.h);
    const strokes: CutStroke[] = un.map((k) => ({ r: k.r * L, pts: k.pts.map((v, i) => v * (i % 2 ? size.h : size.w)) }));
    const fn = await cut.current;
    const doc = fn ? await within(fn([...prevCuts, ...strokes], vm), 30000).catch(() => null) : null;
    if (doc) {
      try {
        // the area round the strokes (what is taken out lies wholly under them), drawn again
        let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
        for (const k of strokes) for (let i = 0; i + 1 < k.pts.length; i += 2) {
          X0 = Math.min(X0, k.pts[i] - k.r); X1 = Math.max(X1, k.pts[i] + k.r); Y0 = Math.min(Y0, k.pts[i + 1] - k.r); Y1 = Math.max(Y1, k.pts[i + 1] + k.r);
        }
        const W = b.img.w, H = b.img.h, pad = 6;
        const ax = Math.max(0, Math.floor(X0 * b.s) - pad), ay = Math.max(0, Math.floor(Y0 * b.s) - pad);
        const aw = Math.min(W, Math.ceil(X1 * b.s) + pad) - ax, ah = Math.min(H, Math.ceil(Y1 * b.s) + pad) - ay;
        if (aw <= 0 || ah <= 0) throw new Error('outside');
        const part = await within(drawPage(await doc.getPage(1), b.s, others, src, { x: ax, y: ay, w: aw, h: ah }), 30000);
        // changes only count near the new strokes (and take the soft edges of the letters along)
        const near = (px: number, py: number) => underStrokes(strokes, px / b.s, py / b.s, 14 / b.s + 4);
        // the whole page with that area put in, and what changed there: the taken-out things
        const img = { w: W, h: H, data: new Uint8ClampedArray(b.img.data) };
        const D = new Float32Array(W * H);
        let changed = 0;
        for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
          const i = (y * aw + x) * 4, p = (y + ay) * W + x + ax, j = p * 4;
          const dd = Math.abs(part.data[i] - b.img.data[j]) + Math.abs(part.data[i + 1] - b.img.data[j + 1]) + Math.abs(part.data[i + 2] - b.img.data[j + 2]);
          img.data[j] = part.data[i]; img.data[j + 1] = part.data[i + 1]; img.data[j + 2] = part.data[i + 2];
          if (dd > 8 && near(x + ax, y + ay)) { D[p] = 1; changed++; }
        }
        if (changed > 20) {
          last.current = { key, img, M: spread(D, W, H, Math.ceil(2.5 * b.s)), cut: strokes };
          return last.current;
        }
      } catch { /* drawn below as before */ } finally { doc.destroy?.(); }
    }
    try {
      const r = await within(eraseImage(b.img, un, true), 30000);
      last.current = { key, img: r.img, M: r.mask };
    } catch {
      // nothing could be done: the page as it was (Done adds nothing)
      last.current = { key, img: b.img, M: null };
    }
    return last.current;
  };
  const [saving, setSaving] = useState(false);

  const apply = async (st: Stroke[]) => {
    const b = base.current;
    const L = Math.max(size.w, size.h);
    const area: CutStroke[] = unturn(st).map((k) => ({ r: k.r * L, pts: k.pts.map((v, i) => v * (i % 2 ? size.h : size.w)) }));
    const onApply0 = onApply;
    const onApply1 = (p: Patch | null) => onApply0(p, area);
    if (!b || !st.length) { onApply1(null); return; }
    setSaving(true);
    const { img, M, cut: cutStrokes } = await filled(st, true);
    if (!M) { onApply1(null); return; }
    const w = img.w, h = img.h;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) if (M[p] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { onApply1(null); return; }
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(w - 1, x1 + 1); y1 = Math.min(h - 1, y1 + 1);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const out = new ImageData(cw, ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const p = (y + y0) * w + x + x0, i = p * 4, j = (y * cw + x) * 4;
      out.data[j] = img.data[i]; out.data[j + 1] = img.data[i + 1]; out.data[j + 2] = img.data[i + 2];
      out.data[j + 3] = Math.round(Math.min(1, M[p] * 1.6) * 255);
    }
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    c.getContext('2d')!.putImageData(out, 0, 0);
    onApply1({ src: c.toDataURL('image/png'), x: x0 / b.s, y: y0 / b.s, w: cw / b.s, h: ch / b.s, ...(cutStrokes ? { cut: cutStrokes, vector: true } : {}) });
  };

  return (
    <RemovePainter plain={plain} aspect={rot % 2 ? size.h / size.w : size.w / size.h} initial={[]}
      hint="Paint over what should go: a stamp, a stain, a note, a logo"
      render={async (st) => { if (!base.current) throw new Error('not ready'); return toUrl((await filled(st)).img, rot); }}
      onApply={(st) => { if (!saving) apply(st).catch(() => onApply(null, [])); }} onCancel={onCancel} />
  );
}
