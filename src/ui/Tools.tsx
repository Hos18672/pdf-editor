import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useBack } from './back';
import { openPdf } from './pdfjs';
import { Thumb } from './Thumb';
import { Seg, Stepper, Toggle } from './Panel';
import { saveFile, HostProps, ToastMsg, BusyMsg, type EditorStart } from './Editor';
import { parseRange, formatRange, loadDoc, pickPages, imageBytes, addImagePage, addOutline, save, baseName, fmtSize } from './pdfops';
import { Convert } from './Convert';
import { SortableArea, useSortableItem } from './sortable';
import type { Bp } from './hooks';
import type { PageState } from '../engine/types';
import { PDFDocument } from 'pdf-lib';

export type ToolId = 'hub' | 'combine' | 'extract' | 'remove' | 'insert' | 'convert';

interface Current { name: string; bytes: Uint8Array; pdf: any; pages: PageState[]; changed: boolean }
interface Src { name: string; bytes: Uint8Array; pdf: any; pages: PageState[]; fromEditor: boolean }

interface Props {
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
  const mobile = p.bp === 'mobile', desk = p.bp === 'desktop' || p.bp === 'large';
  const back = () => (tool === 'hub' ? p.onBack() : setTool('hub'));
  useBack(back);
  const meta: Record<ToolId, [string, string]> = {
    hub: ['All tools', 'Every tool runs on this device'],
    combine: ['Combine PDFs', 'Merge files and images into one PDF'],
    extract: ['Extract pages', 'Save chosen pages as a new PDF'],
    remove: ['Remove pages', 'Delete pages you don’t need'],
    insert: ['Insert pages', 'Add blank pages, images or another PDF'],
    convert: ['Convert to PDF', 'Images, Office files, text and web pages'],
  };
  const conv = (k: string) => () => { setConvertKind(k); setTool('convert'); };
  const groups: { name: string; items: HubItem[] }[] = [
    { name: 'Edit & sign', items: [
      { name: 'Edit PDF', desc: 'Retype text, add text, images and shapes', icon: 'pencil-simple-line:duotone', tile: TILE.edit, go: () => p.onEdit('edit') },
      { name: 'Fill a form', desc: 'Type in fields, tick boxes, pick options', icon: 'textbox:duotone', tile: TILE.edit, go: () => p.onEdit('fill') },
      { name: 'Sign', desc: 'Draw, type or upload a signature', icon: 'signature:duotone', tile: TILE.edit, go: () => p.onEdit('sign') },
    ] },
    { name: 'Scan', items: [
      { name: 'Scan a document', desc: 'Camera or photos: auto-crop, straighten and clean up', icon: 'scan:duotone', tile: '#DDF1E4', go: p.onScan },
      { name: 'Scan an ID card', desc: 'Front and back on one page, actual size', icon: 'identification-card:duotone', tile: '#DDF1E4', go: () => { try { localStorage.setItem('pe.scan.mode', 'id'); } catch { /* private */ } p.onScan(); } },
      { name: 'Scan a receipt or invoice', desc: 'Long receipts and bills, sharp and white', icon: 'receipt:duotone', tile: '#DDF1E4', go: () => { try { localStorage.setItem('pe.scan.mode', 'receipt'); } catch { /* private */ } p.onScan(); } },
    ] },
    { name: 'Organize pages', items: [
      { name: 'Combine PDFs', desc: 'Merge several files into one', icon: 'stack:duotone', tile: TILE.org, go: () => setTool('combine') },
      { name: 'Extract pages', desc: 'Save chosen pages as a new PDF', icon: 'export:duotone', tile: TILE.org, go: () => setTool('extract') },
      { name: 'Remove pages', desc: 'Delete pages you don’t need', icon: 'file-minus:duotone', tile: TILE.org, go: () => setTool('remove') },
      { name: 'Insert pages', desc: 'Add blank pages, images or another PDF', icon: 'file-plus:duotone', tile: TILE.org, go: () => setTool('insert') },
      { name: 'Reorder & rotate', desc: 'Drag pages into place, turn them', icon: 'squares-four:duotone', tile: TILE.org, go: () => p.onEdit('pages') },
    ] },
    { name: 'Convert to PDF', items: [
      { name: 'Images to PDF', desc: 'JPG, PNG, HEIC, WebP', icon: 'image:duotone', tile: TILE.conv, go: conv('image') },
      { name: 'Word to PDF', desc: 'DOCX', icon: 'file-doc:duotone', tile: TILE.conv, go: conv('word') },
      { name: 'Excel to PDF', desc: 'XLSX, XLS, CSV, ODS', icon: 'file-xls:duotone', tile: TILE.conv, go: conv('excel') },
      { name: 'PowerPoint to PDF', desc: 'PPTX', icon: 'file-ppt:duotone', tile: TILE.conv, go: conv('ppt') },
      { name: 'Text & web to PDF', desc: 'TXT, Markdown, HTML', icon: 'file-html:duotone', tile: TILE.conv, go: conv('text') },
    ] },
  ];

  return (
    <div className="tscreen">
      <header className="topbar">
        <button className="ibtn" onClick={back} aria-label="Back"><Icon name="back" /></button>
        <div className="doc"><div className="names"><div className="fname">{meta[tool][0]}</div><div className="fmeta">{meta[tool][1]}</div></div></div>
        {!mobile && <div className="privacy-pill"><Icon name="lock" size={14} />Processed on this device</div>}
      </header>
      {tool === 'hub' && (
        <div className="tmain">
          <div className="hub">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <h1>What do you want to do?</h1>
              <div className="sub">Every tool runs in your browser. Files never leave this device.</div>
            </div>
            {groups.map((g) => (
              <section key={g.name} className="grp">
                <div className="kicker">{g.name}</div>
                <div className="cards">
                  {g.items.map((t) => (
                    <button key={t.name} className="hcard" onClick={t.go}>
                      <span className="ti" style={{ background: t.tile }}><Icon name={t.icon} size={23} /></span>
                      <span className="tt"><b>{t.name}</b><span>{t.desc}</span></span>
                      <Icon name="right" size={16} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      {tool === 'combine' && <Combine {...p} desk={desk} mobile={mobile} />}
      {(tool === 'extract' || tool === 'remove') && <PagePick {...p} desk={desk} mobile={mobile} mode={tool} onMode={setTool} />}
      {tool === 'insert' && <Insert {...p} desk={desk} mobile={mobile} />}
      {tool === 'convert' && <Convert host={p.host} toast={p.toast} desk={desk} mobile={mobile} kind={convertKind} onOpenInEditor={p.onOpenInEditor} />}
    </div>
  );
}

// ---------------- shared bits ----------------

function useSource(current: Current | null) {
  const [src, setSrc] = useState<Src | null>(current ? { ...current, fromEditor: true } : null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (f: File) => {
    setErr(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdf = await openPdf(bytes);
      setSrc({ name: f.name, bytes, pdf, pages: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })), fromEditor: false });
    } catch (e: any) {
      setErr(e?.name === 'PasswordException' ? 'This PDF is password-protected. Open it in the editor first to unlock it.' : 'That file couldn’t be opened as a PDF.');
    }
  };
  return { src, load, err, setSrc };
}

function PickPdf({ onFile, err, title }: { onFile: (f: File) => void; err: string | null; title: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="tmain">
      <div className="flist" style={{ maxWidth: 560, marginTop: '6vh' }}>
        <div className={`dz${over ? ' over' : ''}`} style={{ flexDirection: 'column', textAlign: 'center', padding: '40px 24px' }}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}>
          <div className="dzi"><Icon name="file-pdf:duotone" size={26} /></div>
          <div className="dzt" style={{ alignItems: 'center' }}><b>{title}</b><span className="label">Drop a PDF here or choose one</span></div>
          <button className="btn primary lg" onClick={() => ref.current?.click()}><Icon name="open" size={18} />Choose PDF</button>
          {err && <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
        </div>
      </div>
      <input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}

function Side({ desk, children, cta, bar }: { desk: boolean; children: React.ReactNode; cta: React.ReactNode; bar: { title: string; sub: string; extra?: React.ReactNode } }) {
  if (desk) return <aside className="tside"><div className="sb">{children}</div><div className="sf">{cta}</div></aside>;
  return null;
}
function Bar({ desk, bar, cta }: { desk: boolean; bar: { title: string; sub: string; extra?: React.ReactNode }; cta: React.ReactNode }) {
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

  const add = async (list: FileList | File[]) => {
    const added: CFile[] = [];
    for (const f of Array.from(list)) {
      const id = Math.random().toString(36).slice(2);
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const pdf = await openPdf(bytes);
          added.push({ id, name: f.name, kind: 'pdf', file: f, pages: pdf.numPages, size: f.size, range: '', pdf });
        } catch { p.toast({ msg: `Couldn’t read ${f.name}`, kind: 'err' }); }
      } else if (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)) {
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
    p.setBusy({ title: 'Combining files', detail: `${files.length} files · ${total} pages. Nothing is uploaded.` });
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
      await saveFile(p.host, bytes, name, 'application/pdf', (t) => p.toast({ ...t, action: { label: 'Edit', run: () => p.onOpenInEditor(name, bytes) } }));
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: 'Combining failed: ' + (e?.message ?? 'unknown error'), kind: 'err' });
    }
  };

  const cta = <button className="btn primary lg block" disabled={files.length < 1} onClick={run}><Icon name="stack:bold" size={18} />{p.desk ? `Combine ${files.length} ${files.length === 1 ? 'file' : 'files'}` : 'Combine'}</button>;
  const options = (
    <>
      <div className="field"><span className="label">File name</span><input className="input" value={outName} onChange={(e) => setOutName(e.target.value)} /></div>
      <Toggle label="Bookmark each file" hint="Adds an outline entry per document" checked={marks} onChange={setMarks} />
    </>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="flist">
          <div className="label" style={{ padding: '0 4px 4px' }}>{p.mobile ? 'Hold a file to drag it into place.' : 'Drag to set the order.'} Type a range like “1–3” to use only some pages.</div>
          <SortableArea items={files} idOf={(f) => f.id} onReorder={setFiles} layout="list"
            overlay={(f) => <div className="frow"><FileRowBody f={f} /></div>}>
            {files.map((f) => (
              <FileRow key={f.id} f={f}
                onRange={(range) => setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, range } : x)))}
                onRemove={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} />
            ))}
          </SortableArea>
          <button className="adddash" onClick={() => input.current?.click()}><Icon name="plus:bold" size={16} />Add PDFs or images</button>
          {!p.desk && optsOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16, background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow-card)' }}>{options}</div>}
        </div>
        <input ref={input} type="file" multiple accept="application/pdf,.pdf,image/*,.heic,.heif" hidden onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>Output</h3>{options}</Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: `${total} ${total === 1 ? 'page' : 'pages'} in total`, sub: outName,
        extra: <button className="ibtn" style={{ width: 48, height: 48, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }} aria-label="Options" aria-expanded={optsOpen} onClick={() => setOptsOpen((v) => !v)}><Icon name="more" size={20} /></button> }} />
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
      <button className="fgrip" aria-label={`Move ${f.name}`} title="Drag to reorder (or press Space, then the arrow keys)" {...grip}>
        <Icon name="dots-six-vertical:bold" size={18} />
      </button>
      <div className="fthumb">{f.pdf ? <Thumb pdf={f.pdf} src={0} size={60} /> : <img src={f.thumb} alt="" draggable={false} />}</div>
      <div className="fi"><b title={f.name}>{f.name}</b><span>{f.kind === 'pdf' ? `${f.pages} ${f.pages === 1 ? 'page' : 'pages'}` : 'Image · 1 page'} · {fmtSize(f.size)}</span></div>
      {f.kind === 'pdf' && f.pages > 1 && (
        <input className="range-in" value={f.range} placeholder="All pages" aria-label={`Pages of ${f.name}`} readOnly={!onRange}
          onChange={(e) => onRange?.(e.target.value)} />
      )}
      <button className="ibtn muted" aria-label={`Remove ${f.name}`} tabIndex={grip ? 0 : -1} onClick={onRemove}><Icon name="close" size={17} /></button>
    </>
  );
}

// ---------------- extract / remove ----------------

function PagePick(p: Props & { desk: boolean; mobile: boolean; mode: 'extract' | 'remove'; onMode: (m: ToolId) => void }) {
  const { src, load, err } = useSource(p.current);
  const [sel, setSel] = useState<number[]>([]); // positions in src.pages
  const [rangeText, setRangeText] = useState('');
  const [perPage, setPerPage] = useState(false);
  if (!src) return <PickPdf onFile={load} err={err} title={p.mode === 'extract' ? 'Choose a PDF to extract pages from' : 'Choose a PDF to remove pages from'} />;
  const n = src.pages.length;
  const extract = p.mode === 'extract';
  const toggle = (i: number) => { const next = sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i].sort((a, b) => a - b); setSel(next); setRangeText(formatRange(next)); };
  const run = async () => {
    if (!sel.length) return;
    try {
      if (extract) {
        p.setBusy({ title: 'Extracting pages', detail: `${sel.length} of ${n} pages. The original stays unchanged.` });
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
        if (!keep.length) { p.toast({ msg: 'A PDF needs at least one page', kind: 'err' }); return; }
        if (src.fromEditor) { p.onApplyPages(keep); p.toast({ msg: `Removed ${sel.length} ${sel.length === 1 ? 'page' : 'pages'}`, action: { label: 'Undo', run: () => p.onApplyPages(src.pages) } }); return; }
        p.setBusy({ title: 'Removing pages', detail: `${n} → ${keep.length} pages` });
        const bytes = await save(await pickPages(src.bytes, keep));
        p.setBusy(null);
        await saveFile(p.host, bytes, `${baseName(src.name)}-${keep.length}-pages.pdf`, 'application/pdf', p.toast);
      }
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: 'That didn’t work: ' + (e?.message ?? 'unknown error'), kind: 'err' });
    }
  };
  const ctaLabel = extract ? `Extract ${sel.length || ''} ${sel.length === 1 ? 'page' : 'pages'}` : `Remove ${sel.length || ''} ${sel.length === 1 ? 'page' : 'pages'}`;
  const cta = (
    <button className={`btn lg block ${extract ? 'primary' : 'danger solid'}`} disabled={!sel.length || (!extract && sel.length >= n)} onClick={run}>
      <Icon name={extract ? 'export:bold' : 'trash:bold'} size={18} />{p.desk ? ctaLabel.replace(/\s+/g, ' ') : `${extract ? 'Extract' : 'Remove'}${sel.length ? ' ' + sel.length : ''}`}
    </button>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="pgrid">
          <div className="bar">
            <Seg value={p.mode} onChange={(m) => { p.onMode(m); }} options={[['extract', <><Icon name="export" size={16} />Extract</>], ['remove', <><Icon name="trash" size={16} />Remove</>]]} />
            <div style={{ flex: 1 }} />
            <label className="rangebox"><span className="label">Pages</span>
              <input value={rangeText} placeholder="e.g. 1–2, 5" aria-label="Page range"
                onChange={(e) => { setRangeText(e.target.value); setSel(parseRange(e.target.value, n)); }} /></label>
            <button className="btn ghost" style={{ color: 'var(--ink)' }} onClick={() => { const all = sel.length === n ? [] : src.pages.map((_, i) => i); setSel(all); setRangeText(formatRange(all)); }}>
              {sel.length === n ? 'Select none' : 'Select all'}
            </button>
          </div>
          {src.fromEditor && p.current?.changed && <div className="note"><Icon name="info" size={16} /><span>Uses the pages of the open document; text and objects you added are included only after you download from the editor.</span></div>}
          <div className="cells">
            {src.pages.map((pg, i) => (
              <div key={pg.src + ':' + i} className={`pcell${!extract ? ' rm' : ''}${sel.includes(i) ? ' on' : ''}`}>
                <button className="pc" onClick={() => toggle(i)} aria-pressed={sel.includes(i)} aria-label={`Page ${i + 1}`}>
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
            <h3>Extract pages</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className={`opt radio-opt${!perPage ? ' on' : ''}`} onClick={() => setPerPage(false)}><span className="rd" /><span className="ot"><b>One PDF</b><span>All selected pages, in order</span></span></button>
              <button className={`opt radio-opt${perPage ? ' on' : ''}`} onClick={() => setPerPage(true)}><span className="rd" /><span className="ot"><b>A PDF per page</b><span>Downloads as a .zip</span></span></button>
            </div>
            <div className="hint" style={{ fontSize: 13, color: 'var(--muted)' }}>The original stays unchanged.</div>
          </>
        ) : (
          <>
            <h3>Remove pages</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="big">{n} → {n - sel.length} pages</span>
              <span className="label" style={{ fontWeight: 400 }}>{sel.length ? `${sel.length === 1 ? 'Page' : 'Pages'} ${formatRange(sel)} will be removed.` : 'Tap the pages to remove.'}{src.fromEditor ? ' You can undo this in the editor.' : ''}</span>
            </div>
          </>
        )}
      </Side>
      <Bar desk={p.desk} cta={cta} bar={{
        title: `${sel.length} ${sel.length === 1 ? 'page' : 'pages'} selected`,
        sub: extract ? (perPage ? 'One PDF per page (.zip)' : 'Saved as one new PDF') : `${n - sel.length} pages will remain`,
        extra: extract ? <button className="ibtn" style={{ width: 48, height: 48, borderRadius: 12, boxShadow: 'inset 0 0 0 1.5px var(--line-2)' }} aria-label={perPage ? 'Save as one PDF' : 'Save a PDF per page'} title={perPage ? 'One PDF per page' : 'One PDF'} onClick={() => setPerPage((v) => !v)}><Icon name={perPage ? 'files:duotone' : 'file-pdf:duotone'} size={20} /></button> : undefined,
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
  if (!src) return <PickPdf onFile={load} err={err} title="Choose a PDF to add pages to" />;

  const build = async (fill: (doc: PDFDocument, index: number) => Promise<number>) => {
    p.setBusy({ title: 'Inserting pages', detail: 'Building the new PDF on this device…' });
    try {
      const doc = await pickPages(src.bytes, src.pages);
      const added = await fill(doc, at + 1);
      const bytes = await save(doc);
      const pdf = await openPdf(bytes);
      setSrc({ name: src.name, bytes, pdf, pages: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })), fromEditor: false });
      setFresh((f) => [...f.map((i) => (i > at ? i + added : i)), ...Array.from({ length: added }, (_, k) => at + 1 + k)]);
      setAfter(at + added); // the next pages go after these
      p.setBusy(null);
      p.toast({ msg: `Added ${added} ${added === 1 ? 'page' : 'pages'} after page ${at + 1}` });
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: 'Couldn’t insert: ' + (e?.message ?? 'unknown error'), kind: 'err' });
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
    const other = await loadDoc(new Uint8Array(await f.arrayBuffer()));
    const pages = await doc.copyPages(other, other.getPageIndices());
    pages.forEach((pg, k) => doc.insertPage(i + k, pg));
    return pages.length;
  });
  const insertImages = (files: File[]) => build(async (doc, i) => {
    let k = 0;
    for (const f of files) { await addImagePage(doc, await imageBytes(f), size === 'match' ? 'fit' : size, 0, i + k); k++; }
    return k;
  });
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
          <span className="oi"><Icon name={ic} size={20} /></span><span className="ot"><b>{name}</b><span>{desc}</span></span>
          {onPick && <Icon name="right" size={16} style={{ color: 'var(--faint)' }} />}
        </button>
      ))}
    </div>
  );
  const blankOpts = (
    <div className="field">
      <span className="label">{kind === 'image' ? 'Page size' : 'Blank page size'}</span>
      <Seg value={size} onChange={setSize} options={[['match', kind === 'image' ? 'Fit' : 'Match'], ['a4', 'A4'], ['letter', 'Letter']]} />
      {kind === 'blank' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontWeight: 500 }}>How many</span>
          <div style={{ width: 140 }}><Stepper value={count} min={1} max={50} onChange={setCount} label="pages" /></div>
        </div>
      )}
    </div>
  );
  const ctaText = kind === 'blank' ? `Insert ${count > 1 ? count + ' blank pages' : 'blank page'}` : kind === 'pdf' ? 'Choose a PDF' : kind === 'image' ? 'Choose images' : 'Open camera';
  const finish = () => p.onOpenInEditor(src.name, src.bytes);
  const done = fresh.length > 0 && <button className={`btn ${p.desk ? 'outline lg block' : 'primary lg'}`} onClick={finish}><Icon name="check:bold" size={18} />{p.desk ? `Done · open in editor` : 'Done'}</button>;
  const cta = (
    <>
      <button className={`btn ${fresh.length && !p.desk ? 'outline' : 'primary'} lg${p.desk ? ' block' : ''}`} onClick={() => (p.desk ? run() : setSheet(true))}><Icon name="plus:bold" size={18} />{p.desk ? ctaText : fresh.length ? 'Add' : 'Insert'}</button>
      {done}
    </>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column', position: 'relative' }}>
      <div className="tmain">
        <div className="pgrid">
          <div className="bar"><div className="label" style={{ fontWeight: 400, color: 'var(--muted-2)' }}>Tap a <b style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: '50%', background: '#1E2559', color: '#fff', alignItems: 'center', justifyContent: 'center', verticalAlign: -4 }}><Icon name="plus:bold" size={11} /></b> between pages to choose where new pages go.</div></div>
          {fresh.length > 0 && <div className="note"><Icon name="info" size={16} /><span>{fresh.length} new {fresh.length === 1 ? 'page' : 'pages'}. Tap another <b>+</b> to add more, then <b>Done</b> to open the result.</span></div>}
          {src.fromEditor && p.current?.changed && <div className="note"><Icon name="info" size={16} /><span>The result opens in the editor. Download your current edits first if you want to keep them.</span></div>}
          <div className="cells">
            {src.pages.map((pg, i) => (
              <React.Fragment key={pg.src + ':' + i}>
                <div className={`pcell${fresh.includes(i) ? ' fresh' : ''}`}>
                  {fresh.includes(i) && <span className="newtag">New</span>}
                  <div className="pc"><Thumb pdf={src.pdf} src={pg.src} rotation={pg.rotation} size={200} /></div>
                  <div className="lb">{i + 1}</div>
                  {at !== i && <button className="gap" onClick={() => setAfter(i)} aria-label={`Insert after page ${i + 1}`}><Icon name="plus:bold" size={13} /></button>}
                </div>
                {at === i && <InsertSlot active label={kind === 'blank' ? (count > 1 ? `${count} blank pages` : 'Blank page') : kind === 'pdf' ? 'Pages from a PDF' : kind === 'image' ? 'Images' : 'Camera'} onClick={() => (p.desk ? run() : setSheet(true))} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><h3>{`Insert after page ${at + 1}`}</h3><span className="label" style={{ fontWeight: 400 }}>Choose what to add</span></div>
        {optionList()}
        {(kind === 'blank' || kind === 'image') && blankOpts}
      </Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: `After page ${at + 1}`, sub: fresh.length ? `${src.pages.length} pages · ${fresh.length} new` : `${src.pages.length} pages now` }} />
      {sheet && !p.desk && (
        <>
          <div className="sheet-scrim" onClick={() => setSheet(false)} />
          <div className="bsheet" role="dialog" aria-label="Insert pages" style={p.mobile ? undefined : { left: 120, right: 120, bottom: 32, borderRadius: 20 }}>
            <div className="grab" />
            <div className="props">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{`Insert after page ${at + 1}`}</h3><span className="label" style={{ fontWeight: 400 }}>Choose what to add</span></div>
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
      <button className="newslot" onClick={onClick} aria-label={`Insert here: ${label}`}><Icon name="plus:bold" size={22} /><span>{label}</span><small>Tap to add</small></button>
      <div className="lb" style={{ color: 'var(--sel)', fontWeight: 700 }}>New</div>
    </div>
  );
}
