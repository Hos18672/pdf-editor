import React, { useEffect, useRef } from 'react';
import type { PageState } from '../engine/types';
import { Icon } from './icons';

function Thumb({ pdf, src, rotation }: { pdf: any; src: number; rotation: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const page = await pdf.getPage(src + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 220 / Math.max(base.width, base.height), rotation: (page.rotate + rotation) % 360 });
      const c = ref.current;
      if (!c || off) return;
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise.catch(() => null);
    })();
    return () => { off = true; };
  }, [pdf, src, rotation]);
  return <canvas ref={ref} />;
}

export function PagesModal({ pdf, pages, onChange, onClose }: {
  pdf: any; pages: PageState[]; onChange: (p: PageState[]) => void; onClose: () => void;
}) {
  const update = (i: number, fn: (list: PageState[]) => void) => {
    const list = pages.map((p) => ({ ...p }));
    fn(list);
    onChange(list);
  };
  return (
    <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Organize pages">
        <header>
          <h2>Organize pages</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="thumbs">
          {pages.map((p, i) => (
            <div className="thumb" key={p.src}>
              <div className="tp"><Thumb pdf={pdf} src={p.src} rotation={p.rotation} /></div>
              <div className="n">Page {i + 1}</div>
              <div className="acts">
                <button className="iconbtn" aria-label="Move earlier" disabled={i === 0}
                  onClick={() => update(i, (l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; })}><Icon name="left" size={18} /></button>
                <button className="iconbtn" aria-label="Rotate" onClick={() => update(i, (l) => { l[i].rotation = (l[i].rotation + 90) % 360; })}><Icon name="rotate" size={18} /></button>
                <button className="iconbtn" aria-label="Delete page" disabled={pages.length === 1}
                  onClick={() => update(i, (l) => { l.splice(i, 1); })}><Icon name="trash" size={18} /></button>
                <button className="iconbtn" aria-label="Move later" disabled={i === pages.length - 1}
                  onClick={() => update(i, (l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; })}><Icon name="right" size={18} /></button>
              </div>
            </div>
          ))}
        </div>
        <footer><button className="btn small" onClick={onClose}>Done</button></footer>
      </div>
    </div>
  );
}
