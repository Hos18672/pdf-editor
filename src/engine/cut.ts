// Remove (editor): what lies under the painted strokes is taken out of the page's content, so the page's
// own background (a printed pattern drawn as lines, a tint, a picture behind) shows again exactly.
// Letters, shapes and placed pictures that lie (almost) wholly under the paint go; everything that
// reaches out of it (the background pattern's long lines, a frame) stays.
import { PDFDocument, PDFDict, PDFName, PDFPageLeaf, PDFRef, PDFRawStream } from 'pdf-lib';
import type { Op } from './contentStream';
import { tokenize, rebuild } from './contentStream';
import { interpret, hideGlyphs, apply, invert, Glyph, M, PathDraw } from './interpreter';
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
    // a letter the paint touches goes whole (its left edge, middle or right edge, half way up; not the
    // lines above and below, which the brush only grazes)
    const dx = g.end[0] - g.origin[0], dy = g.end[1] - g.origin[1], len = Math.hypot(dx, dy) || 1;
    const ux = -dy / len * g.height * 0.35, uy = dx / len * g.height * 0.35;
    const pts: [number, number][] = [0.12, 0.5, 0.88].map((t) => [g.origin[0] + dx * t + ux, g.origin[1] + dy * t + uy]);
    if (pts.some(([x, y]) => inside(x, y))) glyphs.add(g);
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
  for (const d of pictures) {
    const ref = xo.get(PDFName.of(d.name));
    if (!(ref instanceof PDFRef) || done.has(ref.toString())) continue;
    const st = doc.context.lookup(ref);
    if (!(st instanceof PDFRawStream) || st.dict.get(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
    const px = await decodeImage(doc, st).catch(() => null);
    if (!px) continue;
    // the strokes on the picture: fractions of its width and height, radius × its longer side
    const inv = invert(d.ctm);
    const sx = px.w / (Math.hypot(d.ctm[0], d.ctm[1]) || 1), sy = px.h / (Math.hypot(d.ctm[2], d.ctm[3]) || 1);
    const L = Math.max(px.w, px.h);
    const local = strokes.map((s) => {
      const pts: number[] = [];
      for (let i = 0; i + 1 < s.pts.length; i += 2) {
        const [ux, uy] = apply(back, s.pts[i], s.pts[i + 1]);
        const [u, v] = apply(inv, ux, uy);
        pts.push(u, 1 - v);
      }
      return { r: ((s.r / k) * (sx + sy) / 2) / L, pts };
    });
    const img = { w: px.w, h: px.h, data: px.rgba };
    const M0 = K.erase(img, local, true);
    if (!M0 || !M0.some((v) => v > 0.02)) continue;
    // a see-through mask: the same strokes filled in it (smoothly)
    const smRef = st.dict.get(PDFName.of('SMask'));
    const smObj = smRef instanceof PDFRef ? doc.context.lookup(smRef) : null;
    const sm = smObj instanceof PDFRawStream ? smObj : null;
    if (sm && smRef instanceof PDFRef) {
      const mp = await decodeImage(doc, sm).catch(() => null);
      if (mp && mp.w > 0) {
        const mk = { w: mp.w, h: mp.h, data: mp.rgba };
        K.erase(mk, local, false);
        const gray = new Uint8Array(mp.w * mp.h);
        for (let i = 0; i < gray.length; i++) gray[i] = mp.rgba[i * 4];
        doc.context.assign(smRef, doc.context.flateStream(gray, { Type: 'XObject', Subtype: 'Image', Width: mp.w, Height: mp.h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
      }
    }
    await writeJpeg(doc, ref, st, px, 0.92);
    done.add(ref.toString());
  }
}
