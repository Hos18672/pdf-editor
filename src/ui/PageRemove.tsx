import React, { useEffect, useRef, useState } from 'react';
import { RemovePainter, type Pic } from './scan/EraseEditor';
import type { PixelImage, Stroke } from './scan/kernels';
import { eraseImage, turnStrokes } from './scan/engine';
import type { EditorObject } from '../engine/types';

/** longest side of the page picture painted on (pixels) */
const LONG = 2400;

type Patch = { src: string; x: number; y: number; w: number; h: number };

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

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

/**
 * Remove on a page of the document: the page is drawn as a picture (with the pictures, signatures and
 * whiteouts already put on it), the painted parts are filled in from around them, and the result goes on
 * the page as a picture of just those parts (see-through elsewhere), so it can be moved or deleted later.
 */
export function PageRemove({ pdf, src, rotation, size, objects, onApply, onCancel }: {
  pdf: any; src: number; rotation: number; size: { w: number; h: number }; objects: EditorObject[];
  onApply: (patch: Patch | null) => void; onCancel: () => void;
}) {
  const rot = (((rotation / 90) % 4) + 4) % 4;
  const base = useRef<{ img: PixelImage; s: number } | null>(null);
  const [plain, setPlain] = useState<Pic | null>(null);

  useEffect(() => {
    let gone = false, url = '';
    (async () => {
      const page = await pdf.getPage(src + 1);
      const s = Math.min(3, LONG / Math.max(size.w, size.h));
      const vp = page.getViewport({ scale: s });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d', { willReadFrequently: true })!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      // what is already on the page and covers it
      for (const o of objects) {
        if (o.page !== src) continue;
        x.save();
        x.globalAlpha = o.opacity ?? 1;
        if (o.rot) { x.translate((o.x + o.w / 2) * s, (o.y + o.h / 2) * s); x.rotate(o.rot * Math.PI / 180); x.translate(-(o.x + o.w / 2) * s, -(o.y + o.h / 2) * s); }
        if (o.type === 'image' || o.type === 'signature') { try { x.drawImage(await loadImg(o.src), o.x * s, o.y * s, o.w * s, o.h * s); } catch { /* unreadable */ } }
        else if (o.type === 'whiteout') { x.fillStyle = o.fill; x.fillRect(o.x * s, o.y * s, o.w * s, o.h * s); }
        x.restore();
      }
      if (gone) return;
      const d = x.getImageData(0, 0, c.width, c.height);
      base.current = { img: { w: c.width, h: c.height, data: d.data }, s };
      url = await toUrl(base.current.img, rot);
      if (gone) URL.revokeObjectURL(url);
      else setPlain({ url, w: rot % 2 ? c.height : c.width, h: rot % 2 ? c.width : c.height });
    })().catch(() => onCancel());
    return () => { gone = true; if (url) URL.revokeObjectURL(url); };
  }, [pdf, src]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the strokes on the page as it is in the file (they are painted on it as shown, turned) */
  const unturn = (st: Stroke[]) => turnStrokes(st, (4 - rot) % 4) ?? [];
  // the page's own texture (a printed pattern, paper grain) is copied in, not a smooth blend
  const last = useRef<{ key: string; img: PixelImage; M: Float32Array | null } | null>(null);
  const filled = async (st: Stroke[]) => {
    const key = JSON.stringify(st);
    if (last.current?.key === key) return last.current;
    const r = await eraseImage(base.current!.img, unturn(st), true);
    last.current = { key, img: r.img, M: r.mask };
    return last.current;
  };
  const [saving, setSaving] = useState(false);

  const apply = async (st: Stroke[]) => {
    const b = base.current;
    if (!b || !st.length) { onApply(null); return; }
    setSaving(true);
    const { img, M } = await filled(st);
    if (!M) { onApply(null); return; }
    const w = img.w, h = img.h;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0, p = y * w; x < w; x++, p++) if (M[p] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { onApply(null); return; }
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
    onApply({ src: c.toDataURL('image/png'), x: x0 / b.s, y: y0 / b.s, w: cw / b.s, h: ch / b.s });
  };

  return (
    <RemovePainter plain={plain} aspect={rot % 2 ? size.h / size.w : size.w / size.h} initial={[]}
      hint="Paint over what should go: a stamp, a stain, a note, a logo"
      render={async (st) => { if (!base.current) throw new Error('not ready'); return toUrl((await filled(st)).img, rot); }}
      onApply={(st) => { if (!saving) apply(st).catch(() => onApply(null)); }} onCancel={onCancel} />
  );
}
