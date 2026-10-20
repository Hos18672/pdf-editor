import React, { useEffect, useRef } from 'react';

/** Small rendering of one PDF page (rendered when it scrolls into view). */
export function Thumb({ pdf, src, rotation = 0, size = 220, className, style }: {
  pdf: any; src: number; rotation?: number; size?: number; className?: string; style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !pdf) return;
    let off = false;
    let task: any = null;
    const draw = async () => {
      try {
        const page = await pdf.getPage(src + 1);
        if (off) return;
        const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
        const k = (size * Math.min(window.devicePixelRatio || 1, 2)) / Math.max(base.width, base.height);
        const vp = page.getViewport({ scale: k, rotation: (page.rotate + rotation) % 360 });
        const tmp = document.createElement('canvas');
        tmp.width = Math.round(vp.width); tmp.height = Math.round(vp.height);
        const ctx = tmp.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tmp.width, tmp.height);
        task = page.render({ canvasContext: ctx, viewport: vp });
        await task.promise;
        if (off || !ref.current) return;
        ref.current.width = tmp.width; ref.current.height = tmp.height;
        ref.current.getContext('2d')!.drawImage(tmp, 0, 0);
        ref.current.style.aspectRatio = `${tmp.width} / ${tmp.height}`;
      } catch { /* cancelled or unavailable */ }
    };
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); draw(); }
    }, { rootMargin: '300px' });
    io.observe(c);
    return () => { off = true; io.disconnect(); task?.cancel?.(); };
  }, [pdf, src, rotation, size]);
  return <canvas ref={ref} className={className} style={style} width={size * 0.707} height={size} />;
}
