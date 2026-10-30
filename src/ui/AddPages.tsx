// Adding pages to the open document from inside the editor (page list, organizer): blank pages,
// all pages of another PDF, or pictures. The edits made so far stay.
import React, { useRef, useState } from 'react';
import { Icon } from './icons';
import { Stepper } from './Panel';
import { ACCEPT, DropOverlay, isImage, isPdf, useFileDrop } from './drop';
import { t, tn } from './i18n';

export type AddWhat = { kind: 'blank'; count: number } | { kind: 'pdf'; file: File } | { kind: 'images'; files: File[] };

export function AddPagesSheet({ after, total, mobile, onClose, onAdd }: {
  /** new pages go after this page number (0: at the start) */
  after: number; total: number; mobile: boolean; onClose: () => void; onAdd: (w: AddWhat) => void;
}) {
  const [count, setCount] = useState(1);
  const pdfIn = useRef<HTMLInputElement>(null);
  const imgIn = useRef<HTMLInputElement>(null);
  const where = after >= total ? t('New pages go at the end') : after <= 0 ? t('New pages go at the start') : t('New pages go after page {p}', { p: after });
  // a PDF or pictures dropped on the sheet are added the same as chosen ones
  const drop = useFileDrop((f) => {
    const pdf = f.find(isPdf);
    if (pdf) onAdd({ kind: 'pdf', file: pdf }); else onAdd({ kind: 'images', files: f });
  }, { accept: (f) => isPdf(f) || isImage(f) });
  return (
    <>
      <div className="sheet-scrim" style={{ zIndex: 30 }} onClick={onClose} />
      <div className={`bsheet addpg${mobile ? '' : ' center'}`} role="dialog" aria-label={t('Add pages')} {...drop.bind}>
        <DropOverlay show={drop.over} title={`Drop to add ${where}`} sub={t('All pages of a PDF, or one page per image')} />
        {mobile && <div className="grab" />}
        <div className="props">
          <div className="ap-h">
            <div><h3>{t('Add pages')}</h3><span className="label">{where}</span></div>
            <button className="ibtn muted" onClick={onClose} aria-label={t('Close')}><Icon name="close" size={18} /></button>
          </div>
          <div className="opt ap-blank">
            <span className="oi"><Icon name="file:duotone" size={20} /></span>
            <span className="ot"><b>{t('Blank page')}</b><span>{t('Same size as the page before')}</span></span>
            <div style={{ width: 128, flex: 'none' }}><Stepper value={count} min={1} max={50} onChange={setCount} label="pages" /></div>
          </div>
          <button className="btn primary lg block" onClick={() => onAdd({ kind: 'blank', count })}>
            <Icon name="plus:bold" size={18} />{count > 1 ? t('Add {n} blank pages', { n: count }) : t('Add a blank page')}
          </button>
          <div className="ap-or"><span>{t('or add')}</span></div>
          <button className="opt" onClick={() => pdfIn.current?.click()}>
            <span className="oi"><Icon name="file-pdf:duotone" size={20} /></span>
            <span className="ot"><b>{t('Pages from a PDF')}</b><span>{t('All pages of another file')}</span></span>
            <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />
          </button>
          <button className="opt" onClick={() => imgIn.current?.click()}>
            <span className="oi"><Icon name="image:duotone" size={20} /></span>
            <span className="ot"><b>{t('Images')}</b><span>{t('One page per image')}</span></span>
            <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />
          </button>
        </div>
        {!mobile && <div className="ap-drop label"><Icon name="file-arrow-up" size={15} />{t('You can also drop a PDF or images here')}</div>}
        <input ref={pdfIn} type="file" accept={ACCEPT.pdf} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onAdd({ kind: 'pdf', file: f }); }} />
        <input ref={imgIn} type="file" accept={ACCEPT.image} multiple hidden onChange={(e) => { const f = e.target.files; const list = f ? [...f] : []; e.target.value = ''; if (list.length) onAdd({ kind: 'images', files: list }); }} />
      </div>
    </>
  );
}
