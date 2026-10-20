import { withCmap } from '../engine/sfnt';
import type { FontInfo } from '../engine/pdfText';

const registered = new Map<string, Promise<string | undefined>>();

/**
 * Register the document's embedded font again under a new name with a Unicode
 * cmap, so typed text renders in the original font. Resolves to the CSS family
 * name, or undefined when the font can't be used this way.
 */
export function registerEditFont(info: FontInfo, pdfjsFont: any): Promise<string | undefined> {
  const key = info.loadedName;
  if (registered.has(key)) return registered.get(key)!;
  const p = (async () => {
    const data: Uint8Array | undefined = pdfjsFont?.data;
    const entries = Object.entries(info.gids);
    if (!data || !entries.length || typeof FontFace === 'undefined') return undefined;
    try {
      const map = new Map<number, number>();
      for (const [ch, gid] of entries) map.set(ch.codePointAt(0)!, gid);
      const bytes = withCmap(data, map);
      const family = `pdfedit_${key.replace(/[^\w-]/g, '_')}`;
      const face = new FontFace(family, bytes.buffer as ArrayBuffer);
      await face.load();
      (document as any).fonts.add(face);
      return family;
    } catch {
      return undefined;
    }
  })();
  registered.set(key, p);
  return p;
}

const metricCache = new Map<string, { a: number; d: number }>();
let measureCtx: CanvasRenderingContext2D | null = null;

/** Font ascent / descent as a fraction of font size, as the browser lays it out. */
export function fontMetrics(fontCss: string): { a: number; d: number } {
  const hit = metricCache.get(fontCss);
  if (hit) return hit;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  let m = { a: 0.9, d: 0.22 };
  if (measureCtx) {
    measureCtx.font = `100px ${fontCss}`;
    const t: any = measureCtx.measureText('Hg');
    if (typeof t.fontBoundingBoxAscent === 'number' && t.fontBoundingBoxAscent > 0) {
      m = { a: t.fontBoundingBoxAscent / 100, d: t.fontBoundingBoxDescent / 100 };
    }
  }
  // only cache once the font is actually available (otherwise metrics are the fallback's)
  const fam = fontCss.split(',')[0].trim();
  try { if ((document as any).fonts?.check?.(`16px ${fam}`)) metricCache.set(fontCss, m); } catch { /* ignore */ }
  return m;
}

/** Offset of the baseline from the top of a line box with the given line height. */
export function baselineInLine(fontCss: string, size: number, lineHeight: number) {
  const { a, d } = fontMetrics(fontCss);
  return (lineHeight - (a + d) * size) / 2 + a * size;
}
