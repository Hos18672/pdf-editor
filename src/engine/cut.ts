// Remove (editor): what lies under the painted strokes is taken out of the page's content, so the page's
// own background (a printed pattern drawn as lines, a tint, a picture behind) shows again exactly.
// Letters, shapes and placed pictures that lie (almost) wholly under the paint go; everything that
// reaches out of it (the background pattern's long lines, a frame) stays.
import { PDFDocument, PDFDict, PDFName, PDFPageLeaf, PDFRef, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';
import type { Op } from './contentStream';
import { tokenize, rebuild } from './contentStream';
import { interpret, hideGlyphs, apply, invert, mul, Glyph, M, PathDraw } from './interpreter';
import { readFontMetrics, FontMetrics } from './fonts';

/** a brush stroke in page view units (scale 1, the page's own rotation): points as x, y pairs, radius */
export interface CutStroke { r: number; pts: number[] }

/** point (page view units) under the strokes */
export function underStrokes(strokes: CutStroke[], x: number, y: number, grow = 0): boolean {
  for (const s of strokes) {
    const r = s.r + grow, P = s.pts;
    if (P.length === 2) { if (Math.hypot(x - P[0], y - P[1]) <= r) return true; continue; }
    for (let i = 0; i + 3 < P.length; i += 2) {
      const ax = P[i], ay = P[i + 1], vx = P[i + 2] - ax, vy = P[i + 3] - ay, vv = vx * vx + vy * vy;
      const t = vv > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / vv)) : 0;
      if (Math.hypot(x - ax - t * vx, y - ay - t * vy) <= r) return true;
    }
  }
  return false;
}

/**
 * The content ops to change so that what lies under the strokes disappears: glyphs to drop, and ops to
 * blank (shapes, placed pictures and forms). `vm`: user space → page view.
 */
export function cutPlan(ops: Op[], it: { glyphs: Glyph[]; draws: { name: string; ctm: M; opIndex: number }[]; paths: PathDraw[] }, strokes: CutStroke[], vm: M) {
  const k = Math.hypot(vm[0], vm[1]) || 1; // view units per user unit
  const inside = (x: number, y: number, grow = 0) => { const [vx, vy] = apply(vm, x, y); return underStrokes(strokes, vx, vy, grow); };
  const glyphs = new Set<Glyph>();
  for (const g of it.glyphs) {
    // a letter the paint touches goes whole: its left edge, middle or right edge, low, half way or high up
    // its body (a small brush over the top of a big letter still takes it; the lines above and below,
    // which the brush only grazes, stay)
    const dx = g.end[0] - g.origin[0], dy = g.end[1] - g.origin[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * g.height, ny = dx / len * g.height;
    let hit = false;
    for (const up of [0.12, 0.35, 0.6]) {
      for (const t of [0.12, 0.5, 0.88]) if (inside(g.origin[0] + dx * t + nx * up, g.origin[1] + dy * t + ny * up)) { hit = true; break; }
      if (hit) break;
    }
    if (hit) glyphs.add(g);
  }
  const blank = new Map<number, string>();
  // a little slack: a stroke painted right along a shape's edge still takes it
  const slack = 1.5 / k;
  for (const p of it.paths) {
    if (p.clip || !p.pts.length) continue;
    if (!p.pts.every(([x, y]) => inside(x, y, slack * k))) continue;
    for (let i = p.start; i <= p.end; i++) {
      const o = ops[i].op;
      if ('m l c v y re h S s f F f* B B* b b*'.split(' ').includes(o)) blank.set(i, '');
    }
  }
  // placed pictures (and forms): wholly under the paint they go; partly under it, a picture's pixels there
  // are filled in from the picture around them (see erasePictures)
  const pictures: { name: string; ctm: M; opIndex: number }[] = [];
  for (const d of it.draws) {
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]].map(([u, v]) => apply(d.ctm, u, v));
    if (corners.every(([x, y]) => inside(x, y, slack * k))) { blank.set(d.opIndex, ''); continue; }
    const v = corners.slice(0, 4).map(([x, y]) => apply(vm, x, y));
    const x0 = Math.min(...v.map((q) => q[0])), x1 = Math.max(...v.map((q) => q[0])), y0 = Math.min(...v.map((q) => q[1])), y1 = Math.max(...v.map((q) => q[1]));
    if (strokes.some((st) => { for (let i = 0; i + 1 < st.pts.length; i += 2) if (st.pts[i] >= x0 - st.r && st.pts[i] <= x1 + st.r && st.pts[i + 1] >= y0 - st.r && st.pts[i + 1] <= y1 + st.r) return true; return false; })) pictures.push(d);
  }
  return { glyphs, blank, pictures };
}

/** a page's content after the cut (null: nothing under the strokes could be taken out) */
export function cutContent(original: Uint8Array, fonts: (res: string) => FontMetrics | undefined, strokes: CutStroke[], vm: M): Uint8Array | null {
  const ops = tokenize(original);
  const it = interpret(ops, fonts);
  const plan = cutPlan(ops, it, strokes, vm);
  if (!plan.glyphs.size && !plan.blank.size) return null;
  const rep = hideGlyphs(it.glyphs, it.shows, plan.glyphs);
  for (const [i, v] of plan.blank) rep.set(i, v);
  return rebuild(original, ops, rep);
}

/**
 * Remove inside forms (content the file keeps in a form XObject: a page placed onto another, a stamp, a
 * whole page wrapped in one): what lies under the strokes is taken out of a copy of the form, and the page
 * draws the copy instead (the original may be drawn on other pages too). Pictures in the form are filled
 * in as on the page. Returns the page's `Do` ops to change; `dry`: only whether anything would go.
 */
export async function cutForms(doc: PDFDocument, resources: PDFDict | undefined, draws: { name: string; ctm: M; opIndex: number }[], strokes: CutStroke[], vm: M, dry = false, depth = 0): Promise<{ found: boolean; rep: Map<number, string> }> {
  const rep = new Map<number, string>();
  let found = false;
  const xo = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo || !draws.length || depth > 3) return { found, rep };
  let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
  for (const st of strokes) for (let i = 0; i + 1 < st.pts.length; i += 2) {
    sx0 = Math.min(sx0, st.pts[i] - st.r); sx1 = Math.max(sx1, st.pts[i] + st.r); sy0 = Math.min(sy0, st.pts[i + 1] - st.r); sy1 = Math.max(sy1, st.pts[i + 1] + st.r);
  }
  const nums = (v: unknown) => (v instanceof PDFArray ? v.asArray().map((n: any) => n?.asNumber?.() ?? 0) : null);
  for (const d of draws) {
    const ref = xo.get(PDFName.of(d.name));
    const st = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
    if (!(st instanceof PDFRawStream) || st.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue;
    const m = nums(st.dict.lookup(PDFName.of('Matrix')));
    const ctm = m && m.length === 6 ? mul(m as M, d.ctm) : d.ctm;
    // the form's box on the page: strokes elsewhere don't reach it
    const bb = nums(st.dict.lookup(PDFName.of('BBox')));
    if (bb && bb.length === 4) {
      const v = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(([x, y]) => { const [ux, uy] = apply(ctm, x, y); return apply(vm, ux, uy); });
      if (Math.max(...v.map((q) => q[0])) < sx0 || Math.min(...v.map((q) => q[0])) > sx1 || Math.max(...v.map((q) => q[1])) < sy0 || Math.min(...v.map((q) => q[1])) > sy1) continue;
    }
    let bytes: Uint8Array;
    try { bytes = decodePDFRawStream(st).decode(); } catch { continue; }
    const res = st.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources;
    const fontDict = res?.lookupMaybe(PDFName.of('Font'), PDFDict);
    const cache = new Map<string, FontMetrics | undefined>();
    const fonts = (r: string) => {
      if (!cache.has(r)) { const fd = fontDict?.lookupMaybe(PDFName.of(r), PDFDict); cache.set(r, fd ? readFontMetrics(doc.context, fd) : undefined); }
      return cache.get(r);
    };
    const ops = tokenize(bytes);
    const it = interpret(ops, fonts, ctm);
    const plan = cutPlan(ops, it, strokes, vm);
    const inner = await cutForms(doc, res, it.draws.filter((x) => !plan.blank.has(x.opIndex)), strokes, vm, dry, depth + 1);
    const any = plan.glyphs.size > 0 || plan.blank.size > 0 || plan.pictures.length > 0 || inner.found;
    if (!any) continue;
    found = true;
    if (dry) return { found, rep };
    if (plan.pictures.length) await erasePictures(doc, res, plan.pictures, strokes, vm).catch((err) => console.warn('remove in form pictures', err));
    if (!plan.glyphs.size && !plan.blank.size && !inner.rep.size) continue;
    const r = hideGlyphs(it.glyphs, it.shows, plan.glyphs);
    for (const [i, v] of plan.blank) r.set(i, v);
    for (const [i, v] of inner.rep) r.set(i, v);
    const dict = doc.context.obj({}) as PDFDict;
    for (const [k, v] of st.dict.entries()) if (!['/Filter', '/DecodeParms', '/Length'].includes(k.toString())) dict.set(k, v);
    if (!st.dict.get(PDFName.of('Resources')) && res) dict.set(PDFName.of('Resources'), res);
    const copy = doc.context.register(doc.context.flateStream(rebuild(bytes, ops, r), {}));
    const made = doc.context.lookup(copy) as PDFRawStream;
    for (const [k, v] of dict.entries()) made.dict.set(k, v);
    let name = `${d.name}c`, n = 0;
    while (xo.get(PDFName.of(name))) name = `${d.name}c${++n}`;
    xo.set(PDFName.of(name), copy);
    rep.set(d.opIndex, `/${name} Do`);
  }
  return { found, rep };
}

/** the font metrics of a page's fonts, by resource name */
export function pageFonts(doc: PDFDocument, leaf: PDFPageLeaf): (res: string) => FontMetrics | undefined {
  const fontDict = leaf.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  const cache = new Map<string, FontMetrics | undefined>();
  return (res: string) => {
    if (!cache.has(res)) {
      const fd = fontDict?.lookupMaybe(PDFName.of(res), PDFDict);
      cache.set(res, fd ? readFontMetrics(doc.context, fd) : undefined);
    }
    return cache.get(res);
  };
}

/**
 * Pictures already filled in, kept between calls (the editor's live view writes the page again after
 * every stroke): with the strokes of a call extending those of an earlier one, only the new strokes are
 * filled in, on the earlier result; with the same strokes the earlier picture is used as it is.
 */
type Done = { sig: string[]; px: { w: number; h: number; rgba: Uint8ClampedArray; gray: boolean }; mask?: { w: number; h: number; rgba: Uint8ClampedArray }; jpeg: Uint8Array; maskBytes?: Uint8Array };
const doneCache = new Map<string, Done>();
const CACHE_MAX = 4;

/**
 * Pixels of placed pictures under the strokes, filled in from the picture around them (copied texture;
 * a see-through mask is filled too, so a cut-out logo goes see-through where it was painted over).
 * `strokes` in page view units, `vm` user space → page view. Pictures drawn inside forms are left.
 */
export async function erasePictures(doc: PDFDocument, resources: PDFDict | undefined, pictures: { name: string; ctm: M }[], strokes: CutStroke[], vm: M): Promise<void> {
  const xo = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  if (!xo || !pictures.length) return;
  const { decodeImage, writeJpeg } = await import('./images');
  const { scanKernels } = await import('../ui/scan/kernels');
  const K = scanKernels();
  const back = invert(vm), k = Math.hypot(vm[0], vm[1]) || 1;
  const done = new Set<string>();
  const num = (v: unknown) => (v as any)?.asNumber?.() ?? 0;
  for (const d of pictures) {
    const ref = xo.get(PDFName.of(d.name));
    if (!(ref instanceof PDFRef) || done.has(ref.toString())) continue;
    const st = doc.context.lookup(ref);
    if (!(st instanceof PDFRawStream) || st.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    const W = num(st.dict.get(PDFName.of('Width'))), H = num(st.dict.get(PDFName.of('Height')));
    if (!W || !H) continue;
    // the strokes on the picture: fractions of its width and height, radius × its longer side
    const inv = invert(d.ctm);
    const sx = W / (Math.hypot(d.ctm[0], d.ctm[1]) || 1), sy = H / (Math.hypot(d.ctm[2], d.ctm[3]) || 1);
    const L = Math.max(W, H);
    const local = strokes.map((s) => {
      const pts: number[] = [];
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const [ux, uy] = apply(back, s.pts[i], s.pts[i + 1]);
        const [u, v] = apply(inv, ux, uy);
        pts.push(u, 1 - v);
      }
      return { r: ((s.r / k) * (sx + sy) / 2) / L, pts };
    });
    const sig = local.map((s) => JSON.stringify(s));
    const smRef = st.dict.get(PDFName.of('SMask'));
    const smObj = smRef instanceof PDFRef ? doc.context.lookup(smRef) : null;
    const sm = smObj instanceof PDFRawStream ? smObj : null;
    // the same picture of the same file (its place in the file, size and bytes' length and ends)
    const c0 = st.contents, key = `${ref.toString()}|${W}x${H}|${c0.length}|${c0[0]},${c0[c0.length >> 1]},${c0[c0.length - 1]}|${smRef?.toString() ?? ''}`;
    const prev = doneCache.get(key);
    const same = prev && prev.sig.length === sig.length && prev.sig.every((v, i) => v === sig[i]);
    if (same) {
      // nothing new on this picture: the earlier result as it is
      await writeBack(doc, ref, st, prev.jpeg, prev.px);
      if (sm && smRef instanceof PDFRef && prev.maskBytes && prev.mask) assignMask(doc, smRef, prev.mask.w, prev.mask.h, prev.maskBytes);
      done.add(ref.toString());
      continue;
    }
    const grows = prev && prev.sig.length < sig.length && prev.sig.every((v, i) => v === sig[i]);
    const todo = grows ? local.slice(prev!.sig.length) : local;
    const px = grows ? { ...prev!.px, rgba: new Uint8ClampedArray(prev!.px.rgba) } : await decodeImage(doc, st).catch(() => null);
    if (!px) continue;
    const img = { w: px.w, h: px.h, data: px.rgba };
    const M0 = K.erase(img, todo, true);
    if (!grows && (!M0 || !M0.some((v) => v > 0.02))) continue;
    // a see-through mask: the same strokes filled in it (smoothly)
    let mask: Done['mask'], maskBytes: Uint8Array | undefined;
    if (sm && smRef instanceof PDFRef) {
      const mp = grows && prev!.mask ? { w: prev!.mask.w, h: prev!.mask.h, rgba: new Uint8ClampedArray(prev!.mask.rgba) } : await decodeImage(doc, sm).catch(() => null);
      if (mp && mp.w > 0) {
        K.erase({ w: mp.w, h: mp.h, data: mp.rgba }, grows && prev!.mask ? todo : local, false);
        maskBytes = new Uint8Array(mp.w * mp.h);
        for (let i = 0; i < maskBytes.length; i++) maskBytes[i] = mp.rgba[i * 4];
        assignMask(doc, smRef, mp.w, mp.h, maskBytes);
        mask = { w: mp.w, h: mp.h, rgba: mp.rgba };
      }
    }
    await writeJpeg(doc, ref, st, px, 0.92);
    const out = doc.context.lookup(ref);
    if (out instanceof PDFRawStream) {
      doneCache.delete(key);
      doneCache.set(key, { sig, px: { w: px.w, h: px.h, rgba: px.rgba, gray: !!px.gray }, mask, maskBytes, jpeg: out.contents });
      while (doneCache.size > CACHE_MAX) doneCache.delete(doneCache.keys().next().value!);
    }
    done.add(ref.toString());
  }
}

function assignMask(doc: PDFDocument, ref: PDFRef, w: number, h: number, gray: Uint8Array) {
  doc.context.assign(ref, doc.context.flateStream(gray, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
}

/** a picture written earlier (JPEG bytes) put back in place of the original */
async function writeBack(doc: PDFDocument, ref: PDFRef, old: PDFRawStream, jpeg: Uint8Array, px: { w: number; h: number }) {
  const dict = doc.context.obj({ Type: 'XObject', Subtype: 'Image', Width: px.w, Height: px.h, BitsPerComponent: 8, ColorSpace: 'DeviceRGB', Filter: 'DCTDecode' }) as PDFDict;
  for (const keep of ['SMask', 'Mask', 'Interpolate', 'Intent']) {
    const v = old.dict.get(PDFName.of(keep));
    if (v) dict.set(PDFName.of(keep), v);
  }
  doc.context.assign(ref, PDFRawStream.of(dict, jpeg));
}
