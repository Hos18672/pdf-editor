// Remove (editor): what lies under the painted strokes is taken out of the page's content, so the page's
// own background (a printed pattern drawn as lines, a tint, a picture behind) shows again exactly.
// Letters, shapes and placed pictures that lie (almost) wholly under the paint go; everything that
// reaches out of it (the background pattern's long lines, a frame) stays.
import { PDFDocument, PDFDict, PDFName, PDFPageLeaf } from 'pdf-lib';
import type { Op } from './contentStream';
import { tokenize, rebuild } from './contentStream';
import { interpret, removeGlyphs, apply, Glyph, M, PathDraw } from './interpreter';
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
    // the middle of the letter, and its left and right halves
    const dx = g.end[0] - g.origin[0], dy = g.end[1] - g.origin[1], len = Math.hypot(dx, dy) || 1;
    const ux = -dy / len * g.height * 0.35, uy = dx / len * g.height * 0.35;
    const pts: [number, number][] = [0.2, 0.5, 0.8].map((t) => [g.origin[0] + dx * t + ux, g.origin[1] + dy * t + uy]);
    if (pts.filter(([x, y]) => inside(x, y)).length >= 2) glyphs.add(g);
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
  for (const d of it.draws) {
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]].map(([u, v]) => apply(d.ctm, u, v));
    if (corners.every(([x, y]) => inside(x, y, slack * k))) blank.set(d.opIndex, '');
  }
  return { glyphs, blank };
}

/** a page's content after the cut (null: nothing under the strokes could be taken out) */
export function cutContent(original: Uint8Array, fonts: (res: string) => FontMetrics | undefined, strokes: CutStroke[], vm: M): Uint8Array | null {
  const ops = tokenize(original);
  const it = interpret(ops, fonts);
  const plan = cutPlan(ops, it, strokes, vm);
  if (!plan.glyphs.size && !plan.blank.size) return null;
  const rep = removeGlyphs(it.glyphs, it.shows, plan.glyphs, fonts);
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
