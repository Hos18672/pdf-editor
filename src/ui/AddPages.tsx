// Adding pages to the open document from inside the editor (page list, organizer): blank pages,
// all pages of another PDF, or pictures. The edits made so far stay.
import React, { useRef, useState } from 'react';
import { Icon } from './icons';
import { Stepper } from './Panel';

export type AddWhat = { kind: 'blank'; count: number } | { kind: 'pdf'; file: File } | { kind: 'images'; files: File[] };

export function AddPagesSheet({ after, total, mobile, onClose, onAdd }: {
  /** new pages go after this page number (0: at the start) */
  after: number; total: number; mobile: boolean; onClose: () => void; onAdd: (w: AddWhat) => void;
}) {
  const [count, setCount] = useState(1);
  const pdfIn = useRef<HTMLInputElement>(null);
  const imgIn = useRef<HTMLInputElement>(null);
  const where = after >= total ? 'at the end' : after <= 0 ? 'at the start' : `after page ${after}`;
  return (
    <>
      <div className="sheet-scrim" style={{ zIndex: 30 }} onClick={onClose} />
      <div className={`bsheet addpg${mobile ? '' : ' center'}`} role="dialog" aria-label="Add pages">
        {mobile && <div className="grab" />}
        <div className="props">
          <div className="ap-h">
            <div><h3>Add pages</h3><span className="label">New pages go {where}</span></div>
            <button className="ibtn muted" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
          </div>
          <div className="opt ap-blank">
            <span className="oi"><Icon name="file:duotone" size={20} /></span>
            <span className="ot"><b>Blank page</b><span>Same size as the page before</span></span>
            <div style={{ width: 128, flex: 'none' }}><Stepper value={count} min={1} max={50} onChange={setCount} label="pages" /></div>
          </div>
          <button className="btn primary lg block" onClick={() => onAdd({ kind: 'blank', count })}>
            <Icon name="plus:bold" size={18} />{count > 1 ? `Add ${count} blank pages` : 'Add a blank page'}
          </button>
          <div className="ap-or"><span>or add</span></div>
          <button className="opt" onClick={() => pdfIn.current?.click()}>
            <span className="oi"><Icon name="file-pdf:duotone" size={20} /></span>
            <span className="ot"><b>Pages from a PDF</b><span>All pages of another file</span></span>
            <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />
          </button>
          <button className="opt" onClick={() => imgIn.current?.click()}>
            <span className="oi"><Icon name="image:duotone" size={20} /></span>
            <span className="ot"><b>Images</b><span>One page per image</span></span>
            <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />
          </button>
        </div>
        <input ref={pdfIn} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAdd({ kind: 'pdf', file: f }); }} />
        <input ref={imgIn} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { const f = e.target.files; const list = f ? [...f] : []; e.target.value = ''; if (list.length) onAdd({ kind: 'images', files: list }); }} />
      </div>
    </>
  );
}
