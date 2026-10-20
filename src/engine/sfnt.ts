// Rewrites the cmap of a TrueType/OpenType font so that it maps Unicode
// characters straight to glyph ids. pdf.js loads embedded fonts with private
// code points, which a <textarea> can't type into; with a Unicode cmap the
// browser can render what the user types in the document's own font.

const u16 = (d: DataView, o: number) => d.getUint16(o);
const u32 = (d: DataView, o: number) => d.getUint32(o);

function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(b.length / 4) * 4;
  for (let i = 0; i < n; i += 4) {
    const v = ((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum;
}

/** Build a cmap table (format 4, platform 3/1) from unicode → glyph id. */
export function buildCmap(map: Map<number, number>): Uint8Array {
  const codes = [...map.keys()].filter((c) => c > 0 && c < 0xffff).sort((a, b) => a - b);
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const c of codes) {
    const g = map.get(c)!;
    const last = segs[segs.length - 1];
    if (last && c === last.end + 1 && ((g - c) & 0xffff) === last.delta) last.end = c;
    else segs.push({ start: c, end: c, delta: (g - c) & 0xffff });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length;
  const subLen = 16 + n * 8;
  const out = new Uint8Array(12 + subLen);
  const d = new DataView(out.buffer);
  d.setUint16(0, 0); d.setUint16(2, 1); // version, numTables
  d.setUint16(4, 3); d.setUint16(6, 1); d.setUint32(8, 12); // platform 3, encoding 1
  let o = 12;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 * 2 ** entrySelector;
  d.setUint16(o, 4); d.setUint16(o + 2, subLen); d.setUint16(o + 4, 0);
  d.setUint16(o + 6, n * 2); d.setUint16(o + 8, searchRange); d.setUint16(o + 10, entrySelector); d.setUint16(o + 12, n * 2 - searchRange);
  o += 14;
  segs.forEach((s, i) => d.setUint16(o + i * 2, s.end));
  o += n * 2 + 2; // + reservedPad
  segs.forEach((s, i) => d.setUint16(o + i * 2, s.start));
  o += n * 2;
  segs.forEach((s, i) => d.setUint16(o + i * 2, s.delta));
  // idRangeOffset all zero
  return out;
}

/** Return a copy of the font with its cmap replaced. Throws on non-sfnt data. */
export function withCmap(font: Uint8Array, map: Map<number, number>): Uint8Array {
  const d = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = u32(d, 0);
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) throw new Error('not an sfnt font');
  const num = u16(d, 4);
  const tables: { tag: string; data: Uint8Array }[] = [];
  for (let i = 0; i < num; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(font[r], font[r + 1], font[r + 2], font[r + 3]);
    const off = u32(d, r + 8), len = u32(d, r + 12);
    if (tag === 'cmap') continue;
    tables.push({ tag, data: font.slice(off, off + len) });
  }
  tables.push({ tag: 'cmap', data: buildCmap(map) });
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const head = 12 + tables.length * 16;
  let size = head;
  for (const t of tables) size += Math.ceil(t.data.length / 4) * 4;
  const out = new Uint8Array(size);
  const od = new DataView(out.buffer);
  const n = tables.length;
  const es = Math.floor(Math.log2(n));
  od.setUint32(0, version); od.setUint16(4, n);
  od.setUint16(6, 16 * 2 ** es); od.setUint16(8, es); od.setUint16(10, n * 16 - 16 * 2 ** es);
  let off = head;
  let headOff = -1;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.tag.charCodeAt(k);
    if (t.tag === 'head' && t.data.length >= 12) { t.data[8] = t.data[9] = t.data[10] = t.data[11] = 0; headOff = off; }
    od.setUint32(r + 4, checksum(t.data));
    od.setUint32(r + 8, off);
    od.setUint32(r + 12, t.data.length);
    out.set(t.data, off);
    off += Math.ceil(t.data.length / 4) * 4;
  });
  if (headOff >= 0) od.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
