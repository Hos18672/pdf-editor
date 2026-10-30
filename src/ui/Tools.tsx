import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useBack } from './back';
import { openPdf } from './pdfjs';
import { Thumb } from './Thumb';
import { Seg, Stepper, Toggle } from './Panel';
import { saveFile, HostProps, ToastMsg, BusyMsg, type EditorStart } from './Editor';
import { parseRange, formatRange, loadDoc, pickPages, imageBytes, addImagePage, addOutline, save, baseName, fmtSize } from './pdfops';
import { Convert } from './Convert';
import { LegalLinks, LegalSheet, type LegalPage } from './Legal';
import { ACCEPT, DropBox, DropOverlay, isImage, isPdf, useFileDrop } from './drop';
import { Compress, Password, PageNumbers, Watermark, Split, ToImages, ExtractText, Deadlines, SafeCopy } from './MoreTools';
import { SortableArea, useSortableItem } from './sortable';
import type { Bp } from './hooks';
import type { PageState } from '../engine/types';
import { PDFDocument } from 'pdf-lib';
import { t, tn, tj } from './i18n';

export type ToolId = 'hub' | 'combine' | 'extract' | 'remove' | 'insert' | 'convert' | 'compress' | 'password' | 'numbers' | 'watermark' | 'split' | 'images' | 'text' | 'deadlines' | 'safecopy';

export interface Current { name: string; bytes: Uint8Array; pdf: any; pages: PageState[]; changed: boolean }
export interface Src { name: string; bytes: Uint8Array; pdf: any; pages: PageState[]; fromEditor: boolean }

export interface Props {
  initial: ToolId; bp: Bp; host: HostProps; current: Current | null;
  toast: (t: ToastMsg) => void; setBusy: (b: BusyMsg | null) => void;
  onBack: () => void; onEdit: (start: EditorStart) => void;
  onOpenInEditor: (name: string, bytes: Uint8Array) => void;
  onApplyPages: (pages: PageState[]) => void;
  onScan: () => void;
}

const TILE = { edit: '#FFE14D', org: '#DDE2FF', conv: '#E3F1E9' };
type HubItem = { name: string; desc: string; icon: string; tile: string; go: () => void };

export function Tools(p: Props) {
  const [tool, setTool] = useState<ToolId>(p.initial);
  const [convertKind, setConvertKind] = useState<string>('');
  const [legal, setLegal] = useState<LegalPage | null>(null);
  const mobile = p.bp === 'mobile', desk = p.bp === 'desktop' || p.bp === 'large';
  // a tool opened straight from a start-screen chip goes back to where it came from, not to the list
  const back = () => (tool === 'hub' || tool === p.initial ? p.onBack() : setTool('hub'));
  useBack(back);
  const meta: Record<ToolId, [string, string]> = {
    hub: ['All tools', 'Every tool runs on this device'],
    combine: ['Combine PDFs', 'Merge files and images into one PDF'],
    extract: ['Extract or remove pages', 'Save chosen pages as a new PDF, or delete them'],
    remove: ['Extract or remove pages', 'Delete pages you don’t need, or save them as a new PDF'],
    insert: ['Insert pages', 'Add blank pages, images or another PDF'],
    convert: ['Convert to PDF', 'Images, Word, Excel, PowerPoint, text and web pages'],
    compress: ['Compress PDF', 'Smaller files for e-mail and upload portals'],
    password: ['Password', 'Protect a PDF, or remove its password'],
    numbers: ['Page numbers', 'Number the pages'],
    watermark: ['Watermark', 'Text across the pages'],
    split: ['Split PDF', 'Cut a PDF into several files'],
    images: ['PDF to pictures', 'Every page as a JPG or PNG'],
    text: ['Extract text', 'All the text, also from scans'],
    deadlines: ['Deadline finder', 'Dates from a letter into your calendar'],
    safecopy: ['Safe ID copy', 'A copy that can only be used for one purpose'],
  };
  const conv = (k: string) => () => { setConvertKind(k); setTool('convert'); };
  // one entry per screen: kinds of the same job (file types, scan modes, extract/remove) are chosen inside the tool
  const groups: { name: string; items: HubItem[] }[] = [
    { name: 'Edit & sign', items: [
      { name: 'Edit PDF', desc: t('Retype text, add text, images, shapes'), icon: 'pencil-simple-line:duotone', tile: TILE.edit, go: () => p.onEdit('edit') },
      { name: 'Fill a form', desc: t('Type in fields, tick boxes'), icon: 'textbox:duotone', tile: TILE.edit, go: () => p.onEdit('fill') },
      { name: 'Sign', desc: t('Draw, type or upload a signature'), icon: 'signature:duotone', tile: TILE.edit, go: () => p.onEdit('sign') },
      { name: 'Privacy check', desc: t('Find personal data, black it out'), icon: 'shield-check:duotone', tile: TILE.edit, go: () => p.onEdit('privacy') },
      { name: 'Safe ID copy', desc: t('“COPY – only for …” on ID scans'), icon: 'identification-badge:duotone', tile: TILE.edit, go: () => setTool('safecopy') },
      { name: 'Deadline finder', desc: t('Dates in a letter, to your calendar'), icon: 'calendar-plus:duotone', tile: TILE.edit, go: () => setTool('deadlines') },
    ] },
    { name: 'Pages', items: [
      { name: 'Combine PDFs', desc: t('Merge files and images into one'), icon: 'stack:duotone', tile: TILE.org, go: () => setTool('combine') },
      { name: 'Split PDF', desc: t('By ranges, every few pages or per page'), icon: 'scissors:duotone', tile: TILE.org, go: () => setTool('split') },
      { name: 'Extract or remove pages', desc: t('Pick pages to keep or delete'), icon: 'export:duotone', tile: TILE.org, go: () => setTool('extract') },
      { name: 'Insert pages', desc: t('Blank pages, images or another PDF'), icon: 'file-plus:duotone', tile: TILE.org, go: () => setTool('insert') },
      { name: 'Reorder & rotate', desc: t('Drag pages into place, turn them'), icon: 'squares-four:duotone', tile: TILE.org, go: () => p.onEdit('pages') },
    ] },
    { name: 'Convert', items: [
      { name: 'Convert to PDF', desc: t('Images, Word, Excel, PowerPoint, text, web'), icon: 'file-arrow-down:duotone', tile: TILE.conv, go: conv('') },
      { name: 'Scan to PDF', desc: t('Documents, ID cards, receipts'), icon: 'scan:duotone', tile: TILE.conv, go: p.onScan },
      { name: 'PDF to pictures', desc: t('Every page as a JPG or PNG'), icon: 'images:duotone', tile: TILE.conv, go: () => setTool('images') },
      { name: 'Extract text', desc: t('All the text, also from scans'), icon: 'article:duotone', tile: TILE.conv, go: () => setTool('text') },
    ] },
    { name: 'Optimize & protect', items: [
      { name: 'Compress PDF', desc: t('Smaller files, also under a size limit'), icon: 'arrows-in-line-vertical:duotone', tile: '#FFE3D6', go: () => setTool('compress') },
      { name: 'Password', desc: t('Protect a PDF or remove its password'), icon: 'lock-key:duotone', tile: '#FFE3D6', go: () => setTool('password') },
      { name: 'Page numbers', desc: t('1, 2, 3 or “Seite 1 von 9”'), icon: 'list-numbers:duotone', tile: '#FFE3D6', go: () => setTool('numbers') },
      { name: 'Watermark', desc: t('CONFIDENTIAL, COPY or your own text'), icon: 'stamp:duotone', tile: '#FFE3D6', go: () => setTool('watermark') },
    ] },
  ];

  return (
    <div className="tscreen">
      <header className="topbar">
        <button className="ibtn" onClick={back} aria-label={t('Back')}><Icon name="back" /></button>
        <div className="doc"><div className="names"><div className="fname">{t(meta[tool][0])}</div><div className="fmeta one">{t(meta[tool][1])}</div></div></div>
        {!mobile && <div className="privacy-pill"><Icon name="lock" size={14} />{t('Processed on this device')}</div>}
      </header>
      {tool === 'hub' && (
        <div className="tmain">
          <div className="hub">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1>{t('What do you want to do?')}</h1>
              <div className="sub">{p.host.isNative ? t('Every tool runs on your phone.') : t('Every tool runs in your browser.')} {t('Files never leave this device.')}</div>
            </div>
            {groups.map((g) => (
              <section key={g.name} className="grp">
                <div className="kicker">{t(g.name)}</div>
                <div className="cards">
                  {g.items.map((it) => (
                    <button key={it.name} className="hcard" onClick={it.go} title={`${t(it.name)}: ${it.desc}`}>
                      <span className="ti" style={{ background: it.tile }}><Icon name={it.icon} size={21} /></span>
                      <span className="tt"><b>{t(it.name)}</b><span>{it.desc}</span></span>
                      <Icon name="right" size={16} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <LegalLinks onOpen={setLegal} className="hub-legal" />
          </div>
        </div>
      )}
      {legal && <LegalSheet page={legal} onClose={() => setLegal(null)} />}
      {tool === 'combine' && <Combine {...p} desk={desk} mobile={mobile} />}
      {(tool === 'extract' || tool === 'remove') && <PagePick {...p} desk={desk} mobile={mobile} mode={tool} onMode={setTool} />}
      {tool === 'insert' && <Insert {...p} desk={desk} mobile={mobile} />}
      {tool === 'compress' && <Compress {...p} desk={desk} mobile={mobile} />}
      {tool === 'password' && <Password {...p} desk={desk} mobile={mobile} />}
      {tool === 'numbers' && <PageNumbers {...p} desk={desk} mobile={mobile} />}
      {tool === 'watermark' && <Watermark {...p} desk={desk} mobile={mobile} />}
      {tool === 'split' && <Split {...p} desk={desk} mobile={mobile} />}
      {tool === 'images' && <ToImages {...p} desk={desk} mobile={mobile} />}
      {tool === 'text' && <ExtractText {...p} desk={desk} mobile={mobile} />}
      {tool === 'deadlines' && <Deadlines {...p} desk={desk} mobile={mobile} />}
      {tool === 'safecopy' && <SafeCopy {...p} desk={desk} mobile={mobile} />}
      {tool === 'convert' && <Convert host={p.host} toast={p.toast} desk={desk} mobile={mobile} kind={convertKind} onOpenInEditor={p.onOpenInEditor} />}
    </div>
  );
}

// ---------------- shared bits ----------------

export function useSource(current: Current | null) {
  const [src, setSrc] = useState<Src | null>(current ? { ...current, fromEditor: true } : null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (f: File) => {
    setErr(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdf = await openPdf(bytes);
      setSrc({ name: f.name, bytes, pdf, pages: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })), fromEditor: false });
    } catch (e: any) {
      setErr(e?.name === 'PasswordException' ? t('This PDF is password-protected. Open it in the editor first to unlock it.') : t('That file couldn’t be opened as a PDF.'));
    }
  };
  return { src, load, err, setSrc };
}

export function PickPdf({ onFile, err, title }: { onFile: (f: File) => void; err: string | null; title: string }) {
  const [wrong, setWrong] = useState(false);
  return (
    <div className="tmain">
      <div className="flist" style={{ maxWidth: 560, marginTop: '6vh' }}>
        <DropBox icon="file-pdf:duotone" title={title} sub={t('Drop a PDF here or choose one')} accept={ACCEPT.pdf} filter={isPdf}
          onFiles={(f) => { setWrong(false); onFile(f[0]); }} onReject={() => setWrong(true)} button={t('Choose PDF')}
          err={wrong ? t('That isn’t a PDF. Convert it to PDF first.') : err} />
      </div>
    </div>
  );
}

export function Side({ desk, children, cta, bar }: { desk: boolean; children: React.ReactNode; cta: React.ReactNode; bar: { title: string; sub: string; extra?: React.ReactNode } }) {
  if (desk) return <aside className="tside"><div className="sb">{children}</div><div className="sf">{cta}</div></aside>;
  return null;
}
export function Bar({ desk, bar, cta }: { desk: boolean; bar: { title: string; sub: string; extra?: React.ReactNode }; cta: React.ReactNode }) {
  if (desk) return null;
  return <div className="tbar"><div className="t"><b>{bar.title}</b><span>{bar.sub}</span></div>{bar.extra}{cta}</div>;
}

// ---------------- combine ----------------

interface CFile { id: string; name: string; kind: 'pdf' | 'image'; file: File; pages: number; size: number; range: string; pdf?: any; thumb?: string }

function Combine(p: Props & { desk: boolean; mobile: boolean }) {
  const [files, setFiles] = useState<CFile[]>([]);
  const [outName, setOutName] = useState('Combined.pdf');
  const [marks, setMarks] = useState(true);
  const [optsOpen, setOptsOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const drop = useFileDrop((f) => add(f), { accept: (f) => isPdf(f) || isImage(f), onReject: () => p.toast({ msg: t('Only PDFs and images can be combined. Use “Convert to PDF” for other files.'), kind: 'err' }) });
  const add = async (list: FileList | File[]) => {
    const added: CFile[] = [];
    for (const f of Array.from(list)) {
      const id = Math.random().toString(36).slice(2);
      if (isPdf(f)) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const pdf = await openPdf(bytes);
          added.push({ id, name: f.name, kind: 'pdf', file: f, pages: pdf.numPages, size: f.size, range: '', pdf });
        } catch (e: any) { p.toast({ msg: e?.name === 'PasswordException' ? t('{name} is password-protected. Unlock it first (Password tool).', { name: f.name }) : t('Couldn’t read {name}', { name: f.name }), kind: 'err' }); }
      } else if (isImage(f)) {
        added.push({ id, name: f.name, kind: 'image', file: f, pages: 1, size: f.size, range: '', thumb: URL.createObjectURL(f) });
      }
    }
    setFiles((cur) => {
      const next = [...cur, ...added];
      if (cur.length === 0 && next[0]) setOutName(baseName(next[0].name) + '-combined.pdf');
      return next;
    });
  };
  // start with the open document, if any
  useEffect(() => {
    if (started.current || !p.current) return;
    started.current = true;
    const c = p.current;
    setFiles([{ id: 'cur', name: c.name, kind: 'pdf', file: new File([c.bytes as Uint8Array<ArrayBuffer>], c.name, { type: 'application/pdf' }), pages: c.pdf.numPages, size: c.bytes.length, range: '', pdf: c.pdf }]);
    setOutName(baseName(c.name) + '-combined.pdf');
  }, [p.current]);

  const total = files.reduce((n, f) => n + (f.kind === 'pdf' ? (f.range.trim() ? parseRange(f.range, f.pages).length : f.pages) : 1), 0);

  const run = async () => {
    if (!files.length) return;
    // a range that matches no page of its file would silently leave the file out
    const badRange = files.find((f) => f.kind === 'pdf' && f.range.trim() && !parseRange(f.range, f.pages).length);
    if (badRange) { p.toast({ msg: t('“{range}” matches no page of {name} ({n} pages)', { range: badRange.range, name: badRange.name, n: badRange.pages }), kind: 'err' }); return; }
    p.setBusy({ title: t('Combining files'), detail: t('{f} files · {n} pages. Nothing is uploaded.', { f: files.length, n: total }) });
    try {
      const out = await PDFDocument.create();
      const outline: { title: string; page: number }[] = [];
      for (const f of files) {
        const startPage = out.getPageCount();
        if (f.kind === 'pdf') {
          const src = await loadDoc(new Uint8Array(await f.file.arrayBuffer()));
          const idx = f.range.trim() ? parseRange(f.range, src.getPageCount()) : src.getPageIndices();
          (await out.copyPages(src, idx)).forEach((pg) => out.addPage(pg));
        } else {
          await addImagePage(out, await imageBytes(f.file));
        }
        if (out.getPageCount() > startPage) outline.push({ title: baseName(f.name), page: startPage });
      }
      if (marks) addOutline(out, outline);
      const bytes = await save(out);
      p.setBusy(null);
      const name = /\.pdf$/i.test(outName) ? outName : outName + '.pdf';
      await saveFile(p.host, bytes, name, 'application/pdf', (m) => p.toast({ ...m, action: { label: t('Edit'), run: () => p.onOpenInEditor(name, bytes) } }));
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: t('Combining failed: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' });
    }
  };

  const cta = <button className="btn primary lg block" disabled={files.length < 1} onClick={run}><Icon name="stack:bold" size={18} />{p.desk ? tn(files.length, 'Combine {n} file', 'Combine {n} files') : t('Combine')}</button>;
  const options = (
    <>
      <div className="field"><span className="label">{t('File name')}</span><input className="input" value={outName} onChange={(e) => setOutName(e.target.value)} /></div>
      <Toggle label={t('Bookmark each file')} hint={t('Adds an outline entry per document')} checked={marks} onChange={setMarks} />
    </>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }} {...drop.bind}>
      <DropOverlay show={drop.over} title={t('Drop to add')} sub={t('PDFs and images join the list at the end')} />
      <div className="tmain">
        <div className="flist">
          <div className="label" style={{ padding: '0 4px 4px' }}>{p.mobile ? t('Hold a file to drag it into place.') : t('Drag to set the order.')} {t('Type a range like “1–3” to use only some pages.')}</div>
          <SortableArea items={files} idOf={(f) => f.id} onReorder={setFiles} layout="list"
            overlay={(f) => <div className="frow"><FileRowBody f={f} /></div>}>
            {files.map((f) => (
              <FileRow key={f.id} f={f}
                onRange={(range) => setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, range } : x)))}
                onRemove={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} />
            ))}
          </SortableArea>
          <button className="adddash" onClick={() => input.current?.click()}><Icon name="plus:bold" size={16} />{t('Add PDFs or images')}</button>
          {!p.desk && optsOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>{options}</div>}
        </div>
        <input ref={input} type="file" multiple accept="application/pdf,.pdf,image/*,.heic,.heif" hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{t('Output')}</h3>{options}</Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: tn(total, '{n} page in total', '{n} pages in total'), sub: outName,
        extra: <button className="ibtn" style={{ width: 48, height: 48, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }} aria-label={t('Options')} aria-expanded={optsOpen} onClick={() => setOptsOpen((v) => !v)}><Icon name="more" size={20} /></button> }} />
    </div>
  );
}

function FileRow({ f, onRange, onRemove }: { f: CFile; onRange: (r: string) => void; onRemove: () => void }) {
  const s = useSortableItem(f.id);
  return (
    <div ref={s.ref} style={s.style} className={`frow${s.dragging ? ' hole' : ''}`} {...s.pointer}>
      <FileRowBody f={f} grip={s.grip} onRange={onRange} onRemove={onRemove} />
    </div>
  );
}

/** A file row's content; also drawn under the finger while dragging. */
function FileRowBody({ f, grip, onRange, onRemove }: { f: CFile; grip?: Record<string, any>; onRange?: (r: string) => void; onRemove?: () => void }) {
  return (
    <>
      <button className="fgrip" aria-label={t('Move {name}', { name: f.name })} title={t('Drag to reorder (or press Space, then the arrow keys)')} {...grip}>
        <Icon name="dots-six-vertical:bold" size={18} />
      </button>
      <div className="fthumb">{f.pdf ? <Thumb pdf={f.pdf} src={0} size={60} /> : <img src={f.thumb} alt="" draggable={false} />}</div>
      <div className="fi"><b title={f.name}>{f.name}</b><span>{f.kind === 'pdf' ? tn(f.pages, '{n} page', '{n} pages') : t('Image · 1 page')} · {fmtSize(f.size)}</span></div>
      {f.kind === 'pdf' && f.pages > 1 && (
        <input className="range-in" value={f.range} placeholder={t('All pages')} aria-label={`Pages of ${f.name}`} readOnly={!onRange}
          onChange={(e) => onRange?.(e.target.value)} />
      )}
      <button className="ibtn muted" aria-label={t('Remove {name}', { name: f.name })} tabIndex={grip ? 0 : -1} onClick={onRemove}><Icon name="close" size={17} /></button>
    </>
  );
}

// ---------------- extract / remove ----------------

function PagePick(p: Props & { desk: boolean; mobile: boolean; mode: 'extract' | 'remove'; onMode: (m: ToolId) => void }) {
  const { src, load, err } = useSource(p.current);
  const [sel, setSel] = useState<number[]>([]); // positions in src.pages
  const [rangeText, setRangeText] = useState('');
  const [perPage, setPerPage] = useState(false);
  if (!src) return <PickPdf onFile={load} err={err} title={p.mode === 'extract' ? t('Choose a PDF to extract pages from') : t('Choose a PDF to remove pages from')} />;
  const n = src.pages.length;
  const extract = p.mode === 'extract';
  const toggle = (i: number) => { const next = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort((a, b) => a - b); setSel(next); setRangeText(formatRange(next)); };
  const run = async () => {
    if (!sel.length) return;
    try {
      if (extract) {
        p.setBusy({ title: t('Extracting pages'), detail: t('{s} of {n} pages. The original stays unchanged.', { s: sel.length, n }) });
        const chosen = sel.map((i) => src.pages[i]);
        if (perPage && chosen.length > 1) {
          const JSZip = (await import('jszip')).default;
          const zip = new JSZip();
          for (let k = 0; k < chosen.length; k++) zip.file(`${baseName(src.name)}-page-${sel[k] + 1}.pdf`, await save(await pickPages(src.bytes, [chosen[k]])));
          const bytes = await zip.generateAsync({ type: 'uint8array' });
          p.setBusy(null);
          await saveFile(p.host, bytes, `${baseName(src.name)}-pages.zip`, 'application/zip', p.toast);
        } else {
          const bytes = await save(await pickPages(src.bytes, chosen));
          p.setBusy(null);
          const name = `${baseName(src.name)}-pages-${formatRange(sel).replace(/[–,\s]+/g, (m) => (m.includes('–') ? '-' : '_'))}.pdf`;
          await saveFile(p.host, bytes, name, 'application/pdf', p.toast);
        }
      } else {
        const keep = src.pages.filter((_, i) => !sel.includes(i));
        if (!keep.length) { p.toast({ msg: t('A PDF needs at least one page'), kind: 'err' }); return; }
        if (src.fromEditor) { p.onApplyPages(keep); p.toast({ msg: tn(sel.length, 'Removed {n} page', 'Removed {n} pages'), action: { label: t('Undo'), run: () => p.onApplyPages(src.pages) } }); return; }
        p.setBusy({ title: t('Removing pages'), detail: t('{a} → {b} pages', { a: n, b: keep.length }) });
        const bytes = await save(await pickPages(src.bytes, keep));
        p.setBusy(null);
        await saveFile(p.host, bytes, `${baseName(src.name)}-${keep.length}-pages.pdf`, 'application/pdf', p.toast);
      }
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: t('That didn’t work: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' });
    }
  };
  const ctaLabel = !sel.length ? (extract ? t('Extract pages') : t('Remove pages')) : extract ? tn(sel.length, 'Extract {n} page', 'Extract {n} pages') : tn(sel.length, 'Remove {n} page', 'Remove {n} pages');
  const cta = (
    <button className={`btn lg block ${extract ? 'primary' : 'danger solid'}`} disabled={!sel.length || (!extract && sel.length >= n)} onClick={run}>
      <Icon name={extract ? 'export:bold' : 'trash:bold'} size={18} />{p.desk ? ctaLabel : `${extract ? t('Extract') : t('Remove')}${sel.length ? ' ' + sel.length : ''}`}
    </button>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="pgrid">
          <div className="bar">
            <Seg value={p.mode} onChange={(m) => { p.onMode(m); }} options={[['extract', <><Icon name="export" size={16} />{t('Extract')}</>], ['remove', <><Icon name="trash" size={16} />{t('Remove')}</>]]} />
            <div style={{ flex: 1 }} />
            <label className="rangebox"><span className="label">{t('Pages')}</span>
              <input value={rangeText} placeholder="e.g. 1–2, 5" aria-label={t('Page range')}
                onChange={(e) => { setRangeText(e.target.value); setSel(parseRange(e.target.value, n)); }} /></label>
            <button className="btn ghost" style={{ color: 'var(--ink)' }} onClick={() => { const all = sel.length === n ? [] : src.pages.map((_, i) => i); setSel(all); setRangeText(formatRange(all)); }}>
              {sel.length === n ? t('Select none') : t('Select all')}
            </button>
          </div>
          {src.fromEditor && p.current?.changed && <div className="note"><Icon name="info" size={16} /><span>{t('Uses the pages of the open document; text and objects you added are included only after you download from the editor.')}</span></div>}
          <div className="cells">
            {src.pages.map((pg, i) => (
              <div key={pg.src + ':' + i} className={`pcell${!extract ? ' rm' : ''}${sel.includes(i) ? ' on' : ''}`}>
                <button className="pc" onClick={() => toggle(i)} aria-pressed={sel.includes(i)} aria-label={t('Page {p}', { p: i + 1 })}>
                  <span className="ck"><Icon name="check" size={14} /></span>
                  <Thumb pdf={src.pdf} src={pg.src} rotation={pg.rotation} size={200} />
                  {!extract && sel.includes(i) && <span className="rmx"><span><Icon name="trash:bold" size={20} /></span></span>}
                </button>
                <div className="lb">{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}>
        {extract ? (
          <>
            <h3>{t('Extract pages')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className={`opt radio-opt${!perPage ? ' on' : ''}`} onClick={() => setPerPage(false)}><span className="rd" /><span className="ot"><b>{t('One PDF')}</b><span>{t('All selected pages, in order')}</span></span></button>
              <button className={`opt radio-opt${perPage ? ' on' : ''}`} onClick={() => setPerPage(true)}><span className="rd" /><span className="ot"><b>{t('A PDF per page')}</b><span>{t('Downloads as a .zip')}</span></span></button>
            </div>
            <div className="hint" style={{ fontSize: 13, color: 'var(--muted)' }}>{t('The original stays unchanged.')}</div>
          </>
        ) : (
          <>
            <h3>{t('Remove pages')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="big">{t('{a} → {b} pages', { a: n, b: n - sel.length })}</span>
              <span className="label" style={{ fontWeight: 400 }}>{sel.length ? tn(sel.length, 'Page {r} will be removed.', 'Pages {r} will be removed.', { r: formatRange(sel) }) : t('Tap the pages to remove.')}{src.fromEditor ? t(' You can undo this in the editor.') : ''}</span>
            </div>
          </>
        )}
      </Side>
      <Bar desk={p.desk} cta={cta} bar={{
        title: tn(sel.length, '{n} page selected', '{n} pages selected'),
        sub: extract ? (perPage ? t('One PDF per page (.zip)') : t('Saved as one new PDF')) : tn(n - sel.length, '{n} page will remain', '{n} pages will remain'),
        extra: extract ? <button className="ibtn" style={{ width: 48, height: 48, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }} aria-label={perPage ? t('Save as one PDF') : t('Save a PDF per page')} title={perPage ? t('One PDF per page') : t('One PDF')} onClick={() => setPerPage((v) => !v)}><Icon name={perPage ? 'files:duotone' : 'file-pdf:duotone'} size={20} /></button> : undefined,
      }} />
    </div>
  );
}

// ---------------- insert ----------------

type InsertKind = 'blank' | 'pdf' | 'image' | 'camera';

function Insert(p: Props & { desk: boolean; mobile: boolean }) {
  const { src, load, err, setSrc } = useSource(p.current);
  const [after, setAfter] = useState<number | null>(null); // insert after this position
  // pages inserted so far (positions in the current document); several inserts build up before opening
  const [fresh, setFresh] = useState<number[]>([]);
  const [kind, setKind] = useState<InsertKind>('blank');
  const [size, setSize] = useState<'match' | 'a4' | 'letter'>('match');
  const [count, setCount] = useState(1);
  const [sheet, setSheet] = useState(false);
  const pdfIn = useRef<HTMLInputElement>(null);
  const imgIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);
  const at = after ?? (src ? src.pages.length - 1 : 0);
  // PDFs and images dropped on the pages go in at the chosen place
  const dropTo = useRef<(f: File[]) => void>(() => {});
  const drop = useFileDrop((f) => dropTo.current(f), { accept: (f) => isPdf(f) || isImage(f) });
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to add pages to')} />;

  const build = async (fill: (doc: PDFDocument, index: number) => Promise<number>) => {
    p.setBusy({ title: t('Inserting pages'), detail: t('Building the new PDF on this device…') });
    try {
      const doc = await pickPages(src.bytes, src.pages);
      const added = await fill(doc, at + 1);
      const bytes = await save(doc);
      const pdf = await openPdf(bytes);
      setSrc({ name: src.name, bytes, pdf, pages: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })), fromEditor: false });
      setFresh((f) => [...f.map((i) => (i > at ? i + added : i)), ...Array.from({ length: added }, (_, k) => at + 1 + k)]);
      setAfter(at + added); // the next pages go after these
      p.setBusy(null);
      p.toast({ msg: tn(added, 'Added {n} page after page {p}', 'Added {n} pages after page {p}', { p: at + 1 }) });
    } catch (e: any) {
      p.setBusy(null);
      const m = String(e?.message ?? '');
      p.toast({ msg: /encrypt|password/i.test(m) ? t('That PDF is password-protected. Unlock it first (Password tool).') : /PDF header|parse|Invalid|corrupt/i.test(m) ? t('That file isn’t a readable PDF.') : t('Couldn’t insert: {e}', { e: m || t('unknown error') }), kind: 'err' });
    }
  };
  const insertBlank = () => build(async (doc, i) => {
    const ref = doc.getPage(Math.max(0, Math.min(doc.getPageCount() - 1, i - 1)));
    const { width, height } = ref.getSize();
    const dims: [number, number] = size === 'a4' ? [595.28, 841.89] : size === 'letter' ? [612, 792] : [width, height];
    for (let k = 0; k < count; k++) doc.insertPage(i + k, dims);
    return count;
  });
  const insertPdf = (f: File) => build(async (doc, i) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    try { (await openPdf(bytes)).destroy?.(); } catch (e: any) { throw new Error(e?.name === 'PasswordException' ? 'password' : 'not a readable PDF (parse)'); } // an encrypted PDF would be copied as garbage pages
    const other = await loadDoc(bytes);
    const pages = await doc.copyPages(other, other.getPageIndices());
    pages.forEach((pg, k) => doc.insertPage(i + k, pg));
    return pages.length;
  });
  const insertImages = (files: File[]) => build(async (doc, i) => {
    let k = 0;
    for (const f of files) { await addImagePage(doc, await imageBytes(f), size === 'match' ? 'fit' : size, 0, i + k); k++; }
    return k;
  });
  dropTo.current = (files) => {
    const pdfs = files.filter(isPdf), imgs = files.filter((f) => !isPdf(f));
    if (pdfs.length) insertPdf(pdfs[0]); else if (imgs.length) insertImages(imgs);
  };
  const run = (k: InsertKind = kind) => {
    if (k === 'blank') insertBlank();
    else if (k === 'pdf') pdfIn.current?.click();
    else if (k === 'image') imgIn.current?.click();
    else camIn.current?.click();
  };
  const opts: [InsertKind, string, string, string][] = [
    ['blank', 'Blank page', 'Same size as your document', 'file:duotone'],
    ['pdf', 'Pages from a PDF', 'Pick a file to add all its pages', 'file-pdf:duotone'],
    ['image', 'Image', 'One page per image', 'image:duotone'],
    ...(p.host.isNative ? [['camera', 'Scan with camera', 'Take a photo of a page', 'camera:duotone'] as [InsertKind, string, string, string]] : []),
  ];
  const optionList = (onPick?: (k: InsertKind) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {opts.map(([k, name, desc, ic]) => (
        <button key={k} className={`opt${kind === k ? ' on' : ''}`} onClick={() => { setKind(k); onPick?.(k); }}>
          <span className="oi"><Icon name={ic} size={20} /></span><span className="ot"><b>{t(name)}</b><span>{t(desc)}</span></span>
          {onPick && <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />}
        </button>
      ))}
    </div>
  );
  const blankOpts = (
    <div className="field">
      <span className="label">{kind === 'image' ? t('Page size') : t('Blank page size')}</span>
      <Seg value={size} onChange={setSize} options={[['match', kind === 'image' ? 'Fit' : 'Match'], ['a4', 'A4'], ['letter', 'Letter']]} />
      {kind === 'blank' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontWeight: 500 }}>{t('How many')}</span>
          <div style={{ width: 140 }}><Stepper value={count} min={1} max={50} onChange={setCount} label={t('pages')} /></div>
        </div>
      )}
    </div>
  );
  const ctaText = kind === 'blank' ? tn(count, 'Insert blank page', 'Insert {n} blank pages') : kind === 'pdf' ? t('Choose a PDF') : kind === 'image' ? t('Choose images') : t('Open camera');
  const finish = () => p.onOpenInEditor(src.name, src.bytes);
  const done = fresh.length > 0 && <button className={`btn ${p.desk ? 'outline lg block' : 'primary lg'}`} onClick={finish}><Icon name="check:bold" size={18} />{p.desk ? t('Done · open in editor') : t('Done')}</button>;
  const cta = (
    <>
      <button className={`btn ${fresh.length && !p.desk ? 'outline' : 'primary'} lg${p.desk ? ' block' : ''}`} onClick={() => (p.desk ? run() : setSheet(true))}><Icon name="plus:bold" size={18} />{p.desk ? ctaText : fresh.length ? t('Add') : t('Insert')}</button>
      {done}
    </>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column', position: 'relative' }} {...drop.bind}>
      <DropOverlay show={drop.over} title={t('Drop to insert after page {p}', { p: at + 1 })} sub={t('All pages of a PDF, or one page per image')} />
      <div className="tmain">
        <div className="pgrid">
          <div className="bar"><div className="label" style={{ fontWeight: 400, color: 'var(--muted-2)' }}>{tj('Tap a {plus} between pages to choose where new pages go.', { plus: <b style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: '50%', background: '#1E2559', color: '#fff', alignItems: 'center', justifyContent: 'center', verticalAlign: -4 }}><Icon name="plus:bold" size={11} /></b> })}</div></div>
          {fresh.length > 0 && <div className="note"><Icon name="info" size={16} /><span>{tj(fresh.length === 1 ? '{n} new page. Tap another {plus} to add more, then {done} to open the result.' : '{n} new pages. Tap another {plus} to add more, then {done} to open the result.', { n: fresh.length, plus: <b>+</b>, done: <b>{t('Done')}</b> })}</span></div>}
          {src.fromEditor && p.current?.changed && <div className="note"><Icon name="info" size={16} /><span>{t('The result opens in the editor. Download your current edits first if you want to keep them.')}</span></div>}
          <div className="cells">
            {src.pages.map((pg, i) => (
              <React.Fragment key={pg.src + ':' + i}>
                <div className={`pcell${fresh.includes(i) ? ' fresh' : ''}`}>
                  {fresh.includes(i) && <span className="newtag">{t('New')}</span>}
                  <div className="pc"><Thumb pdf={src.pdf} src={pg.src} rotation={pg.rotation} size={200} /></div>
                  <div className="lb">{i + 1}</div>
                  {at !== i && <button className="gap" onClick={() => setAfter(i)} aria-label={t('Insert after page {p}', { p: i + 1 })}><Icon name="plus:bold" size={13} /></button>}
                </div>
                {at === i && <InsertSlot active label={kind === 'blank' ? (count > 1 ? t('{n} blank pages', { n: count }) : t('Blank page')) : kind === 'pdf' ? t('Pages from a PDF') : kind === 'image' ? t('Images') : t('Camera')} onClick={() => (p.desk ? run() : setSheet(true))} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><h3>{t('Insert after page {p}', { p: at + 1 })}</h3><span className="label" style={{ fontWeight: 400 }}>{t('Choose what to add')}</span></div>
        {optionList()}
        {(kind === 'blank' || kind === 'image') && blankOpts}
      </Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: t('After page {p}', { p: at + 1 }), sub: fresh.length ? t('{n} pages · {k} new', { n: src.pages.length, k: fresh.length }) : t('{n} pages now', { n: src.pages.length }) }} />
      {sheet && !p.desk && (
        <>
          <div className="sheet-scrim" onClick={() => setSheet(false)} />
          <div className="bsheet" role="dialog" aria-label={t('Insert pages')} style={p.mobile ? undefined : { left: 120, right: 120, bottom: 32, borderRadius: 20 }}>
            <div className="grab" />
            <div className="props">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{t('Insert after page {p}', { p: at + 1 })}</h3><span className="label" style={{ fontWeight: 400 }}>{t('Choose what to add')}</span></div>
              {optionList((k) => { if (k !== 'blank') { setSheet(false); run(k); } })}
              {kind === 'blank' && <>{blankOpts}<button className="btn primary lg block" onClick={() => { setSheet(false); insertBlank(); }}><Icon name="plus:bold" size={18} />{ctaText}</button></>}
            </div>
          </div>
        </>
      )}
      <input ref={pdfIn} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) insertPdf(f); e.target.value = ''; }} />
      <input ref={imgIn} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { const f = e.target.files; if (f?.length) insertImages([...f]); e.target.value = ''; }} />
      <input ref={camIn} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files; if (f?.length) insertImages([...f]); e.target.value = ''; }} />
    </div>
  );
}

function InsertSlot({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <div className="pcell" aria-current={active}>
      <button className="newslot" onClick={onClick} aria-label={`Insert here: ${label}`}><Icon name="plus:bold" size={22} /><span>{label}</span><small>{t('Tap to add')}</small></button>
      <div className="lb" style={{ color: 'var(--sel)', fontWeight: 700 }}>{t('New')}</div>
    </div>
  );
}
