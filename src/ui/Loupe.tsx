import React, { useLayoutEffect, useRef } from 'react';
import type { EditorObject } from '../engine/types';
import { BASELINE } from '../engine/exporter';

const SIZE = 156;
const FAMILY_CSS: Record<string, string> = {
  Helvetica: 'Arial, Helvetica, sans-serif',
  Times: '"Times New Roman", Times, serif',
  Courier: '"Courier New", Courier, monospace',
};
const imgCache = new Map<string, HTMLImageElement>();

/** Magnified view of the page around the object being dragged, shown above the finger. */
export function Loupe({ x, y, page, obj, pageW, pageH, rotation, zoom }: {
  x: number; y: number; page: number; obj: EditorObject; pageW: number; pageH: number; rotation: number; zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current;
    const src = document.querySelector<HTMLCanvasElement>(`.pageOuter[data-src="${page}"] canvas`);
    if (!c || !src || !src.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = SIZE * dpr; c.height = SIZE * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    const s = Math.max(zoom * 2.4, 2.2); // px per page unit inside the loupe
    // focus: start of the text baseline / top-left area of the object
    let fx: number, fy: number;
    if (obj.type === 'text') {
      fx = obj.x + Math.min(obj.w / 2, 24);
      fy = obj.y + obj.size * BASELINE[obj.family];
    } else if (obj.type === 'line') {
      fx = obj.x; fy = obj.y;
    } else {
      fx = obj.x + Math.min(obj.w / 2, 40); fy = obj.y + Math.min(obj.h / 2, 40);
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); ctx.clip();
    ctx.translate(SIZE / 2, SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.translate(-fx, -fy);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, pageW, pageH);
    // the object itself
    ctx.globalAlpha = 0.92;
    if (obj.type === 'text') {
      ctx.fillStyle = obj.color;
      ctx.font = `${obj.italic ? 'italic ' : ''}${obj.bold ? 700 : 400} ${obj.size}px ${FAMILY_CSS[obj.family]}`;
      ctx.textBaseline = 'alphabetic';
      obj.text.split('\n').forEach((line, i) => ctx.fillText(line, obj.x, obj.y + obj.size * 1.2 * i + obj.size * BASELINE[obj.family]));
    } else if (obj.type === 'image' || obj.type === 'signature') {
      let im = imgCache.get(obj.src);
      if (!im) { im = new Image(); im.src = obj.src; imgCache.set(obj.src, im); }
      if (im.complete) ctx.drawImage(im, obj.x, obj.y, obj.w, obj.h);
    } else if (obj.type === 'whiteout' || obj.type === 'highlight') {
      ctx.fillStyle = obj.fill; ctx.globalAlpha = obj.type === 'highlight' ? 0.4 : 1;
      ctx.fillRect(obj.x, obj.y, obj.w, obj.h);
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([3 / s, 3 / s]);
    ctx.lineWidth = 1.2 / s;
    ctx.strokeStyle = '#1d3fb8';
    if (obj.type === 'line') { ctx.beginPath(); ctx.moveTo(obj.x, obj.y); ctx.lineTo(obj.x2, obj.y2); ctx.stroke(); }
    else ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
    if (obj.type === 'text') {
      // baseline guide
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(201,52,52,.75)';
      ctx.beginPath(); ctx.moveTo(obj.x - 400, fy); ctx.lineTo(obj.x + obj.w + 400, fy); ctx.stroke();
    }
    ctx.restore();
  });
  const vw = window.innerWidth;
  const left = Math.max(8, Math.min(vw - SIZE - 8, x - SIZE / 2));
  const above = y - SIZE - 70;
  const top = above > 64 ? above : y + 60;
  return (
    <div className="loupe" style={{ left, top, width: SIZE, height: SIZE }} aria-hidden="true">
      <canvas ref={ref} style={{ width: SIZE, height: SIZE }} />
    </div>
  );
}
