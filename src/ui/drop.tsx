// Files dragged in from the computer, the same way everywhere: a hook for any area, the overlay shown
// while files are above it, and the dashed drop box with its "Choose" button (start of the tools).
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isImage = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|tiff?|heic|heif|avif)$/i.test(f.name);
/** accept lists for file inputs */
export const ACCEPT = {
  pdf: 'application/pdf,.pdf',
  image: 'image/*,.heic,.heif',
  pdfOrImage: 'application/pdf,.pdf,image/*,.heic,.heif',
} as const;

const carriesFiles = (e: { dataTransfer: DataTransfer | null }) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export interface DropOpts {
  /** which files are taken (the rest are left out; `onReject` hears when none was) */
  accept?: (f: File) => boolean;
  onReject?: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Files dropped on an element. Spread `bind` on it; `over` is true while files are dragged above it.
 * Nested elements don't make it flicker (enter / leave are counted).
 */
export function useFileDrop(onFiles: (files: File[], e: React.DragEvent) => void, opts: DropOpts = {}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const cur = useRef({ onFiles, opts });
  cur.current = { onFiles, opts };
  const bind = {
    onDragEnter: (e: React.DragEvent) => {
      if (cur.current.opts.disabled || !carriesFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e: React.DragEvent) => {
      if (cur.current.opts.disabled || !carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (cur.current.opts.disabled || !carriesFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      const all = [...(e.dataTransfer.files ?? [])];
      const { accept, onReject } = cur.current.opts;
      const ok = accept ? all.filter(accept) : all;
      if (ok.length) cur.current.onFiles(ok, e);
      else if (all.length) onReject?.(all);
    },
  };
  return { over, bind };
}

/**
 * A file dropped where nothing takes it would make the browser open it in place of the app (and lose
 * the work): stopped for the whole page.
 */
export function useNoStrayDrops() {
  useEffect(() => {
    const stop = (e: DragEvent) => { if (carriesFiles(e)) e.preventDefault(); };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);
}

/** Shown over an area while files are dragged above it (the area needs position: relative or absolute). */
export function DropOverlay({ show, title, sub, icon = 'file-arrow-up' }: { show: boolean; title: string; sub?: string; icon?: string }) {
  if (!show) return null;
  return (
    <div className="dropov" aria-hidden="true">
      <div className="dropov-card">
        <span className="dropov-i"><Icon name={icon} size={26} /></span>
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/**
 * The dashed box to start from: drop files on it or choose them. `row`: icon, text and button side by
 * side (wide screens); otherwise stacked and centred.
 */
export function DropBox({ icon, title, sub, accept, multiple, onFiles, filter, onReject, button = 'Choose', err, row, children, style }: {
  icon: string; title: React.ReactNode; sub?: React.ReactNode; accept: string; multiple?: boolean;
  onFiles: (files: File[]) => void; filter?: (f: File) => boolean; onReject?: (files: File[]) => void;
  button?: string; err?: string | null; row?: boolean; children?: React.ReactNode; style?: React.CSSProperties;
}) {
  const input = useRef<HTMLInputElement>(null);
  const take = (list: File[]) => { const ok = filter ? list.filter(filter) : list; if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1)); else if (list.length) onReject?.(list); };
  const { over, bind } = useFileDrop((f) => take(f));
  return (
    <div className={`dz${over ? ' over' : ''}${row ? '' : ' stack'}`} style={style} {...bind}>
      <div className="dzi"><Icon name={over ? 'file-arrow-up' : icon} size={26} /></div>
      <div className="dzt">
        <b>{over ? 'Drop to add' : title}</b>
        {sub && <span className="label">{sub}</span>}
        {children}
      </div>
      <button className="btn primary lg" onClick={() => input.current?.click()}><Icon name="open" size={18} />{button}</button>
      {err && <div className="dz-err">{err}</div>}
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden onChange={(e) => { const f = e.target.files; e.target.value = ''; if (f?.length) take([...f]); }} />
    </div>
  );
}
