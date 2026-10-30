import React, { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Icon } from './icons';
import { Seg, Toggle } from './Panel';
import { saveFile, HostProps, ToastMsg } from './Editor';
import { convertFile, ConvertOptions, kindOf, KINDS, ALL_ACCEPT } from './convert';
import { baseName, loadDoc, save } from './pdfops';
import { SortableArea, useSortableItem } from './sortable';
import { DropBox } from './drop';
import { t, tn } from './i18n';

interface Item { id: string; file: File; status: 'waiting' | 'busy' | 'ok' | 'err' | 'unsupported'; progress: number; bytes?: Uint8Array; pages?: number; error?: string }

const LOOK: Record<string, { icon: string; bg: string; fg: string }> = {
  image: { icon: 'image:duotone', bg: '#E3F1E9', fg: '#1E5F3E' },
  word: { icon: 'file-doc:duotone', bg: '#DDE5FF', fg: '#24409A' },
  excel: { icon: 'file-xls:duotone', bg: '#DDF1E4', fg: '#1B6B3F' },
  ppt: { icon: 'file-ppt:duotone', bg: '#FCE3D8', fg: '#9A3B12' },
  text: { icon: 'file-text:duotone', bg: '#EEF0F4', fg: '#3F4560' },
  none: { icon: 'warning-circle:duotone', bg: '#FBE9E7', fg: '#B83227' },
};
const TYPES: [string, string, string][] = [['JPG · PNG · HEIC', '#E3F1E9', '#1E5F3E'], ['DOCX', '#DDE5FF', '#24409A'], ['XLSX · CSV · ODS', '#DDF1E4', '#1B6B3F'], ['PPTX', '#FCE3D8', '#9A3B12'], ['TXT · MD · HTML', '#EEF0F4', '#3F4560']];

export function Convert({ host, toast, desk, mobile, kind, onOpenInEditor }: {
  host: HostProps; toast: (t: ToastMsg) => void; desk: boolean; mobile: boolean; kind: string;
  onOpenInEditor: (name: string, bytes: Uint8Array) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [opt, setOpt] = useState<ConvertOptions>({ size: 'fit', orient: 'auto', margin: 'small' });
  const [combine, setCombine] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const running = useRef(false);
  const optRef = useRef(opt);
  optRef.current = opt;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const add = (files: FileList | File[]) => {
    const next: Item[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).slice(2), file, progress: 0,
      status: kindOf(file.name, file.type) ? 'waiting' : 'unsupported',
    }));
    setItems((cur) => [...cur, ...next]);
  };
  const patch = (id: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // convert one file at a time
  useEffect(() => {
    if (running.current) return;
    const next = items.find((x) => x.status === 'waiting');
    if (!next) return;
    running.current = true;
    (async () => {
      patch(next.id, { status: 'busy', progress: 0.05 });
      try {
        const r = await convertFile(next.file, optRef.current, (f) => patch(next.id, { progress: f }));
        patch(next.id, { status: 'ok', bytes: r.bytes, pages: r.pages, progress: 1 });
      } catch (e: any) {
        patch(next.id, e?.message === 'unsupported' ? { status: 'unsupported' } : { status: 'err', error: e?.message ?? t('Conversion failed') });
      } finally {
        running.current = false;
        setItems((cur) => cur.slice()); // look for the next one
      }
    })();
  }, [items]);
  // new options: convert again
  const firstOpt = useRef(true);
  useEffect(() => {
    if (firstOpt.current) { firstOpt.current = false; return; }
    setItems((cur) => cur.map((x) => (x.status === 'ok' || x.status === 'err' ? { ...x, status: 'waiting', progress: 0, bytes: undefined } : x)));
  }, [opt]);

  const ready = items.filter((x) => x.status === 'ok');
  const pending = items.filter((x) => x.status === 'waiting' || x.status === 'busy').length;
  const preview = (it: Item) => {
    if (!it.bytes) return;
    if (host.isNative) { onOpenInEditor(baseName(it.file.name) + '.pdf', it.bytes); return; }
    const url = URL.createObjectURL(new Blob([it.bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  };
  const download = async () => {
    if (!ready.length) return;
    try {
      if (ready.length === 1 && !combine) {
        await saveFile(host, ready[0].bytes!, baseName(ready[0].file.name) + '.pdf', 'application/pdf', toast);
      } else if (combine) {
        const out = await PDFDocument.create();
        for (const it of ready) { const d = await loadDoc(it.bytes!); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
        const name = baseName(ready[0].file.name) + '-combined.pdf';
        const bytes = await save(out);
        await saveFile(host, bytes, name, 'application/pdf', (m) => toast({ ...m, action: { label: t('Edit'), run: () => onOpenInEditor(name, bytes) } }));
      } else {
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();
        const used = new Set<string>();
        for (const it of ready) {
          let n = baseName(it.file.name) + '.pdf';
          for (let k = 2; used.has(n); k++) n = `${baseName(it.file.name)}-${k}.pdf`;
          used.add(n);
          zip.file(n, it.bytes!);
        }
        await saveFile(host, await zip.generateAsync({ type: 'uint8array' }), 'converted-pdfs.zip', 'application/zip', toast);
      }
    } catch (e: any) {
      toast({ msg: t('Couldn’t save: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' });
    }
  };

  const accept = kind && KINDS[kind] ? KINDS[kind].accept : ALL_ACCEPT;
  const ctaLabel = !ready.length ? t('Download') : combine ? t('Download combined PDF') : ready.length === 1 ? t('Download PDF') : t('Download {n} PDFs (.zip)', { n: ready.length });
  const cta = <button className="btn primary lg block" disabled={!ready.length} onClick={download}><Icon name="download" size={18} />{desk ? ctaLabel : t('Download')}</button>;
  const options = (
    <>
      <div className="field"><span className="label">{t('Page size')}</span><Seg value={opt.size} onChange={(size) => setOpt((o) => ({ ...o, size }))} options={[['fit', 'Fit content'], ['a4', 'A4'], ['letter', 'Letter']]} /></div>
      <div className="field"><span className="label">{t('Orientation')}</span><Seg value={opt.orient} onChange={(orient) => setOpt((o) => ({ ...o, orient }))} options={[['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']]} /></div>
      <div className="field"><span className="label">{t('Margins')}</span><Seg value={opt.margin} onChange={(margin) => setOpt((o) => ({ ...o, margin }))} options={[['none', 'None'], ['small', 'Small'], ['normal', 'Normal']]} /></div>
      <Toggle label={t('Combine into one PDF')} hint={t('In the order listed')} checked={combine} onChange={setCombine} />
      <div className="note"><Icon name="info" size={16} /><span>{t('Office files are laid out on your device. Complex layouts can shift slightly and pages are stored as images, so preview each result before sharing.')}</span></div>
    </>
  );
  return (
    <div className="tbody" style={{ flexDirection: desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="flist" style={{ maxWidth: 820, gap: 16 }}>
          <DropBox row={!mobile} icon="file-arrow-up" title={mobile ? t('Turn files into PDFs') : t('Drop files to turn them into PDFs')} accept={accept} multiple
            onFiles={add} button={t('Choose files')}>
            <div className="types">{TYPES.map(([t, bg, fg]) => <span key={t} style={{ background: bg, color: fg }}>{t}</span>)}</div>
          </DropBox>
          {items.length > 0 && (
            <SortableArea items={items} idOf={(it) => it.id} onReorder={setItems} layout="list"
              overlay={(it) => <div className="qrow"><QueueRowBody it={it} /></div>}>
              <div className="queue">
                {items.map((it) => (
                  <QueueRow key={it.id} it={it} onPreview={() => preview(it)}
                    onRetry={() => patch(it.id, { status: 'waiting', progress: 0 })}
                    onRemove={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} />
                ))}
              </div>
            </SortableArea>
          )}
          {!desk && optsOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>{options}</div>}
        </div>
      </div>
      {desk && <aside className="tside"><div className="sb"><h3>{t('Options')}</h3>{options}</div><div className="sf">{cta}</div></aside>}
      {!desk && (
        <div className="tbar">
          <div className="t"><b>{t('{r} of {n} ready', { r: ready.length, n: items.length })}</b><span>{pending ? t('{n} converting or waiting', { n: pending }) : items.length ? t('All done') : t('Add files to start')}</span></div>
          <button className="ibtn" style={{ width: 48, height: 48, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }} aria-label={t('Options')} aria-expanded={optsOpen} onClick={() => setOptsOpen((v) => !v)}><Icon name="more" size={20} /></button>
          {cta}
        </div>
      )}
    </div>
  );
}

function QueueRow({ it, onPreview, onRetry, onRemove }: { it: Item; onPreview: () => void; onRetry: () => void; onRemove: () => void }) {
  const s = useSortableItem(it.id);
  return (
    <div ref={s.ref} style={s.style} className={`qrow${s.dragging ? ' hole' : ''}`} {...s.pointer}>
      <QueueRowBody it={it} grip={s.grip} onPreview={onPreview} onRetry={onRetry} onRemove={onRemove} />
    </div>
  );
}

/** A queue row's content; also drawn under the finger while dragging. */
function QueueRowBody({ it, grip, onPreview, onRetry, onRemove }: { it: Item; grip?: Record<string, any>; onPreview?: () => void; onRetry?: () => void; onRemove?: () => void }) {
  const k = kindOf(it.file.name, it.file.type) ?? 'none';
  const look = LOOK[it.status === 'unsupported' ? 'none' : k];
  const status = it.status === 'ok' ? tn(it.pages ?? 0, 'Ready · {n} page', 'Ready · {n} pages') : it.status === 'busy' ? t('Converting…')
    : it.status === 'waiting' ? t('Waiting') : it.status === 'unsupported' ? t('This file type isn’t supported yet') : t('Failed: {e}', { e: it.error ?? '' });
  const tab = grip ? 0 : -1;
  return (
    <>
      <button className="fgrip" aria-label={t('Move {name}', { name: it.file.name })} title={t('Drag to set the order (or press Space, then the arrow keys)')} {...grip}>
        <Icon name="dots-six-vertical:bold" size={18} />
      </button>
      <span className="qi" style={{ background: look.bg, color: look.fg }}><Icon name={look.icon} size={20} /></span>
      <div className="qt"><b title={it.file.name}>{it.file.name}</b>
        {it.status === 'busy' && <div className="bar"><div style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>}
        <span className={it.status === 'ok' ? 'ok' : it.status === 'err' || it.status === 'unsupported' ? 'err' : ''}>{status}</span></div>
      {it.status === 'ok' && <button className="ibtn muted" aria-label={t('Preview {name}', { name: it.file.name })} title={t('Preview')} tabIndex={tab} onClick={onPreview}><Icon name="eye" size={18} /></button>}
      {it.status === 'err' && <button className="ibtn danger" aria-label={t('Retry')} title={t('Retry')} tabIndex={tab} onClick={onRetry}><Icon name="rotate" size={18} /></button>}
      <button className="ibtn muted" aria-label={t('Remove {name}', { name: it.file.name })} title={t('Remove')} tabIndex={tab} onClick={onRemove}><Icon name="close" size={17} /></button>
    </>
  );
}
