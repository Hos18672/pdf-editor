import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { gesture } from './gesture';
import { css } from './styles';
import { Icon } from './icons';
import { openPdf, loadPdfjs } from './pdfjs';
import { useHistory, uid, Tool, ToolStyle, RunEdit } from './store';
import { PageView, PageInfo, PageData } from './PageView';
import { SignatureModal, Stamp } from './SignatureModal';
import { PagesModal } from './PagesModal';
import { RunPanel, ObjectPanel, ToolPanel } from './Panel';
import { exportPdf } from '../engine/exporter';
import type { EditorObject, TextEdit, M } from '../engine/types';
import type { FontInfo } from '../engine/pdfText';

export interface HostProps {
  isNative?: boolean;
  pickPdf?: () => Promise<{ name: string; base64: string } | null>;
  savePdf?: (base64: string, name: string) => Promise<string | void>;
}

const toB64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

// Fonts ship with the app (public/fonts) so the editor also works offline.
const fontBase = () => {
  const b = (process.env.EXPO_BASE_URL as string | undefined) ?? '/';
  return (b.endsWith('/') ? b : b + '/') + 'fonts/';
};
const fontFaces = () => {
  const u = fontBase();
  const face = (family: string, file: string, weight: number) =>
    `@font-face{font-family:"${family}";src:url("${u}${file}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`;
  return [
    ...[400, 500, 600, 700, 800].map((w) => face('Schibsted Grotesk', `schibsted-grotesk-latin-${w}-normal.woff2`, w)),
    face('Caveat', 'caveat-latin-600-normal.woff2', 400),
    face('Dancing Script', 'dancing-script-latin-600-normal.woff2', 400),
    face('Great Vibes', 'great-vibes-latin-400-normal.woff2', 400),
    face('Homemade Apple', 'homemade-apple-latin-400-normal.woff2', 400),
  ].join('\n');
};

export default function EditorApp(host: HostProps) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [infos, setInfos] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hist = useHistory();
  const { snap, commit } = hist;

  useEffect(() => { loadPdfjs().catch(() => null); }, []);

  const open = useCallback(async (name: string, bytes: Uint8Array) => {
    setError(null);
    setBusy('Opening PDF…');
    try {
      const doc = await openPdf(bytes);
      const list: PageInfo[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const pg = await doc.getPage(i);
        const vp = pg.getViewport({ scale: 1 });
        list.push({ w: vp.width, h: vp.height, vm: vp.transform as M });
      }
      setInfos(list);
      setPdf(doc);
      setFile({ name, bytes });
      hist.reset(list.map((_, i) => ({ src: i, rotation: 0 })));
    } catch (e: any) {
      setError(e?.name === 'PasswordException'
        ? 'This PDF is password-protected. Remove the password and try again.'
        : e?.message?.includes('PDF engine') ? e.message : 'This file could not be opened as a PDF.');
    } finally {
      setBusy(null);
    }
  }, [hist]);

  const close = () => { setFile(null); setPdf(null); setInfos([]); };

  return (
    <>
      <style>{fontFaces() + css}</style>
      {file && pdf ? (
        <Editor key={file.name + file.bytes.length} host={host} file={file} pdf={pdf} infos={infos} hist={hist} snap={snap} commit={commit} onClose={close} setBusy={setBusy} />
      ) : (
        <Home host={host} error={error} onOpen={open} />
      )}
      {busy && <div className="busy" role="status"><div><div className="spin" />{busy}</div></div>}
    </>
  );

}

// ---------------- home ----------------
function Home({ host, error, onOpen }: { host: HostProps; error: string | null; onOpen: (n: string, b: Uint8Array) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const readFile = (f?: File | null) => {
    if (!f) return;
    f.arrayBuffer().then((b) => onOpen(f.name, new Uint8Array(b)));
  };
  const choose = async () => {
    if (host.isNative && host.pickPdf) {
      const r = await host.pickPdf();
      if (r) onOpen(r.name, fromB64(r.base64));
    } else inputRef.current?.click();
  };
  const features = [
    'Change existing text — it keeps the font, size and colour already in the document',
    'Sign by drawing, typing or uploading a photo of your signature',
    'Add text, images, shapes, highlights and freehand notes',
    'Hide anything with whiteout, and rotate, reorder or delete pages',
  ];
  return (
    <main className="home">
      <section>
        <h1>Edit the PDF itself, not a copy of it.</h1>
        <p className="lead">Open a PDF, click any line and retype it. Sign, annotate and rearrange pages, then download a normal PDF that opens anywhere.</p>
        <button className="btn" onClick={choose}><Icon name="file" size={18} /> Open a PDF</button>
        <ul>{features.map((f) => <li key={f}><Icon name="check" size={18} />{f}</li>)}</ul>
        <p className="privacy"><Icon name="lock" size={14} /> Your file is processed on this device and never uploaded.</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); readFile(e.dataTransfer.files?.[0]); }}
      >
        <div className="sheet back1" />
        <div className="sheet back2" />
        <div className="sheet front" role="button" tabIndex={0} onClick={choose} onKeyDown={(e) => e.key === 'Enter' && choose()}>
          <div className="lines"><i /><i /><i /><i /><i /></div>
          <span className="stroke">Drop a PDF here</span>
          <span className="hint">or choose a file</span>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { readFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </main>
  );
}

// ---------------- editor ----------------
function Editor({ host, file, pdf, infos, hist, snap, commit, onClose, setBusy }: {
  host: HostProps; file: { name: string; bytes: Uint8Array }; pdf: any; infos: PageInfo[];
  hist: ReturnType<typeof useHistory>; snap: ReturnType<typeof useHistory>['snap'];
  commit: ReturnType<typeof useHistory>['commit']; onClose: () => void; setBusy: (s: string | null) => void;
}) {
  const [tool, setTool] = useState<Tool>('edit');
  const [style, setStyle] = useState<ToolStyle>({
    color: '#000000', stroke: '#1d3fb8', fill: null, strokeWidth: 2, fontSize: 14, family: 'Helvetica', highlight: '#ffe14d',
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pageData, setPageData] = useState<Record<number, PageData>>({});
  const [fonts, setFonts] = useState<Record<string, FontInfo>>({});
  const [showSig, setShowSig] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const [showShapes, setShowShapes] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const ratios = useRef<Record<number, number>>({});
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);

  // fit width on open
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const maxW = Math.max(...infos.map((i) => i.w));
    const avail = el.clientWidth - (mobile ? 16 : 64);
    setZoom(Math.max(0.3, Math.min(mobile ? 3 : 1.5, avail / maxW)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infos]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); } }, [toast]);

  const currentPage = () => {
    let best = snap.pages[0]?.src ?? 0;
    let r = -1;
    for (const p of snap.pages) if ((ratios.current[p.src] ?? 0) > r) { r = ratios.current[p.src] ?? 0; best = p.src; }
    return best;
  };

  // ----- object helpers -----
  const addObject = (o: EditorObject) => commit((s) => ({ ...s, objects: [...s.objects, o] }));
  const changeObject = (id: string, patch: Partial<EditorObject>, merge: boolean) =>
    commit((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as EditorObject) : o)) }), merge);
  const deleteObject = (id: string) => commit((s) => ({ ...s, objects: s.objects.filter((o) => o.id !== id) }));
  const removeObject = (id: string) => {
    deleteObject(id);
    setSelected((cur) => (cur === id ? null : cur));
    setEditing((cur) => (cur === id ? null : cur));
  };
  const duplicateObject = (id: string) => {
    const o = snap.objects.find((x) => x.id === id);
    if (!o) return;
    const nid = uid();
    setEditing(null);
    addObject({ ...o, id: nid, x: o.x + 12, y: o.y + 12, ...(o.type === 'line' ? { x2: o.x2 + 12, y2: o.y2 + 12 } : {}) } as EditorObject);
    setSelected(nid);
  };
  const setRunEdit = (key: string, e: RunEdit | null) => commit((s) => {
    const edits = { ...s.edits };
    if (e) edits[key] = e; else delete edits[key];
    return { ...s, edits };
  });

  const stopEditing = (id: string) => {
    setEditing((cur) => (cur === id ? null : cur));
    // drop empty text boxes
    commit((s) => {
      const o = s.objects.find((x) => x.id === id);
      if (o && o.type === 'text' && !o.text.trim()) return { ...s, objects: s.objects.filter((x) => x.id !== id) };
      return s;
    }, true);
  };

  const placeStamp = (st: Stamp, type: 'signature' | 'image', src?: number, at?: { x: number; y: number }) => {
    const page = src ?? currentPage();
    const info = infos[page];
    const maxW = type === 'signature' ? Math.min(180, info.w * 0.4) : Math.min(260, info.w * 0.6);
    const w = Math.min(maxW, st.w);
    const h = (w * st.h) / st.w;
    const x = at ? at.x - w / 2 : (info.w - w) / 2;
    const y = at ? at.y - h / 2 : (info.h - h) / 2;
    const id = uid();
    addObject({ id, page, type, x, y, w, h, src: st.src });
    setSelected(id);
    setTool('edit');
  };

  const onImage = (f?: File) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => {
        let src = r.result as string;
        if (!/^data:image\/(png|jpe?g)/.test(src)) {
          const c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d')!.drawImage(im, 0, 0);
          src = c.toDataURL('image/png');
        }
        placeStamp({ src, w: im.naturalWidth, h: im.naturalHeight }, 'image');
      };
      im.src = r.result as string;
    };
    r.readAsDataURL(f);
  };

  const textEdits = (editsObj: Record<string, RunEdit>): TextEdit[] => {
    const out: TextEdit[] = [];
    for (const [key, e] of Object.entries(editsObj)) {
      const page = +key.split(':')[0];
      const run = pageData[page]?.runs.find((r) => r.key === key);
      if (!run) continue;
      const font = fonts[run.fontName];
      out.push({
        page, key, region: run.region, text: e.text, sizeScale: e.sizeScale, color: e.color,
        charMap: font?.charMap ?? {}, fallback: font?.fallback ?? { family: 'Helvetica', bold: false, italic: false },
        bgColor: pageData[page]?.colors[key]?.bg ?? '#ffffff',
      });
    }
    return out;
  };

  // ----- live preview: re-write edited pages with the real fonts and show that -----
  const editKeyOf = (src: number) => {
    const list = Object.entries(snap.edits).filter(([k]) => k.startsWith(src + ':')).sort(([a], [b]) => (a < b ? -1 : 1));
    return list.length ? JSON.stringify(list) : '';
  };
  const [preview, setPreview] = useState<{ pdf: any; keys: Record<number, string> } | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    const seq = ++previewSeq.current;
    const edits = textEdits(snap.edits);
    if (!edits.length) { setPreview(null); return; }
    const keys: Record<number, string> = {};
    for (const e of edits) keys[e.page] = editKeyOf(e.page);
    const t = setTimeout(async () => {
      try {
        const bytes = await exportPdf({
          bytes: file.bytes, pages: infos.map((_, i) => ({ src: i, rotation: 0 })), objects: [], edits,
          viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])),
        });
        if (seq !== previewSeq.current) return;
        const doc = await openPdf(bytes);
        if (seq !== previewSeq.current) { doc.destroy?.(); return; }
        setPreview((old) => { if (old?.pdf && old.pdf !== pdf) setTimeout(() => old.pdf.destroy?.(), 2000); return { pdf: doc, keys }; });
      } catch (err) {
        console.warn('preview failed', err);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.edits]);

  // ----- export -----
  const download = async () => {
    setEditing(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    await new Promise((r) => setTimeout(r, 30));
    setBusy('Preparing your PDF…');
    try {
      const edits = textEdits(snap.edits);
      const bytes = await exportPdf({
        bytes: file.bytes, pages: snap.pages, objects: snap.objects, edits,
        viewMatrices: Object.fromEntries(infos.map((i, k) => [k, i.vm])),
      });
      const name = file.name.replace(/\.pdf$/i, '') + '-edited.pdf';
      if (host.isNative && host.savePdf) {
        await host.savePdf(toB64(bytes), name);
      } else {
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setToast(`Downloaded ${name}`);
      }
    } catch (e: any) {
      console.error(e);
      setToast('The PDF could not be saved: ' + (e?.message || 'unknown error'));
    } finally {
      setBusy(null);
    }
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? hist.redo() : hist.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); hist.redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        if (selected.includes(':')) { const run = findRun(selected); if (run) setRunEdit(selected, { text: '', sizeScale: 1, color: null }); }
        else deleteObject(selected);
        setSelected(null);
      } else if (e.key === 'Escape') { setSelected(null); setTool('edit'); setShowShapes(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ----- zoom: anchored so the point under the fingers / cursor stays put -----
  const MIN_Z = 0.3, MAX_Z = 5;
  const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  type Anchor = { el: HTMLElement; fx: number; fy: number; cx: number; cy: number };
  const pendingAnchor = useRef<Anchor | null>(null);
  const anchorAt = (cx: number, cy: number): Anchor | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    wrap.querySelectorAll<HTMLElement>('.pageOuter').forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (d < bestD) { bestD = d; best = el; }
    });
    if (!best) return null;
    const r = (best as HTMLElement).getBoundingClientRect();
    return { el: best, fx: (cx - r.left) / r.width, fy: (cy - r.top) / r.height, cx, cy };
  };
  const applyAnchor = (a: Anchor) => {
    const wrap = wrapRef.current;
    if (!wrap || !a.el.isConnected) return;
    const r = a.el.getBoundingClientRect();
    wrap.scrollLeft += r.left + a.fx * r.width - a.cx;
    wrap.scrollTop += r.top + a.fy * r.height - a.cy;
  };
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    pendingAnchor.current = null;
    if (a) applyAnchor(a);
  }, [zoom]);
  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const wrap = wrapRef.current;
    if (!wrap) { setZoom(clampZ(z)); return; }
    const wr = wrap.getBoundingClientRect();
    const a = anchorAt(cx ?? wr.left + wr.width / 2, cy ?? wr.top + wr.height / 2);
    const nz = clampZ(z);
    if (a) {
      if (Math.abs(nz - zoomRef.current) < 1e-4) { applyAnchor(a); return; }
      pendingAnchor.current = a;
    }
    setZoom(nz);
  };

  // two fingers: pinch to zoom and drag to pan, at the same time
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let start: null | { d: number; z: number; anchor: Anchor } = null;
    let frame = 0;
    let latest: TouchList | null = null;
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    const begin = (t: TouchList) => {
      const m = mid(t);
      const anchor = anchorAt(m.x, m.y);
      start = anchor ? { d: dist(t), z: zoomRef.current, anchor } : null;
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        gesture.multi = true;
        (document.activeElement as HTMLElement | null)?.blur?.();
        begin(e.touches);
        if (e.cancelable) e.preventDefault();
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length < 2 || !start) return;
      if (e.cancelable) e.preventDefault();
      latest = e.touches;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!latest || latest.length < 2 || !start) return;
        const m = mid(latest);
        const z = clampZ(start.z * (dist(latest) / start.d));
        const a = { ...start.anchor, cx: m.x, cy: m.y };
        if (Math.abs(z - zoomRef.current) < 0.002) applyAnchor(a);
        else { pendingAnchor.current = a; setZoom(z); }
      });
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length >= 2) { begin(e.touches); return; }
      start = null;
      latest = null;
      if (e.touches.length === 0) setTimeout(() => { gesture.multi = false; }, 0);
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findRun = (key: string) => pageData[+key.split(':')[0]]?.runs.find((r) => r.key === key);
  const selRun = selected?.includes(':') ? findRun(selected) : undefined;
  const selObj = selected && !selected.includes(':') ? snap.objects.find((o) => o.id === selected) : undefined;
  const editCount = Object.keys(snap.edits).length + snap.objects.length;
  const objectsByPage = useMemo(() => {
    const m: Record<number, EditorObject[]> = {};
    for (const o of snap.objects) (m[o.page] ??= []).push(o);
    return m;
  }, [snap.objects]);

  const pickTool = (t: Tool) => {
    setShowShapes(false);
    setSelected(null);
    setEditing(null);
    if (t === 'sign') { setShowSig(true); return; }
    if (t === 'image') { imgInput.current?.click(); return; }
    setTool(t);
  };

  const shapeTools: Tool[] = ['rect', 'ellipse', 'line'];
  const rail: { t: Tool | 'shapes' | 'pages'; label: string; icon: string }[] = [
    { t: 'edit', label: 'Edit', icon: 'edit' },
    { t: 'text', label: 'Add text', icon: 'text' },
    { t: 'sign', label: 'Sign', icon: 'sign' },
    { t: 'image', label: 'Image', icon: 'image' },
    { t: 'whiteout', label: 'Whiteout', icon: 'whiteout' },
    { t: 'highlight', label: 'Highlight', icon: 'highlight' },
    { t: 'shapes', label: 'Shapes', icon: 'shapes' },
    { t: 'draw', label: 'Draw', icon: 'draw' },
    { t: 'pages', label: 'Pages', icon: 'pages' },
  ];
  const showToolPanel = !mobile && !selRun && !selObj && ['text', 'rect', 'ellipse', 'line', 'draw', 'highlight', 'whiteout'].includes(tool);

  return (
    <div className="app">
      <header className="topbar">
        <button className="iconbtn" onClick={() => { if (!editCount || confirm('Close this document? Unsaved changes will be lost.')) onClose(); }} aria-label="Close document"><Icon name="back" /></button>
        <div className="name">{file.name}<small>{snap.pages.length} {snap.pages.length === 1 ? 'page' : 'pages'}{editCount ? ` · ${editCount} ${editCount === 1 ? 'change' : 'changes'}` : ''}</small></div>
        <button className="iconbtn" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Undo"><Icon name="undo" /></button>
        <button className="iconbtn" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Redo"><Icon name="redo" /></button>
        <div className="zoom">
          <button className="iconbtn" onClick={() => zoomTo(zoom / 1.2)} aria-label="Zoom out"><Icon name="minus" size={18} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button className="iconbtn" onClick={() => zoomTo(zoom * 1.2)} aria-label="Zoom in"><Icon name="plus" size={18} /></button>
        </div>
        <button className="btn small" onClick={download}><Icon name="download" size={18} /><span className="dl-label">Download</span></button>
      </header>

      <div className="body">
        <nav className="rail" aria-label="Tools">
          {rail.map((r, i) => {
            const active = r.t === 'shapes' ? shapeTools.includes(tool) || showShapes : r.t === tool;
            return (
              <React.Fragment key={r.t}>
                {(i === 4 || i === 8) && <hr />}
                <button className={`tool${active ? ' active' : ''}`} aria-pressed={active}
                  onClick={() => {
                    if (r.t === 'shapes') { setShowShapes((v) => !v); return; }
                    if (r.t === 'pages') { setShowPages(true); return; }
                    pickTool(r.t);
                  }}>
                  <span className="mark" /><Icon name={r.icon} />{r.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        {showShapes && (
          <div className="shapes" style={mobile ? undefined : { top: 56 + 8 + 6 * 58 }}>
            {(['rect', 'ellipse', 'line'] as Tool[]).map((t) => (
              <button key={t} className={`tool${tool === t ? ' active' : ''}`} onClick={() => pickTool(t)}>
                <span className="mark" /><Icon name={t} />{t === 'rect' ? 'Box' : t === 'ellipse' ? 'Circle' : 'Line'}
              </button>
            ))}
          </div>
        )}

        <div className="canvasWrap" ref={wrapRef}>
          <div className="pages">
            {snap.pages.map((p, i) => (
              <PageView key={p.src} src={p.src} index={i} rotation={p.rotation} info={infos[p.src]} zoom={zoom} pdf={pdf}
                tool={tool} style={style} data={pageData[p.src]} fonts={fonts} edits={snap.edits}
                objects={objectsByPage[p.src] ?? []} selected={selected} editing={editing}
                onData={(src, d, f) => { setPageData((m) => ({ ...m, [src]: d })); setFonts((m) => ({ ...m, ...f })); }}
                onSelect={setSelected} onEditing={setEditing} onStopEditing={stopEditing}
                onRunEdit={setRunEdit} onAdd={addObject} onChange={changeObject}
                onPlace={() => false}
                onDelete={removeObject} onDuplicate={duplicateObject}
                onTextPlaced={() => setTool('edit')}
                onVisible={(src, r) => { ratios.current[src] = r; }}
                editKey={editKeyOf(p.src)}
                preview={preview && preview.keys[p.src] !== undefined ? { pdf: preview.pdf, key: preview.keys[p.src] } : undefined} />
            ))}
          </div>
        </div>

        {selRun && !(mobile && editing === selRun.key) && (
          <RunPanel run={selRun} font={fonts[selRun.fontName]} edit={snap.edits[selRun.key]}
            onEdit={(e) => setRunEdit(selRun.key, e)} onReset={() => setRunEdit(selRun.key, null)} onClose={() => setSelected(null)} />
        )}
        {selObj && !(mobile && editing === selObj.id) && (
          <ObjectPanel o={selObj} onChange={(p) => changeObject(selObj.id, p, false)}
            onDelete={() => removeObject(selObj.id)}
            onDuplicate={() => duplicateObject(selObj.id)}
            onClose={() => setSelected(null)} />
        )}
        {showToolPanel && <ToolPanel tool={tool} style={style} onChange={(s) => setStyle((v) => ({ ...v, ...s }))} />}
      </div>

      <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { onImage(e.target.files?.[0]); e.target.value = ''; }} />
      {showSig && <SignatureModal onClose={() => setShowSig(false)} onPick={(s) => { setShowSig(false); placeStamp(s, 'signature'); }} />}
      {showPages && <PagesModal pdf={pdf} pages={snap.pages} onChange={(pages) => commit((s) => ({ ...s, pages }))} onClose={() => setShowPages(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
