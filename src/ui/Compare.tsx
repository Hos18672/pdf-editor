// Compare two versions of a PDF: every word taken out or put in, with the page it is on, and the new
// version saved with the changes marked (green: new text, a red note where text was taken out).
import React, { useState } from 'react';
import { Icon } from './icons';
import { Toggle } from './Panel';
import { saveFile } from './Editor';
import { Side, Bar, type Props, type Src } from './Tools';
import { ACCEPT, DropBox, isPdf } from './drop';
import { baseName } from './pdfops';
import { openPdf } from './pdfjs';
import { Thumb } from './Thumb';
import { t, tn } from './i18n';
import type { Change } from './diff';
import type { PageText } from './search';
// (loaded with this chunk: a separate chunk would pull shared code into the start screen)
import * as L_search from './search';
import * as L_ocr from './ocr';
import * as L_pdf_lib from 'pdf-lib';
import * as L_diff from './diff';

type TP = Props & { desk: boolean; mobile: boolean };
type Read = { text: string[]; pts: (PageText | null)[]; scanned: number };
type Filter = 'all' | 'ins' | 'del' | 'chg';

async function loadSrc(f: File): Promise<Src> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const pdf = await openPdf(bytes);
  return { name: f.name, bytes, pdf, pages: Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rotation: 0 })), fromEditor: false };
}

/** every page's text (scans read on the device when asked), with where its letters are */
async function readDoc(src: Src, ocr: boolean, prog: (f: number) => void): Promise<Read> {
  const { userPageText } = L_search;
  const text: string[] = [], pts: (PageText | null)[] = [];
  let scanned = 0, worker: any = null;
  for (let k = 0; k < src.pages.length; k++) {
    const i = src.pages[k].src;
    const pt = await userPageText(src.pdf, i);
    if (pt.text.replace(/\s/g, '').length < 4 && ocr) {
      const page = await src.pdf.getPage(i + 1);
      if (!worker) worker = await (L_ocr).loadOcr();
      const vp = page.getViewport({ scale: 2.4 });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      text.push((((await worker.recognize(c)).data.text ?? '').replace(/[\u200e\u200f\u202a-\u202e]/g, '')).trim());
      pts.push(null);
      c.width = c.height = 0;
      scanned++;
    } else { text.push(pt.text); pts.push(pt); }
    prog((k + 1) / src.pages.length);
  }
  return { text, pts, scanned };
}

const words = (ws: { w: string }[]) => ws.map((x) => x.w).join(' ');
const kindOf = (c: Change): Exclude<Filter, 'all'> => (c.del.length && c.ins.length ? 'chg' : c.ins.length ? 'ins' : 'del');

/** the new version with the changes marked */
async function markedPdf(b: Src, rb: Read, changes: Change[], removedLabel: string, wasLabel: string): Promise<Uint8Array> {
  const { PDFDocument, rgb, BlendMode, PDFName, PDFArray, PDFHexString } = L_pdf_lib;
  const { userRects } = L_search;
  const doc = await PDFDocument.load(b.bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const c of changes) {
    const pt = rb.pts[c.pageB];
    const page = pages[b.pages[c.pageB]?.src ?? c.pageB];
    if (!pt || !page) continue;
    let anchor: { x: number; y: number; h: number } | null = null;
    for (const w of c.ins) {
      for (const r of userRects(pt, w.s, w.e)) {
        page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(0.36, 0.84, 0.5), opacity: 0.45, blendMode: BlendMode.Multiply });
        anchor ??= { x: r.x, y: r.y + r.h, h: r.h };
      }
    }
    if (!c.del.length) continue;
    // where the text was taken out: a note with it (the word after it, else the one before)
    if (!anchor) {
      const after = rb.pts[c.pageB] ? findAt(pt, c) : null;
      if (after) {
        const r = userRects(pt, after.s, after.e)[0];
        if (r) {
          anchor = { x: r.x - 2, y: r.y + r.h, h: r.h };
          page.drawRectangle({ x: r.x - 2.2, y: r.y, width: 1.4, height: r.h, color: rgb(0.85, 0.19, 0.15) });
        }
      }
    }
    if (!anchor) continue;
    const ctx = doc.context;
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Text', Name: 'Comment', Open: false, F: 4,
      Rect: [anchor.x - 9, anchor.y, anchor.x + 9, anchor.y + 18].map((v) => +v.toFixed(2)),
      Contents: PDFHexString.fromText(`${c.ins.length ? wasLabel : removedLabel}: ${words(c.del)}`), C: [0.85, 0.19, 0.15], T: PDFHexString.fromText('Paginka'),
    });
    const ref = ctx.register(annot);
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(ref); else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  }
  return doc.save();
}
/** the word of the new version right after a removal (from its context) */
function findAt(pt: PageText, c: Change): { s: number; e: number } | null {
  const next = c.after.split(' ')[0], prev = c.before.split(' ').pop();
  const want = next || prev;
  if (!want) return null;
  const re = new RegExp(`(^|\\s)${want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g');
  // the occurrence that follows the words before it
  const tail = c.before.split(' ').slice(-2).join(' ');
  let best: { s: number; e: number } | null = null;
  for (const m of pt.text.matchAll(re)) {
    const s = m.index! + m[1].length;
    const lead = pt.text.slice(Math.max(0, s - tail.length - 4), s).replace(/\s+/g, ' ');
    if (!best || (tail && lead.includes(tail))) best = { s, e: s + want.length };
    if (tail && lead.includes(tail)) break;
  }
  return best;
}

function Pick({ label, sub, src, onFile, onClear, err }: { label: string; sub: string; src: Src | null; onFile: (f: File) => void; onClear: () => void; err: string | null }) {
  if (src) {
    return (
      <div className="cmp-file">
        <span className="cmp-tag">{label}</span>
        <div className="xt-th"><Thumb pdf={src.pdf} src={0} rotation={0} size={70} /></div>
        <div className="xt-fn"><b>{src.name}</b><span>{tn(src.pages.length, '{n} page', '{n} pages')}</span></div>
        <button className="ibtn" onClick={onClear} aria-label={t('Choose another file')}><Icon name="close" size={18} /></button>
      </div>
    );
  }
  return <DropBox icon="file-pdf:duotone" title={label} sub={sub} accept={ACCEPT.pdf} filter={isPdf} onFiles={(f) => onFile(f[0])} button={t('Choose PDF')} err={err} />;
}

export function Compare(p: TP) {
  const [a, setA] = useState<Src | null>(null);
  const [b, setB] = useState<Src | null>(p.current ? { ...p.current, fromEditor: true } : null);
  const [err, setErr] = useState<[string | null, string | null]>([null, null]);
  const [ocr, setOcr] = useState(true);
  const [res, setRes] = useState<{ changes: Change[]; rb: Read; scanned: number } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const load = (which: 0 | 1) => async (f: File) => {
    try { const s = await loadSrc(f); (which ? setB : setA)(s); setErr((e) => (which ? [e[0], null] : [null, e[1]])); setRes(null); }
    catch (e: any) { const m = e?.name === 'PasswordException' ? t('This PDF is password-protected. Open it in the editor first to unlock it.') : t('That file couldn’t be opened as a PDF.'); setErr((x) => (which ? [x[0], m] : [m, x[1]])); }
  };
  const go = async () => {
    if (!a || !b) return;
    const title = t('Comparing the two versions');
    p.setBusy({ title, detail: t('Reading both files on this device.'), progress: 0.02 });
    try {
      const ra = await readDoc(a, ocr, (f) => p.setBusy({ title, progress: f * 0.48 }));
      const rb = await readDoc(b, ocr, (f) => p.setBusy({ title, progress: 0.48 + f * 0.48 }));
      const { compareDocs } = L_diff;
      const changes = compareDocs(ra.text, rb.text);
      p.setBusy(null);
      if (!changes) { p.toast({ msg: t('These files are too different to compare word by word.'), kind: 'err' }); return; }
      setRes({ changes, rb, scanned: ra.scanned + rb.scanned });
      setFilter('all');
    } catch (e: any) {
      p.setBusy(null);
      p.toast({ msg: t('That didn’t work: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' });
    }
  };
  const save = async (open: boolean) => {
    if (!b || !res) return;
    p.setBusy({ title: t('Marking the changes') });
    try {
      const bytes = await markedPdf(b, res.rb, res.changes, t('Removed'), t('Was'));
      p.setBusy(null);
      const name = `${baseName(b.name)}-${t('changes')}.pdf`;
      if (open) p.onOpenInEditor(name, bytes); else await saveFile(p.host, bytes, name, 'application/pdf', p.toast);
    } catch (e: any) { p.setBusy(null); p.toast({ msg: t('That didn’t work: {e}', { e: e?.message ?? t('unknown error') }), kind: 'err' }); }
  };
  const list = res ? res.changes.filter((c) => filter === 'all' || kindOf(c) === filter) : [];
  const count = (k: Exclude<Filter, 'all'>) => res ? res.changes.filter((c) => kindOf(c) === k).length : 0;
  const options = (
    <>
      <Toggle label={t('Read scanned pages too')} hint={t('Recognises text in pictures (German and English)')} checked={ocr} onChange={setOcr} />
      <span className="hint">{t('Finds every word that was added, removed or changed – useful for contracts, offers and letters that came back changed.')}</span>
    </>
  );
  const saveBtn = res && <button className="btn primary lg block" disabled={!res.changes.length} onClick={() => save(false)}><Icon name="download" size={18} />{p.desk ? t('Save with changes marked') : t('Save')}</button>;
  const cta = res
    ? p.desk ? <div className="cmp-ctas">{saveBtn}
        <button className="btn outline lg block" disabled={!res.changes.length} onClick={() => save(true)}><Icon name="pencil-simple" size={18} />{t('Open in editor')}</button></div> : saveBtn
    : <button className="btn primary lg block" disabled={!a || !b} onClick={go}><Icon name="git-diff" size={18} />{t('Compare')}</button>;
  return (
    <div className="tbody" style={{ flexDirection: p.desk ? 'row' : 'column' }}>
      <div className="tmain">
        <div className="xt cmp">
          <div className="cmp-pick">
            <Pick label={t('Original')} sub={t('The earlier version')} src={a} onFile={load(0)} onClear={() => { setA(null); setRes(null); }} err={err[0]} />
            <span className="cmp-vs" aria-hidden="true"><Icon name="arrows-left-right" size={18} /></span>
            <Pick label={t('New version')} sub={t('The version to check')} src={b} onFile={load(1)} onClear={() => { setB(null); setRes(null); }} err={err[1]} />
          </div>
          {!p.desk && !res && <div className="xt-opts"><h3>{t('Compare PDFs')}</h3>{options}</div>}
          {res && (
            <div className="cmp-res">
              <div className={`cmp-sum${res.changes.length ? '' : ' same'}`}>
                <Icon name={res.changes.length ? 'git-diff:duotone' : 'check-circle:fill'} size={26} />
                <div><b>{res.changes.length ? tn(res.changes.length, '{n} change found', '{n} changes found') : t('No differences in the text')}</b>
                  <span>{res.scanned ? tn(res.scanned, '{n} scanned page read on this device', '{n} scanned pages read on this device') : t('Word by word, on this device')}</span></div>
              </div>
              {res.changes.length > 0 && (
                <div className="cmp-chips" role="tablist">
                  {([['all', 'All', res.changes.length], ['chg', 'Changed', count('chg')], ['ins', 'Added', count('ins')], ['del', 'Removed', count('del')]] as [Filter, string, number][]).map(([k, l, n]) => (
                    <button key={k} role="tab" aria-selected={filter === k} className={`${filter === k ? 'on ' : ''}${k}`} onClick={() => setFilter(k)} disabled={!n}>{t(l)}<em>{n}</em></button>
                  ))}
                </div>
              )}
              <div className="cmp-list">
                {list.slice(0, 400).map((c, i) => (
                  <div key={i} className={`cmp-it ${kindOf(c)}`} style={{ ['--i' as any]: Math.min(i, 12) }}>
                    <span className="cmp-pg">{t('p. {n}', { n: c.pageB + 1 })}</span>
                    <p>
                      {c.before && <span className="ctx">…{c.before} </span>}
                      {c.del.length > 0 && <del>{words(c.del)}</del>}{c.del.length > 0 && c.ins.length > 0 && ' '}
                      {c.ins.length > 0 && <ins>{words(c.ins)}</ins>}
                      {c.after && <span className="ctx"> {c.after}…</span>}
                    </p>
                  </div>
                ))}
                {list.length > 400 && <div className="hint">{t('…and {n} more', { n: list.length - 400 })}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
      <Side desk={p.desk} cta={cta} bar={{ title: '', sub: '' }}><h3>{t('Compare PDFs')}</h3>{options}</Side>
      <Bar desk={p.desk} cta={cta} bar={{ title: res ? tn(res.changes.length, '{n} change', '{n} changes') : t('Two versions'), sub: res ? t('Word by word') : a && b ? t('Ready to compare') : t('Choose both files') }} />
    </div>
  );
}
