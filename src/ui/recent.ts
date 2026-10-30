import { t as tr, locale } from './i18n';
// Recent documents (opened, edited, scanned), kept on this device only: IndexedDB holds a small
// preview of the first page and the PDF itself, so a document can be opened again from the start
// screen. Nothing leaves the device.
import { openPdf } from './pdfjs';

export type RecentKind = 'opened' | 'edited' | 'scanned';
export interface RecentDoc { id: string; name: string; kind: RecentKind; pages: number; size: number; at: number; thumb: string | null; hasBytes: boolean }

const DB = 'pe-recent', META = 'docs', BYTES = 'bytes';
const KEEP = 12;
const MAX_BYTES = 60 * 1024 * 1024, TOTAL = 200 * 1024 * 1024;
const EVENT = 'pe-recent-change';

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(BYTES)) d.createObjectStore(BYTES);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

export async function listRecent(): Promise<RecentDoc[]> {
  const d = await db();
  if (!d) return [];
  try {
    const all = await req(d.transaction(META).objectStore(META).getAll()) as RecentDoc[];
    return all.sort((a, z) => z.at - a.at);
  } catch { return []; }
}

export async function recentBytes(id: string): Promise<Uint8Array | null> {
  const d = await db();
  if (!d) return null;
  try { return ((await req(d.transaction(BYTES).objectStore(BYTES).get(id))) as Uint8Array | undefined) ?? null; } catch { return null; }
}

export async function removeRecent(id: string) {
  const d = await db();
  if (!d) return;
  try {
    const t = d.transaction([META, BYTES], 'readwrite');
    t.objectStore(META).delete(id); t.objectStore(BYTES).delete(id);
    await done(t);
  } catch { /* fine */ }
  window.dispatchEvent(new Event(EVENT));
}

/** a small JPEG of the first page */
async function thumbOf(pdf: any): Promise<string | null> {
  try {
    const page = await pdf.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const k = 220 / Math.max(v1.width, v1.height);
    const vp = page.getViewport({ scale: k });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const x = c.getContext('2d')!;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp }).promise;
    return c.toDataURL('image/jpeg', 0.72);
  } catch { return null; }
}

/**
 * Adds or updates a document. `id` updates that entry (an edited version of an opened file);
 * otherwise an entry with the same name, kind and size is reused. Returns the entry's id.
 */
export async function saveRecent(o: { id?: string; name: string; kind: RecentKind; bytes: Uint8Array; pdf?: any }): Promise<string | null> {
  const d = await db();
  if (!d) return null;
  try {
    const list = await listRecent();
    const same = o.id ? list.find((r) => r.id === o.id) : list.find((r) => r.name === o.name && r.size === o.bytes.length);
    const id = same?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    let pdf = o.pdf, own = false;
    if (!pdf) { pdf = await openPdf(o.bytes); own = true; }
    const thumb = await thumbOf(pdf);
    const pages = pdf.numPages ?? 0;
    if (own) pdf.destroy?.();
    const keep = o.bytes.length <= MAX_BYTES;
    const meta: RecentDoc = {
      id, name: o.name, pages, size: o.bytes.length, at: Date.now(), thumb, hasBytes: keep,
      // an opened file that was edited stays "edited"
      kind: same?.kind === 'edited' && o.kind === 'opened' ? 'edited' : same?.kind === 'scanned' && o.kind === 'opened' ? 'scanned' : o.kind,
    };
    const t = d.transaction([META, BYTES], 'readwrite');
    t.objectStore(META).put(meta);
    if (keep) t.objectStore(BYTES).put(o.bytes, id); else t.objectStore(BYTES).delete(id);
    await done(t);
    // only the most recent few, and at most TOTAL bytes of files (older ones stay listed without the file)
    const all = [meta, ...list.filter((r) => r.id !== id)];
    const old = all.slice(KEEP);
    let sum = 0;
    const drop = all.slice(0, KEEP).filter((r) => { if (!r.hasBytes) return false; sum += r.size; return sum > TOTAL; });
    if (old.length || drop.length) {
      const t2 = d.transaction([META, BYTES], 'readwrite');
      for (const r of old) { t2.objectStore(META).delete(r.id); t2.objectStore(BYTES).delete(r.id); }
      for (const r of drop) { t2.objectStore(META).put({ ...r, hasBytes: false }); t2.objectStore(BYTES).delete(r.id); }
      await done(t2);
    }
    window.dispatchEvent(new Event(EVENT));
    return id;
  } catch (e) {
    console.warn('recent', e);
    return null;
  }
}

export const onRecentChange = (fn: () => void) => { window.addEventListener(EVENT, fn); return () => window.removeEventListener(EVENT, fn); };

export function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return tr('Just now');
  if (s < 3600) return tr('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return tr('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 2) return tr('Yesterday');
  return new Date(t).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}
