import React, { useLayoutEffect, useRef, useState } from 'react';
import type { EditorObject } from '../engine/types';
import { BASELINE } from '../engine/exporter';

const W = 248;
const H = 112;
const FAMILY_CSS: Record<string, string> = {
  Helvetica: 'Arial, Helvetica, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};

type Tile = { canvas: HTMLCanvasElement; x0: number; y0: number; w: number; h: number; k: number };

/**
 * Magnifier for placing text: a wide strip above the finger showing the line the text sits on.
 * The page around the text is rendered sharply with pdf.js (not an enlarged screenshot).
 */
export function Loupe({ x, y, page, obj, pdf, pageW, pageH, rotation, zoom }: {
  x: number; y: number; page: number; obj: Extract<EditorObject, { type: 'text' }>; pdf: any;
  pageW: number; pageH: number; rotation: number; zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tile = useRef<Tile | null>(null);
  const busy = useRef(false);
  const [, setTick] = useState(0);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const s = Math.max(zoom * 2, 1.8); // CSS px per page unit inside the magnifier
  const viewW = W / s, viewH = H / s;
  const base = obj.y + obj.size * BASELINE[obj.family];
  // text start sits at ~22% from the left, baseline a bit below the middle
  const fx = obj.x - viewW * 0.22 + viewW / 2;
  const fy = base + viewH * 0.08;

  // (re)render a sharp tile of the page around the focus when needed
  const vx0 = fx - viewW / 2, vy0 = fy - viewH / 2;
  const t = tile.current;
  const covered = t && t.k === s * dpr && vx0 >= t.x0 && vy0 >= t.y0 && vx0 + viewW <= t.x0 + t.w && vy0 + viewH <= t.y0 + t.h;
  if (!covered && !busy.current && pdf) {
    busy.current = true;
    const k = s * dpr;
    const tw = Math.min(viewW * 3, pageW), th = Math.min(viewH * 4, pageH);
    const x0 = Math.max(0, Math.min(pageW - tw, fx - tw / 2));
    const y0 = Math.max(0, Math.min(pageH - th, fy - th / 2));
    (async () => {
      try {
        const pg = await pdf.getPage(page + 1);
        const vp = pg.getViewport({ scale: k });
        const c = document.createElement('canvas');
        c.width = Math.ceil(tw * k); c.height = Math.ceil(th * k);
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await pg.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -x0 * k, -y0 * k] }).promise;
        tile.current = { canvas: c, x0, y0, w: tw, h: th, k };
      } catch { /* keep the fallback */ }
      busy.current = false;
      setTick((n) => n + 1);
    })();
  }

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.translate(-fx, -fy);
    ctx.imageSmoothingQuality = 'high';
    const tl = tile.current;
    if (tl) {
      // fall back to the on-screen page canvas for anything outside the sharp tile
      const src = document.querySelector<HTMLCanvasElement>(`.pageOuter[data-src="${page}"] canvas`);
      if (src?.width) ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, pageW, pageH);
      ctx.drawImage(tl.canvas, tl.x0, tl.y0, tl.w, tl.h);
    } else {
      const src = document.querySelector<HTMLCanvasElement>(`.pageOuter[data-src="${page}"] canvas`);
      if (src?.width) ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, pageW, pageH);
    }
    // baseline guide across the whole strip
    ctx.strokeStyle = 'rgba(201,52,52,.7)';
    ctx.lineWidth = 1 / s;
    ctx.beginPath(); ctx.moveTo(fx - viewW, base); ctx.lineTo(fx + viewW, base); ctx.stroke();
    // left edge guide
    ctx.strokeStyle = 'rgba(29,63,184,.55)';
    ctx.setLineDash([3 / s, 3 / s]);
    ctx.beginPath(); ctx.moveTo(obj.x, fy - viewH); ctx.lineTo(obj.x, fy + viewH); ctx.stroke();
    ctx.setLineDash([]);
    // the text itself
    ctx.fillStyle = obj.color;
    ctx.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? 700 : 400} ${obj.size}px ${FAMILY_CSS[obj.family]}`;
    ctx.textBaseline = 'alphabetic';
    (obj.text || ' ').split('\n').forEach((line, i) => ctx.fillText(line, obj.x, base + obj.size * 1.2 * i));
    ctx.restore();
  });

  const vw = window.innerWidth;
  const left = Math.max(8, Math.min(vw - W - 8, x - W / 2));
  const above = y - H - 84;
  const top = above > 60 ? above : y + 70;
  return (
    <div className="loupe" style={{ left, top, width: W, height: H }} aria-hidden="true">
      <canvas ref={ref} style={{ width: W, height: H }} />
    </div>
  );
}
