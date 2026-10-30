// Tools that change or export a whole PDF: compress, password, page numbers, watermark, split,
// pages as pictures, text out. Each one: pick a PDF (or use the open one), set options, get files.
import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from './icons';
import { Thumb } from './Thumb';
import { Seg, Stepper, Toggle } from './Panel';
import { saveFile } from './Editor';
import { useSource, PickPdf, Side, Bar, type Props, type Src } from './Tools';
import { ACCEPT, DropBox, isImage, isPdf } from './drop';
import { baseName, fmtSize, parseRange, formatRange } from './pdfops';
import { openPdf } from './pdfjs';
import { t, tn, locale, getLang } from './i18n';

type TP = Props & { desk: boolean; mobile: boolean };
type Out = { name: string; bytes: Uint8Array; mime: string };

// ---------------- shared screen ----------------

function useOutput(p: TP) {
  const [out, setOut] = useState<{ files: Out[]; summary: React.ReactNode } | null>(null);
  const run = async (title: string, detail: string, fn: (progress: (f: number) => void) => Promise<{ files: Out[]; summary: React.ReactNode } | null>) => {
    p.setBusy({ title, detail, progress: 0 });
    try {
      const r = await fn((f) => p.setBusy({ title, detail, progress: Math.max(0.02, Math.min(1, f)) }));
      p.setBusy(null);
      if (r) setOut(r);
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: e?.userMessage ?? t('That didn’t work: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' });
    }
  };
  return { out, setOut, run };
}

async function saveOut(p: TP, files: Out[], zipName: string) {
  if (files.length === 1) { await saveFile(p.host, files[0].bytes, files[0].name, files[0].mime, p.toast); return; }
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  await saveFile(p.host, await zip.generateAsync({ type: 'uint8array' }), zipName, 'application/zip', p.toast);
}

function FileCard({ src, extra }: { src: Src; extra?: React.ReactNode }) {
  return (
    <div className="xt-file">
      <div className="xt-th"><Thumb pdf={src.pdf} src={src.pages[0]?.src ?? 0} rotation={src.pages[0]?.rotation ?? 0} size={90} /></div>
      <div className="xt-fn"><b>{src.name}</b><span>{tn(src.pages.length, '{n} page', '{n} pages')} · {fmtSize(src.bytes.length)}</span>{extra}</div>
    </div>
  );
}

function Result({ p, files, summary, zipName, onAgain }: { p: TP; files: Out[]; summary: React.ReactNode; zipName: string; onAgain: () => void }) {
  const onePdf = files.length === 1 && files[0].mime === 'application/pdf';
  return (
    <div className="xt-res" role="status">
      <div className="xt-ok"><Icon name="check-circle:fill" size={26} /><div>{summary}</div></div>
      {files.length > 1 && <div className="xt-list">{files.slice(0, 6).map((f) => <span key={f.name}><Icon name="file-pdf:duotone" size={16} />{f.name}<small>{fmtSize(f.bytes.length)}</small></span>)}{files.length > 6 && <span>{t('…and {n} more', { n: files.length - 6 })}</span>}</div>}
      <div className="xt-acts">
        <button className="btn primary lg" onClick={() => saveOut(p, files, zipName)}><Icon name="download" size={18} />{files.length > 1 ? t('Save {n} files (.zip)', { n: files.length }) : t('Save')}</button>
        {onePdf && <button className="btn outline lg" onClick={() => p.onOpenInEditor(files[0].name, files[0].bytes)}><Icon name="pencil-simple" size={18} />{t('Open in editor')}</button>}
        <button className="btn ghost lg" onClick={onAgain}>{t('Change options')}</button>
      </div>
    </div>
  );
}

function Screen({ p, src, title, options, cta, barTitle, barSub, preview, out, zipName, onAgain, after }: {
  p: TP; src: Src; title: string; options: React.ReactNode; cta: React.ReactNode; barTitle: string; barSub: string;
  preview?: React.ReactNode; out: { files: Out[]; summary: React.ReactNode } | null; zipName: string; onAgain: () => void;
  /** shown under the result */
  after?: React.ReactNode;
}) {
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="xt">
          <FileCard src={src} />
          {out ? <><Result p={p} files={out.files} summary={out.summary} zipName={zipName} onAgain={onAgain} />{after}</> : (
            <>
              {preview}
              {!p.desk && <div className="xt-opts"><h3>{title}</h3>{options}</div>}
            </>
          )}
          {src.fromEditor && p.current?.changed && !out && <div className="note"><Icon name="info" size={16} /><span>{t('Uses the open document as it was opened; download from the editor first to include your edits.')}</span></div>}
        </div>
      </div>
      {!out && <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{title}</h3>{options}</Side>}
      {!out && <Bar desk={p.desk} cta={cta} bar={{ title: barTitle, sub: barSub }} />}
    </div>
  );
}

/** page size (points, as shown) of the first page, for previews */
function usePageSize(src: Src | null) {
  const [s, setS] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    src.pdf.getPage((src.pages[0]?.src ?? 0) + 1).then((pg: any) => {
      const v = pg.getViewport({ scale: 1, rotation: (pg.rotate + (src.pages[0]?.rotation ?? 0)) % 360 });
      if (alive) setS({ w: v.width, h: v.height });
    }).catch(() => null);
    return () => { alive = false; };
  }, [src]);
  return s;
}

/** the first pages with something drawn over them (page numbers, watermark) */
function Preview({ src, count = 2, overlay }: { src: Src; count?: number; overlay: (i: number, k: number) => React.ReactNode }) {
  const size = usePageSize(src);
  return (
    <div className="xt-prev" aria-hidden>
      {src.pages.slice(0, count).map((pg, i) => (
        <div className="xt-pg" key={i} style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}>
          <Thumb pdf={src.pdf} src={pg.src} rotation={pg.rotation} size={260} />
          {size && <div className="xt-ov" ref={(el) => { if (el) el.style.setProperty('--k', String(el.clientWidth / size.w)); }}>{overlay(i, 1)}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------------- compress ----------------

export function Compress(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [level, setLevel] = useState<'light' | 'balanced' | 'strong' | 'max'>('balanced');
  const [limit, setLimit] = useState<number | null>(null);
  const { out, setOut, run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to make smaller')} />;
  const go = () => run(t('Making it smaller'), t('Pictures and scans are re-saved; text stays sharp. Nothing is uploaded.'), async (prog) => {
    const { compressPdf } = await import('./pdftools');
    const r = await compressPdf(src.bytes, level, limit ? limit * 1024 * 1024 : null, prog);
    const before = src.bytes.length, after = r.bytes.length;
    if (after >= before * 0.98) {
      p.toast({ msg: t('This PDF is already as small as it gets: it has no large pictures.') });
      return null;
    }
    const pct = Math.round((1 - after / before) * 100);
    return {
      files: [{ name: `${baseName(src.name)}-smaller.pdf`, bytes: r.bytes, mime: 'application/pdf' }],
      summary: <><b className="big">{fmtSize(before)} → {fmtSize(after)}</b><span>{t('{p}% smaller', { p: pct })}{limit ? (after <= limit * 1024 * 1024 ? t(' · under {l} MB', { l: limit }) : t(' · couldn’t get under {l} MB without making pictures unreadable', { l: limit })) : ''}</span></>,
    };
  });
  const options = (
    <>
      <div className="field"><span className="label">{t('How much')}</span>
        <Seg value={level} onChange={(v) => { setLevel(v); setLimit(null); }} options={[['light', 'Light'], ['balanced', 'Medium'], ['strong', 'Strong'], ['max', 'Smallest']]} />
        <span className="hint">{level === 'light' ? t('Best quality, good for printing.') : level === 'balanced' ? t('Good for e-mail and screens.') : level === 'strong' ? t('Small, still easy to read.') : t('As small as possible; pictures get rough.')}</span>
      </div>
      <Toggle label={t('Must be smaller than…')} hint={t('For upload portals with a size limit')} checked={limit !== null} onChange={(v) => setLimit(v ? 2 : null)} />
      {limit !== null && (
        <div className="chips">
          {[1, 2, 3, 5, 10, 20].map((mb) => <button key={mb} className={`chip${limit === mb ? ' on' : ''}`} onClick={() => setLimit(mb)}>{mb} MB</button>)}
        </div>
      )}
      <span className="hint">{t('Text and drawings stay sharp: only pictures and scanned pages are made smaller.')}</span>
    </>
  );
  const cta = <button className="btn primary lg block" onClick={go}><Icon name="arrows-in-line-vertical" size={18} />{p.desk ? t('Make smaller') : t('Compress')}</button>;
  return <Screen p={p} src={src} title={t('Compress PDF')} options={options} cta={cta} barTitle={fmtSize(src.bytes.length)} barSub={limit ? t('Target: under {l} MB', { l: limit }) : t('Make this PDF smaller')} out={out} zipName="compressed.zip" onAgain={() => setOut(null)} />;
}

// ---------------- password ----------------

export function Password(p: TP & { initialMode?: 'protect' | 'unlock' }) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; encrypted: boolean; pdf: any | null } | null>(null);
  const [mode, setMode] = useState<'protect' | 'unlock'>(p.initialMode ?? 'protect');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [allow, setAllow] = useState({ print: true, copy: true, edit: false });
  const [err, setErr] = useState<string | null>(null);
  const { out, setOut, run } = useOutput(p);
  const take = async (name: string, bytes: Uint8Array) => {
    setErr(null);
    try {
      const { loadDoc } = await import('./pdfops');
      const d = await loadDoc(bytes);
      const encrypted = d.isEncrypted;
      const pdf = encrypted ? null : await openPdf(bytes).catch(() => null);
      setFile({ name, bytes, encrypted, pdf });
      setMode(encrypted ? 'unlock' : 'protect');
    } catch { setErr(t('That file couldn’t be opened as a PDF.')); }
  };
  useEffect(() => { if (p.current) take(p.current.name, p.current.bytes); }, []); // eslint-disable-line
  if (!file) return <PickPdf onFile={async (f) => take(f.name, new Uint8Array(await f.arrayBuffer()))} err={err} title={t('Choose a PDF to protect or unlock')} />;
  const src: Src = { name: file.name, bytes: file.bytes, pdf: file.pdf, pages: file.pdf ? Array.from({ length: file.pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })) : [], fromEditor: false };
  const protect = mode === 'protect';
  const ok = protect ? pw.length >= 4 && pw === pw2 : pw.length > 0;
  const go = () => run(protect ? t('Adding a password') : t('Removing the password'), t('On this device. The password is not stored anywhere.'), async () => {
    const { protectPdf, unlockPdf } = await import('./pdftools');
    if (protect) {
      const bytes = await protectPdf(file.bytes, pw, allow);
      return { files: [{ name: `${baseName(file.name)}-protected.pdf`, bytes, mime: 'application/pdf' }], summary: <><b>{t('Protected with a password')}</b><span>{t('It asks for the password when opened. Keep it safe: it can’t be recovered.')}</span></> };
    }
    try {
      const bytes = await unlockPdf(file.bytes, pw);
      return { files: [{ name: `${baseName(file.name)}-unlocked.pdf`, bytes, mime: 'application/pdf' }], summary: <><b>{t('Password removed')}</b><span>{t('The new copy opens without a password.')}</span></> };
    } catch (e: any) {
      throw Object.assign(new Error('wrong password'), { userMessage: /password/i.test(String(e?.message)) ? t('That password is not right.') : t('Couldn’t unlock this PDF: {e}', { e: e?.message ?? t('unknown error') }) });
    }
  });
  const pwField = (v: string, set: (s: string) => void, label: string, auto: string) => (
    <label className="xt-in"><span className="label">{label}</span>
      <span className="xt-pw"><input type={show ? 'text' : 'password'} value={v} onChange={(e) => set(e.target.value)} autoComplete={auto} spellCheck={false} />
        <button type="button" className="ibtn" onClick={() => setShow((s) => !s)} aria-label={show ? t('Hide password') : t('Show password')}><Icon name={show ? 'eye-slash' : 'eye'} size={18} /></button></span>
    </label>
  );
  const options = (
    <>
      <Seg value={mode} onChange={(m) => { setMode(m); setPw(''); setPw2(''); }} options={[['protect', <><Icon name="lock-key" size={16} />{t('Add')}</>], ['unlock', <><Icon name="lock-key-open" size={16} />{t('Remove')}</>]]} />
      {protect && file.encrypted && <div className="note warn"><Icon name="info" size={16} /><span>{t('This PDF already has a password. Remove it first, then add a new one.')}</span></div>}
      {!protect && !file.encrypted && <div className="note"><Icon name="info" size={16} /><span>{t('This PDF has no password to remove.')}</span></div>}
      {(protect ? !file.encrypted : file.encrypted) && (
        <>
          {pwField(pw, setPw, protect ? t('New password') : t('Password'), protect ? 'new-password' : 'current-password')}
          {protect && pwField(pw2, setPw2, t('Repeat the password'), 'new-password')}
          {protect && pw2 && pw !== pw2 && <span className="hint" style={{ color: 'var(--danger)' }}>{t('The passwords are different.')}</span>}
          {protect && pw && pw.length < 4 && <span className="hint">{t('At least 4 characters.')}</span>}
          {protect && (
            <div className="field"><span className="label">{t('Once opened, people may')}</span>
              <Toggle label={t('Print')} checked={allow.print} onChange={(v) => setAllow((a) => ({ ...a, print: v }))} />
              <Toggle label={t('Copy text')} checked={allow.copy} onChange={(v) => setAllow((a) => ({ ...a, copy: v }))} />
              <Toggle label={t('Make changes')} checked={allow.edit} onChange={(v) => setAllow((a) => ({ ...a, edit: v }))} />
            </div>
          )}
        </>
      )}
    </>
  );
  const usable = protect ? !file.encrypted : file.encrypted;
  const cta = <button className="btn primary lg block" disabled={!ok || !usable} onClick={go}><Icon name={protect ? 'lock-key' : 'lock-key-open'} size={18} />{protect ? t('Add password') : t('Remove password')}</button>;
  if (!file.pdf) {
    // a locked file can't be shown until it is unlocked
    return (
      <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
        <div className="tmain"><div className="xt">
          <div className="xt-file"><div className="xt-th lockd"><Icon name="lock-key:duotone" size={34} /></div><div className="xt-fn"><b>{file.name}</b><span>{t('Password-protected')} · {fmtSize(file.bytes.length)}</span></div></div>
          {out ? <Result p={p} files={out.files} summary={out.summary} zipName="unlocked.zip" onAgain={() => setOut(null)} /> : !p.desk && <div className="xt-opts"><h3>{t('Password')}</h3>{options}</div>}
        </div></div>
        {!out && <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{t('Password')}</h3>{options}</Side>}
        {!out && <Bar desk={p.desk} cta={cta} bar={{ title: t('Remove the password'), sub: t('Type the password to unlock') }} />}
      </div>
    );
  }
  return <Screen p={p} src={src} title={t('Password')} options={options} cta={cta} barTitle={protect ? t('Add a password') : t('Remove the password')} barSub={protect ? t('It will ask for it when opened') : t('Type the password to unlock')} out={out} zipName="protected.zip" onAgain={() => setOut(null)} />;
}

// ---------------- page numbers ----------------

const POS: { v: import('./pdftools').NumPos; label: string }[] = [
  { v: 'tl', label: 'Top left' }, { v: 'tc', label: 'Top centre' }, { v: 'tr', label: 'Top right' },
  { v: 'bl', label: 'Bottom left' }, { v: 'bc', label: 'Bottom centre' }, { v: 'br', label: 'Bottom right' },
];
const FORMATS: [import('./pdftools').NumFormat, string][] = [['n', '1'], ['page-n', 'Page 1'], ['n-of', '1 / 9'], ['seite', 'Seite 1 von 9'], ['dash', '– 1 –']];

export function PageNumbers(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [pos, setPos] = useState<import('./pdftools').NumPos>('bc');
  const [format, setFormat] = useState<import('./pdftools').NumFormat>('n');
  const [start, setStart] = useState(1);
  const [from, setFrom] = useState(1);
  const [size, setSize] = useState(10);
  const { out, setOut, run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to number')} />;
  const n = src.pages.length;
  const label = (i: number) => {
    const k = start + (i - (from - 1));
    const total = start + (n - from);
    return i < from - 1 ? '' : format === 'n' ? `${k}` : format === 'page-n' ? `Page ${k}` : format === 'n-of' ? `${k} / ${total}` : format === 'seite' ? `Seite ${k} von ${total}` : `– ${k} –`;
  };
  const go = () => run(t('Adding page numbers'), tn(n, '{n} page', '{n} pages'), async () => {
    const { addPageNumbers } = await import('./pdftools');
    const bytes = await addPageNumbers(await pdfBytesOf(src), { pos, format, start, from, size, margin: 24 });
    return { files: [{ name: `${baseName(src.name)}-numbered.pdf`, bytes, mime: 'application/pdf' }], summary: <><b>{t('Page numbers added')}</b><span>{t('{k} pages numbered {a}–{b}', { k: n - from + 1, a: start, b: start + n - from })}</span></> };
  });
  const options = (
    <>
      <div className="field"><span className="label">{t('Where')}</span>
        <div className="posgrid" role="radiogroup" aria-label={t('Position')}>
          {POS.map((o) => <button key={o.v} role="radio" aria-checked={pos === o.v} aria-label={t(o.label)} title={t(o.label)} className={pos === o.v ? 'on' : ''} onClick={() => setPos(o.v)}><i /></button>)}
        </div>
      </div>
      <div className="field"><span className="label">{t('Style')}</span>
        <div className="chips">{FORMATS.map(([v, l]) => <button key={v} className={`chip${format === v ? ' on' : ''}`} onClick={() => setFormat(v)}>{l}</button>)}</div>
      </div>
      <div className="xt-row"><span>{t('First number')}</span><div style={{ width: 132 }}><Stepper value={start} min={0} max={9999} onChange={setStart} label="first number" /></div></div>
      <div className="xt-row"><span>{t('Start on page')}</span><div style={{ width: 132 }}><Stepper value={from} min={1} max={n} onChange={setFrom} label={t('start page')} /></div></div>
      <div className="xt-row"><span>{t('Size')}</span><div style={{ width: 132 }}><Stepper value={size} min={6} max={28} onChange={setSize} label="size" unit="pt" /></div></div>
    </>
  );
  const cta = <button className="btn primary lg block" onClick={go}><Icon name="list-numbers" size={18} />{t('Add page numbers')}</button>;
  const preview = (
    <Preview src={src} count={Math.min(3, n)} overlay={(i) => (
      <span className="xt-num" style={{
        fontSize: `calc(var(--k) * ${size}px)`,
        [pos[0] === 't' ? 'top' : 'bottom']: `calc(var(--k) * ${24 - (pos[0] === 't' ? 0 : size * 0.2)}px)`,
        ...(pos[1] === 'l' ? { left: 'calc(var(--k) * 24px)' } : pos[1] === 'r' ? { right: 'calc(var(--k) * 24px)' } : { left: 0, right: 0, textAlign: 'center' }),
      } as React.CSSProperties}>{label(i)}</span>
    )} />
  );
  return <Screen p={p} src={src} title={t('Page numbers')} options={options} cta={cta} preview={preview} barTitle={FORMATS.find((f) => f[0] === format)![1]} barSub={t(POS.find((o) => o.v === pos)!.label)} out={out} zipName="numbered.zip" onAgain={() => setOut(null)} />;
}

/** the source as one PDF in its current page order and rotation (the open document's pages) */
async function pdfBytesOf(src: Src): Promise<Uint8Array> {
  const same = src.pages.every((pg, i) => pg.src === i && !pg.rotation) && src.pages.length === src.pdf?.numPages;
  if (same) return src.bytes;
  const { pickPages, save } = await import('./pdfops');
  return save(await pickPages(src.bytes, src.pages));
}

// ---------------- watermark ----------------

const COLORS: [string, [number, number, number]][] = [['#6B7280', [0.42, 0.45, 0.5]], ['#D63A3A', [0.84, 0.23, 0.23]], ['#2F49D1', [0.18, 0.29, 0.82]], ['#111111', [0.07, 0.07, 0.07]]];

export function Watermark(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [text, setText] = useState(getLang() === 'de' ? 'VERTRAULICH' : 'CONFIDENTIAL');
  const [size, setSize] = useState(56);
  const [opacity, setOpacity] = useState(0.22);
  const [angle, setAngle] = useState<'45' | '0'>('45');
  const [tile, setTile] = useState(false);
  const [color, setColor] = useState(0);
  const [pages, setPages] = useState<'all' | 'first'>('all');
  const { out, setOut, run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to watermark')} />;
  const go = () => run(t('Adding the watermark'), tn(src.pages.length, '{n} page', '{n} pages'), async () => {
    const { addWatermark } = await import('./pdftools');
    const bytes = await addWatermark(await pdfBytesOf(src), { text: text.trim() || (getLang() === 'de' ? 'VERTRAULICH' : 'CONFIDENTIAL'), size, opacity, color: COLORS[color][1], angle: +angle, tile, pages });
    return { files: [{ name: `${baseName(src.name)}-watermarked.pdf`, bytes, mime: 'application/pdf' }], summary: <><b>{t('Watermark added')}</b><span>{pages === 'all' ? t('“{w}” on all {n} pages', { w: text.trim(), n: src.pages.length }) : t('“{w}” on the first page', { w: text.trim() })}</span></> };
  });
  const options = (
    <>
      <label className="xt-in"><span className="label">{t('Text')}</span><input value={text} onChange={(e) => setText(e.target.value)} maxLength={80} placeholder="CONFIDENTIAL" /></label>
      <div className="chips">{(getLang() === 'de' ? ['VERTRAULICH', 'KOPIE', 'ENTWURF', 'BEZAHLT', 'MUSTER', 'COPY'] : ['CONFIDENTIAL', 'COPY', 'DRAFT', 'KOPIE', 'ENTWURF', 'PAID']).map((t) => <button key={t} className={`chip${text === t ? ' on' : ''}`} onClick={() => setText(t)}>{t}</button>)}</div>
      <div className="field"><span className="label">{t('Direction')}</span><Seg value={angle} onChange={setAngle} options={[['45', 'Diagonal'], ['0', 'Straight']]} /></div>
      <Toggle label={t('Repeat across the page')} checked={tile} onChange={(v) => { setTile(v); if (v && size > 36) setSize(32); if (!v && size === 32) setSize(56); }} />
      <div className="xt-row"><span>{t('Size')}</span><div style={{ width: 132 }}><Stepper value={size} min={12} max={160} step={4} onChange={setSize} label="size" unit="pt" /></div></div>
      <div className="field"><span className="label">{t('See-through')} · {Math.round((1 - opacity) * 100)}%</span>
        <input type="range" min={0.08} max={0.8} step={0.02} value={opacity} onChange={(e) => setOpacity(+e.target.value)} aria-label={t('Opacity')} /></div>
      <div className="field"><span className="label">{t('Colour')}</span>
        <div className="swatches" style={{ gap: 18, paddingLeft: 6 }}>{COLORS.map(([hex], i) => <button key={hex} className={`swatch${color === i ? ' on' : ''}`} aria-label={t('Colour {n}', { n: i + 1 })} onClick={() => setColor(i)}><i style={{ background: hex }} /></button>)}</div></div>
      <div className="field"><span className="label">{t('Pages')}</span><Seg value={pages} onChange={setPages} options={[['all', 'All pages'], ['first', 'First page']]} /></div>
    </>
  );
  const cta = <button className="btn primary lg block" disabled={!text.trim()} onClick={go}><Icon name="stamp" size={18} />{t('Add watermark')}</button>;
  const preview = (
    <Preview src={src} count={Math.min(2, src.pages.length)} overlay={(i) => (pages === 'first' && i > 0 ? null : (
      <div className={`xt-wm${tile ? ' tile' : ''}`} style={{ color: COLORS[color][0], opacity }}>
        {(tile ? Array.from({ length: 14 }) : [0]).map((_, k) => (
          <span key={k} style={{ fontSize: `calc(var(--k) * ${size}px)`, transform: `rotate(${-angle}deg)` }}>{text}</span>
        ))}
      </div>
    ))} />
  );
  return <Screen p={p} src={src} title={t('Watermark')} options={options} cta={cta} preview={preview} barTitle={`“${text}”`} barSub={tile ? t('Repeated') : angle === '45' ? t('Diagonal, centred') : t('Straight, centred')} out={out} zipName="watermarked.zip" onAgain={() => setOut(null)} />;
}

// ---------------- split ----------------

export function Split(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [mode, setMode] = useState<'every' | 'ranges' | 'each'>('every');
  const [n, setN] = useState(2);
  const [ranges, setRanges] = useState('');
  const { out, setOut, run } = useOutput(p);
  const groups = useMemo(() => {
    if (!src) return [];
    const count = src.pages.length;
    if (mode === 'each') return src.pages.map((_, i) => [i]);
    if (mode === 'every') return Array.from({ length: Math.ceil(count / n) }, (_, k) => Array.from({ length: Math.min(n, count - k * n) }, (_, j) => k * n + j));
    return ranges.split(/[;,]/).map((part) => parseRange(part, count)).filter((g) => g.length);
  }, [src, mode, n, ranges]);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to split')} />;
  const go = () => run(t('Splitting'), tn(groups.length, '{n} file', '{n} files'), async (prog) => {
    const { splitPdf } = await import('./pdftools');
    const bytes = await pdfBytesOf(src);
    prog(0.3);
    const parts = await splitPdf(bytes, groups);
    const files = parts.map((b, k) => ({ name: `${baseName(src.name)}-${formatRange(groups[k]).replace(/[–,\s]+/g, (m) => (m.includes('–') ? '-' : '_'))}.pdf`, bytes: b, mime: 'application/pdf' }));
    return { files, summary: <><b>{t('Split into {n} PDFs', { n: files.length })}</b><span>{t('The original stays unchanged.')}</span></> };
  });
  const options = (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className={`opt radio-opt${mode === 'every' ? ' on' : ''}`} onClick={() => setMode('every')}><span className="rd" /><span className="ot"><b>{t('Every few pages')}</b><span>{t('Equal parts')}</span></span></button>
        <button className={`opt radio-opt${mode === 'ranges' ? ' on' : ''}`} onClick={() => setMode('ranges')}><span className="rd" /><span className="ot"><b>{t('By page ranges')}</b><span>{t('One file per range')}</span></span></button>
        <button className={`opt radio-opt${mode === 'each' ? ' on' : ''}`} onClick={() => setMode('each')}><span className="rd" /><span className="ot"><b>{t('Every page')}</b><span>{t('One file per page')}</span></span></button>
      </div>
      {mode === 'every' && <div className="xt-row"><span>{t('Pages per file')}</span><div style={{ width: 132 }}><Stepper value={n} min={1} max={Math.max(1, src.pages.length)} onChange={setN} label={t('pages per file')} /></div></div>}
      {mode === 'ranges' && (
        <label className="xt-in"><span className="label">{t('Ranges, separated by commas')}</span>
          <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder={`e.g. 1-3, 4-${Math.max(4, src.pages.length)}`} inputMode="text" /></label>
      )}
      <span className="hint">{groups.length ? tn(groups.length, '{n} file', '{n} files') + ': ' + groups.slice(0, 4).map((g) => formatRange(g)).join(' · ') + (groups.length > 4 ? ' …' : '') : t('Type the page ranges, like 1-3, 4-6.')}</span>
    </>
  );
  const cta = <button className="btn primary lg block" disabled={!groups.length} onClick={go}><Icon name="scissors" size={18} />{groups.length ? tn(groups.length, 'Split into {n} file', 'Split into {n} files') : t('Split')}</button>;
  const preview = (
    <div className="xt-groups">
      {groups.slice(0, 8).map((g, k) => (
        <div className="xt-grp" key={k}>
          <div className="xt-gth">{g.slice(0, 3).map((i) => <span key={i}><Thumb pdf={src.pdf} src={src.pages[i].src} rotation={src.pages[i].rotation} size={110} /></span>)}</div>
          <span>{g.length === 1 ? t('File {k} · page {p}', { k: k + 1, p: g[0] + 1 }) : t('File {k} · pages {r}', { k: k + 1, r: formatRange(g) })}</span>
        </div>
      ))}
      {groups.length > 8 && <div className="xt-more">{t('+{n} more', { n: groups.length - 8 })}</div>}
    </div>
  );
  return <Screen p={p} src={src} title={t('Split PDF')} options={options} cta={cta} preview={preview} barTitle={tn(groups.length, '{n} file', '{n} files')} barSub={mode === 'every' ? t('{n} pages each', { n }) : mode === 'each' ? t('One per page') : t('By ranges')} out={out} zipName={`${baseName(src.name)}-split.zip`} onAgain={() => setOut(null)} />;
}

// ---------------- pages as pictures ----------------

export function ToImages(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [fmt, setFmt] = useState<'jpg' | 'png'>('jpg');
  const [dpi, setDpi] = useState<'100' | '150' | '300'>('150');
  const [range, setRange] = useState('');
  const { out, setOut, run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to turn into pictures')} />;
  const chosen = range.trim() ? parseRange(range, src.pages.length) : src.pages.map((_, i) => i);
  const go = () => run(t('Making pictures'), tn(chosen.length, '{n} page at {d} dpi', '{n} pages at {d} dpi', { d: dpi }), async (prog) => {
    const files: Out[] = [];
    for (let k = 0; k < chosen.length; k++) {
      const pg = src.pages[chosen[k]];
      const page = await src.pdf.getPage(pg.src + 1);
      const vp = page.getViewport({ scale: +dpi / 72, rotation: (page.rotate + pg.rotation) % 360 });
      const lim = Math.min(1, 6000 / Math.max(vp.width, vp.height));
      const v2 = lim < 1 ? page.getViewport({ scale: (+dpi / 72) * lim, rotation: (page.rotate + pg.rotation) % 360 }) : vp;
      const c = document.createElement('canvas');
      c.width = Math.round(v2.width); c.height = Math.round(v2.height);
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: v2 }).promise;
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.9));
      c.width = c.height = 0;
      files.push({ name: `${baseName(src.name)}-${String(chosen[k] + 1).padStart(String(src.pages.length).length, '0')}.${fmt}`, bytes: new Uint8Array(await blob.arrayBuffer()), mime: fmt === 'jpg' ? 'image/jpeg' : 'image/png' });
      prog((k + 1) / chosen.length);
    }
    return { files, summary: <><b>{tn(files.length, '{n} picture', '{n} pictures')}</b><span>{fmt.toUpperCase()} · {dpi} dpi · {fmtSize(files.reduce((s, f) => s + f.bytes.length, 0))}</span></> };
  });
  const options = (
    <>
      <div className="field"><span className="label">{t('Format')}</span><Seg value={fmt} onChange={setFmt} options={[['jpg', 'JPG'], ['png', 'PNG']]} /><span className="hint">{fmt === 'jpg' ? t('Smaller files; best for photos and scans.') : t('Sharp edges; best for text and drawings.')}</span></div>
      <div className="field"><span className="label">{t('Quality')}</span><Seg value={dpi} onChange={setDpi} options={[['100', 'Screen'], ['150', 'Good'], ['300', 'Print']]} /></div>
      <label className="xt-in"><span className="label">{t('Pages')}</span><input value={range} onChange={(e) => setRange(e.target.value)} placeholder={t('All {n} pages (or e.g. 1-3, 5)', { n: src.pages.length })} /></label>
    </>
  );
  const cta = <button className="btn primary lg block" disabled={!chosen.length} onClick={go}><Icon name="images" size={18} />{tn(chosen.length, 'Make {n} picture', 'Make {n} pictures')}</button>;
  return <Screen p={p} src={src} title={t('PDF to pictures')} options={options} cta={cta} barTitle={tn(chosen.length, '{n} page', '{n} pages')} barSub={`${fmt.toUpperCase()} · ${dpi} dpi`} out={out} zipName={`${baseName(src.name)}-pictures.zip`} onAgain={() => setOut(null)} />;
}

// ---------------- text out ----------------

/** the text of a page in reading order, line by line */
export function pageText(items: any[]): string {
  let out = '', lastY: number | null = null, lastEnd = 0;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || 10;
    if (lastY !== null && Math.abs(y - lastY) > h * 0.5) out += '\n';
    else if (lastY !== null && x - lastEnd > h * 0.25 && !out.endsWith(' ') && it.str && !it.str.startsWith(' ')) out += ' ';
    out += it.str;
    if (it.hasEOL) { out += '\n'; lastY = null; continue; }
    lastY = y; lastEnd = x + (it.width ?? 0);
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** the text of every page; scanned pages are read on the device when `ocr` */
async function readPages(src: Src, ocr: boolean, prog: (f: number) => void): Promise<{ pages: string[]; scanned: number }> {
  const pages: string[] = [];
  let scanned = 0, worker: any = null;
  for (let k = 0; k < src.pages.length; k++) {
    const page = await src.pdf.getPage(src.pages[k].src + 1);
    let t = pageText((await page.getTextContent()).items);
    // only pages with (almost) no text of their own are read as pictures: short real text beats OCR
    if (t.replace(/\s/g, '').length < 4 && ocr) {
      if (!worker) worker = await (await import('./ocr')).loadOcr();
      const vp = page.getViewport({ scale: 2.4 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      t = ((await worker.recognize(c)).data.text ?? '').trim();
      c.width = c.height = 0;
      scanned++;
    }
    pages.push(t);
    prog((k + 1) / src.pages.length);
  }
  return { pages, scanned };
}

export function ExtractText(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [ocr, setOcr] = useState(true);
  const [text, setText] = useState<string | null>(null);
  const { out, setOut, run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a PDF to take the text from')} />;
  const go = () => run(t('Reading the text'), ocr ? t('Scanned pages are read on this device; this can take a moment.') : tn(src.pages.length, '{n} page', '{n} pages'), async (prog) => {
    const { pages, scanned: read } = await readPages(src, ocr, prog);
    const all = pages.map((t, k) => (pages.length > 1 ? `— Page ${k + 1} —\n${t}` : t)).join('\n\n');
    setText(all);
    const bytes = new TextEncoder().encode(all);
    const words = all.split(/\s+/).filter(Boolean).length;
    return { files: [{ name: `${baseName(src.name)}.txt`, bytes, mime: 'text/plain' }], summary: <><b>{t('{n} words', { n: words.toLocaleString(locale()) })}</b><span>{read ? tn(read, '{n} scanned page read on this device', '{n} scanned pages read on this device') : t('From the text in the PDF')}</span></> };
  });
  const options = (
    <>
      <Toggle label={t('Read scanned pages too')} hint={t('Recognises text in pictures (German and English)')} checked={ocr} onChange={setOcr} />
      <span className="hint">{t('You get a .txt file, and can copy the text.')}</span>
    </>
  );
  const cta = <button className="btn primary lg block" onClick={go}><Icon name="article" size={18} />{t('Get the text')}</button>;
  const after = text !== null && (
    <div className="xt-text">
      <div className="xt-th2"><b>{t('Text')}</b><button className="btn outline" onClick={() => { navigator.clipboard?.writeText(text).then(() => p.toast({ msg: t('Copied') }), () => p.toast({ msg: t('Couldn’t copy'), kind: 'err' })); }}><Icon name="copy-simple" size={16} />{t('Copy all')}</button></div>
      <textarea readOnly value={text} aria-label={t('Text from the PDF')} />
    </div>
  );
  return <Screen p={p} src={src} title={t('Extract text')} options={options} cta={cta} barTitle={t('Text from this PDF')} barSub={ocr ? t('Scans included') : t('Text only')} out={out} zipName="text.zip" onAgain={() => { setOut(null); setText(null); }} after={after} />;
}

// ---------------- deadline finder ----------------

const KIND_NAME = { deadline: 'Deadline', appointment: 'Appointment', date: 'Date' } as const;

export function Deadlines(p: TP) {
  const { src, load, err } = useSource(p.current);
  const [found, setFound] = useState<(import('./deadlines').Found & { on: boolean; title: string })[] | null>(null);
  const [remind, setRemind] = useState(3);
  const [scanned, setScanned] = useState(0);
  const { run } = useOutput(p);
  if (!src) return <PickPdf onFile={load} err={err} title={t('Choose a letter to find its deadlines')} />;
  const doc = baseName(src.name);
  const go = () => run(t('Looking for deadlines'), t('Reading the letter on this device (scans too).'), async (prog) => {
    const { findDates } = await import('./deadlines');
    const { pages, scanned } = await readPages(src, true, prog);
    const list = findDates(pages);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    setScanned(scanned);
    setFound(list.map((f) => ({ ...f, on: f.kind !== 'date' && f.date >= today, title: `${f.kind === 'appointment' ? t('Appointment') : f.kind === 'deadline' ? t('Deadline') : t('Date')}: ${doc}` })));
    return null;
  });
  const days = (d: Date) => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const n = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - now.getTime()) / 86400000);
    return n === 0 ? t('today') : n === 1 ? t('tomorrow') : n > 0 ? t('in {n} days', { n }) : n === -1 ? t('yesterday') : t('{n} days ago', { n: -n });
  };
  const chosen = (found ?? []).filter((f) => f.on);
  const ics = async () => {
    const { toIcs } = await import('./deadlines');
    const text = toIcs(chosen.map((f) => ({ title: f.title, date: f.date, time: f.time, note: `${f.snippet}\n\n${src.name}, page ${f.page + 1}${f.from ? `\n(${f.from})` : ''}`, remindDays: remind })));
    await saveFile(p.host, new TextEncoder().encode(text), `${doc}-dates.ics`, 'text/calendar', p.toast);
  };
  const toCal = async (f: { title: string; date: Date; time: string | null; snippet: string; page: number }) => {
    const ok = await p.host.addToCalendar?.({ title: f.title, begin: f.date.getTime(), allDay: !f.time, note: `${f.snippet}\n\n${src.name}, page ${f.page + 1}` }).catch(() => false);
    if (!ok) p.toast({ msg: t('No calendar app found. Save the calendar file instead.'), kind: 'err' });
  };
  const options = (
    <>
      <span className="hint">{t('Finds deadlines (“bis 15.11.”, “innerhalb von 14 Tagen”), appointments and other future dates in a letter, and puts them in your calendar with a reminder.')}</span>
      {found && <div className="xt-row"><span>{t('Remind me before')}</span><div style={{ width: 132 }}><Stepper value={remind} min={0} max={14} onChange={setRemind} label="days before" unit="d" /></div></div>}
    </>
  );
  const cta = found
    ? <button className="btn primary lg block" disabled={!chosen.length} onClick={ics}><Icon name="calendar-plus" size={18} />{p.host.addToCalendar ? t('Save calendar file') : t('Add {n} to calendar (.ics)', { n: chosen.length })}</button>
    : <button className="btn primary lg block" onClick={go}><Icon name="calendar-plus" size={18} />{t('Find dates')}</button>;
  const list = found && (
    <div className="dl-list">
      {!found.length && <div className="note"><Icon name="info" size={16} /><span>{t('No deadlines or future dates found. Dates written like “15.11.2026”, “15. November 2026” or “innerhalb von 14 Tagen” are found.')}</span></div>}
      {found.map((f, i) => (
        <div key={i} className={`dl-it ${f.kind}${f.on ? ' on' : ''}`}>
          <label className="dl-top">
            <input type="checkbox" checked={f.on} onChange={(e) => setFound((l) => l!.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
            <span className="dl-date"><b>{f.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}{f.time ? `, ${f.time}` : ''}</b><span>{KIND_NAME[f.kind]} · {days(f.date)}</span></span>
          </label>
          <p className="dl-snip">{f.snippet}</p>
          {f.from && <p className="dl-from">{t('Worked out: {f}. Check the letter: such periods often count from the day you received it.', { f: f.from })}</p>}
          <div className="dl-row">
            <input value={f.title} onChange={(e) => setFound((l) => l!.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} aria-label={t('Calendar title')} />
            {p.host.addToCalendar && <button className="btn outline" onClick={() => toCal(f)}><Icon name="calendar-plus" size={16} />{t('Add')}</button>}
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="xt">
          <FileCard src={src} />
          {!p.desk && <div className="xt-opts"><h3>{t('Deadline finder')}</h3>{options}</div>}
          {list}
        </div>
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{t('Deadline finder')}</h3>{options}</Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: found ? t('{n} selected', { n: chosen.length }) : t('Deadlines and appointments'), sub: found ? t('{n} found', { n: found.length }) : t('Into your calendar') }} />
    </div>
  );
}

// ---------------- safe ID copy ----------------

const PURPOSES: [string, string][] = [['Wohnungsbewerbung', 'flat application'], ['Bank', 'bank'], ['Arbeitgeber', 'employer'], ['Behörde', 'authority'], ['Versicherung', 'insurance'], ['Hotel', 'hotel']];

/** draws "COPY – only for … – date" across a page so it can't be cut away or reused */
function burnNote(c: HTMLCanvasElement, text: string) {
  const x = c.getContext('2d')!;
  const W = c.width, H = c.height, fs = Math.round(Math.max(W, H) / 34);
  x.save();
  x.translate(W / 2, H / 2);
  x.rotate(-Math.atan2(H, W) * 0.75);
  x.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
  x.textBaseline = 'middle';
  const unit = text + '   ·   ';
  const tw = x.measureText(unit).width;
  const R = Math.hypot(W, H) / 2 + fs * 2;
  let row = 0;
  for (let y = -R; y < R; y += fs * 3.1, row++) {
    x.fillStyle = 'rgba(190, 20, 30, 0.30)';
    for (let xx = -R - (row % 2) * tw * 0.5; xx < R; xx += tw) x.fillText(unit, xx, y);
    // a thin line through each row: covers the text under it so a copy can't be cleaned up
    x.fillStyle = 'rgba(190, 20, 30, 0.14)';
    x.fillRect(-R, y + fs * 1.55 - 1, 2 * R, 2);
  }
  x.restore();
}

export function SafeCopy(p: TP) {
  const [items, setItems] = useState<{ name: string; draw: (max: number) => Promise<{ canvas: HTMLCanvasElement; wPt: number; hPt: number }> }[] | null>(null);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [to, setTo] = useState('');
  const [lang, setLang] = useState<'de' | 'en'>('de');
  const [preview, setPreview] = useState<string | null>(null);
  const { out, setOut, run } = useOutput(p);
  const date = new Date().toLocaleDateString(lang === 'de' ? 'de-AT' : 'en-GB');
  const note = lang === 'de'
    ? `KOPIE – nur für ${purpose.trim() || '…'}${to.trim() ? ` an ${to.trim()}` : ''} – ${date}`
    : `COPY – only for ${(PURPOSES.find((x) => x[0] === purpose)?.[1] ?? purpose.trim()) || '…'}${to.trim() ? ` to ${to.trim()}` : ''} – ${date}`;
  const [err, setErr] = useState<string | null>(null);
  const pick = async (files: File[]) => {
    setErr(null);
    try { await pickFiles(files); } catch { setErr(t('That file couldn’t be opened. Choose a PDF or a photo.')); }
  };
  const pickFiles = async (files: File[]) => {
    const list: NonNullable<typeof items> = [];
    for (const f of files) {
      if (isPdf(f)) {
        const pdf = await openPdf(new Uint8Array(await f.arrayBuffer()));
        for (let i = 1; i <= pdf.numPages; i++) list.push({ name: f.name, draw: async (max) => {
          const page = await pdf.getPage(i);
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: max / Math.max(v1.width, v1.height) });
          const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const x = c.getContext('2d')!; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: x, viewport: vp }).promise;
          return { canvas: c, wPt: v1.width, hPt: v1.height };
        } });
      } else {
        const { imageBytes } = await import('./pdfops');
        const img = await imageBytes(f);
        list.push({ name: f.name, draw: async (max) => {
          const bmp = await createImageBitmap(new Blob([img.bytes as BlobPart], { type: img.png ? 'image/png' : 'image/jpeg' }));
          const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
          c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
          bmp.close();
          // pictures go on a page of their own size (an A4 width)
          return { canvas: c, wPt: 595, hPt: (595 * c.height) / c.width };
        } });
      }
    }
    if (!list.length) return;
    setItems(list); setName(baseName(files[0].name));
  };
  useEffect(() => {
    if (!items?.length) return;
    let alive = true;
    const t = setTimeout(async () => {
      const { canvas } = await items[0].draw(700);
      burnNote(canvas, note);
      if (alive) setPreview(canvas.toDataURL('image/jpeg', 0.8));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [items, note]);
  if (!items) {
    return (
      <div className="tmain">
        <div className="flist" style={{ maxWidth: 560, marginTop: '6vh' }}>
          <DropBox icon="identification-badge:duotone" title={t('Choose an ID, passport or other document')} button={t('Choose files')}
            sub={t('A PDF or photos. The copy gets “COPY – only for …” written across it, burned into the picture.')}
            accept={ACCEPT.pdfOrImage} multiple filter={(f) => isPdf(f) || isImage(f)} onFiles={pick}
            onReject={() => setErr(t('That isn’t a PDF or a picture.'))} err={err} />
        </div>
      </div>
    );
  }
  const go = () => run(t('Making the safe copy'), t('The note is burned into every page. On this device only.'), async (prog) => {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    for (let k = 0; k < items.length; k++) {
      const { canvas, wPt, hPt } = await items[k].draw(2000);
      burnNote(canvas, note);
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.86));
      const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const pg = doc.addPage([wPt, hPt]);
      pg.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
      canvas.width = canvas.height = 0;
      prog((k + 1) / items.length);
    }
    doc.setTitle(note);
    const bytes = await doc.save();
    return { files: [{ name: `${name || 'document'}-copy.pdf`, bytes, mime: 'application/pdf' }], summary: <><b>{t('Safe copy ready')}</b><span>{note}</span></> };
  });
  const options = (
    <>
      <div className="field"><span className="label">{t('Language of the note')}</span><Seg value={lang} onChange={setLang} options={[['de', 'Deutsch'], ['en', 'English']]} /></div>
      <label className="xt-in"><span className="label">{t('Only for (purpose)')}</span><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={lang === 'de' ? 'z. B. Wohnungsbewerbung' : 'e.g. flat application'} maxLength={60} /></label>
      <div className="chips">{PURPOSES.map(([de, en]) => <button key={de} className={`chip${purpose === de || purpose === en ? ' on' : ''}`} onClick={() => setPurpose(lang === 'de' ? de : en)}>{lang === 'de' ? de : en}</button>)}</div>
      <label className="xt-in"><span className="label">{t('To whom (optional)')}</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder={lang === 'de' ? 'z. B. Hausverwaltung Muster' : 'e.g. the landlord'} maxLength={60} /></label>
      <span className="hint">{t('The note and today’s date are written across the whole page and burned into it, so the copy can’t be reused for anything else. The original stays unchanged.')}</span>
    </>
  );
  const cta = <button className="btn primary lg block" disabled={!purpose.trim()} onClick={go}><Icon name="identification-badge" size={18} />{t('Make safe copy')}</button>;
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="xt">
          <div className="xt-file"><div className="xt-th lockd"><Icon name="identification-badge:duotone" size={30} /></div><div className="xt-fn"><b>{name}</b><span>{tn(items.length, '{n} page', '{n} pages')}</span></div></div>
          {out ? <Result p={p} files={out.files} summary={out.summary} zipName="copy.zip" onAgain={() => setOut(null)} /> : (
            <>
              {preview && <div className="sc-prev"><img src={preview} alt={t('Preview of the safe copy')} /></div>}
              {!p.desk && <div className="xt-opts"><h3>{t('Safe ID copy')}</h3>{options}</div>}
            </>
          )}
        </div>
      </div>
      {!out && <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{t('Safe ID copy')}</h3>{options}</Side>}
      {!out && <Bar desk={p.desk} cta={cta} bar={{ title: purpose.trim() ? (lang === 'de' ? `Nur für ${purpose}` : `Only for ${purpose}`) : t('Choose the purpose'), sub: date }} />}
    </div>
  );
}
