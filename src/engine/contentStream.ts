// Minimal, lossless PDF content-stream tokenizer.
// Every operator keeps the byte range it came from, so unmodified parts of a
// page are written back byte-for-byte and only edited operators are rewritten.

export type Operand =
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: Uint8Array; hex: boolean }
  | { t: 'arr'; v: Operand[] }
  | { t: 'dict'; v: Record<string, Operand> }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'raw'; v: string };

export interface Op {
  op: string;
  args: Operand[];
  start: number; // byte offset of first operand (or operator)
  end: number; // byte offset after operator
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

export function tokenize(bytes: Uint8Array): Op[] {
  const ops: Op[] = [];
  let i = 0;
  const n = bytes.length;
  let args: Operand[] = [];
  let argStart = -1;

  const skipWs = () => {
    while (i < n) {
      const c = bytes[i];
      if (WS.has(c)) i++;
      else if (c === 0x25) {
        while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
      } else break;
    }
  };

  const readRegular = (): string => {
    const s = i;
    while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) i++;
    let out = '';
    for (let k = s; k < i; k++) out += String.fromCharCode(bytes[k]);
    return out;
  };

  const readLiteral = (): Uint8Array => {
    // assumes bytes[i] === '('
    i++;
    const out: number[] = [];
    let depth = 1;
    while (i < n) {
      const c = bytes[i++];
      if (c === 0x5c) {
        const d = bytes[i++];
        switch (d) {
          case 0x6e: out.push(0x0a); break; // n
          case 0x72: out.push(0x0d); break; // r
          case 0x74: out.push(0x09); break; // t
          case 0x62: out.push(0x08); break; // b
          case 0x66: out.push(0x0c); break; // f
          case 0x28: out.push(0x28); break;
          case 0x29: out.push(0x29); break;
          case 0x5c: out.push(0x5c); break;
          case 0x0d: if (bytes[i] === 0x0a) i++; break; // line continuation
          case 0x0a: break;
          default:
            if (d >= 0x30 && d <= 0x37) {
              let v = d - 0x30;
              for (let k = 0; k < 2 && bytes[i] >= 0x30 && bytes[i] <= 0x37; k++) v = v * 8 + (bytes[i++] - 0x30);
              out.push(v & 0xff);
            } else out.push(d);
        }
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        depth--;
        if (depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  };

  const readHex = (): Uint8Array => {
    i++; // '<'
    const digits: number[] = [];
    while (i < n && bytes[i] !== 0x3e) {
      const c = bytes[i++];
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 55 : c >= 0x61 && c <= 0x66 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    i++; // '>'
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = digits[2 * k] * 16 + digits[2 * k + 1];
    return out;
  };

  const readObject = (): Operand | { t: 'op'; v: string } | null => {
    skipWs();
    if (i >= n) return null;
    const c = bytes[i];
    if (c === 0x28) return { t: 'str', v: readLiteral(), hex: false };
    if (c === 0x3c) {
      if (bytes[i + 1] === 0x3c) {
        i += 2;
        const dict: Record<string, Operand> = {};
        for (;;) {
          skipWs();
          if (i >= n) break;
          if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) { i += 2; break; }
          const key = readObject();
          const val = readObject();
          if (!key || !val) break;
          if (key.t === 'name' && val.t !== 'op') dict[key.v] = val as Operand;
        }
        return { t: 'dict', v: dict };
      }
      return { t: 'str', v: readHex(), hex: true };
    }
    if (c === 0x2f) {
      i++;
      return { t: 'name', v: readRegular() };
    }
    if (c === 0x5b) {
      i++;
      const arr: Operand[] = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (bytes[i] === 0x5d) { i++; break; }
        const o = readObject();
        if (!o) break;
        if (o.t === 'op') continue; // malformed, ignore
        arr.push(o as Operand);
      }
      return { t: 'arr', v: arr };
    }
    if (c === 0x5d || c === 0x29 || c === 0x3e || c === 0x7b || c === 0x7d) {
      i++;
      return { t: 'raw', v: String.fromCharCode(c) };
    }
    const word = readRegular();
    if (word === '') { i++; return { t: 'raw', v: '' }; }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: parseFloat(word) };
    if (word === 'true' || word === 'false') return { t: 'bool', v: word === 'true' };
    if (word === 'null') return { t: 'null' };
    return { t: 'op', v: word };
  };

  for (;;) {
    skipWs();
    if (i >= n) break;
    const before = i;
    const o = readObject();
    if (!o) break;
    if (argStart < 0) argStart = before;
    if (o.t === 'op') {
      if (o.v === 'BI') {
        // Inline image: skip to "EI" surrounded by whitespace.
        let k = i;
        while (k < n - 2) {
          if (bytes[k] === 0x49 && bytes[k + 1] === 0x44 && WS.has(bytes[k + 2]) && WS.has(bytes[k - 1])) break;
          k++;
        }
        k += 3;
        while (k < n - 1) {
          if (WS.has(bytes[k - 1]) && bytes[k] === 0x45 && bytes[k + 1] === 0x49 && (k + 2 >= n || WS.has(bytes[k + 2]))) break;
          k++;
        }
        i = Math.min(n, k + 2);
        ops.push({ op: 'BI', args: [], start: argStart, end: i });
      } else {
        ops.push({ op: o.v, args, start: argStart, end: i });
      }
      args = [];
      argStart = -1;
    } else {
      args.push(o as Operand);
    }
  }
  return ops;
}

// ---------- serialization ----------

const fmtNum = (v: number) => {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
};

const toHex = (b: Uint8Array) => {
  let s = '<';
  for (let k = 0; k < b.length; k++) s += b[k].toString(16).padStart(2, '0');
  return s + '>';
};

export function serializeOperand(o: Operand): string {
  switch (o.t) {
    case 'num': return fmtNum(o.v);
    case 'name': return '/' + o.v;
    case 'str': return toHex(o.v);
    case 'arr': return '[' + o.v.map(serializeOperand).join(' ') + ']';
    case 'dict': return '<<' + Object.entries(o.v).map(([k, v]) => `/${k} ${serializeOperand(v)}`).join(' ') + '>>';
    case 'bool': return o.v ? 'true' : 'false';
    case 'null': return 'null';
    case 'raw': return o.v;
  }
}

export function serializeOp(op: string, args: Operand[]): string {
  return [...args.map(serializeOperand), op].join(' ');
}

export { fmtNum, toHex };

/** Rebuild a stream, replacing given ops (by index) with new source text. */
export function rebuild(bytes: Uint8Array, ops: Op[], replacements: Map<number, string>): Uint8Array {
  if (replacements.size === 0) return bytes;
  const parts: Uint8Array[] = [];
  let cursor = 0;
  const enc = (s: string) => {
    const out = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k) & 0xff;
    return out;
  };
  const idx = [...replacements.keys()].sort((a, b) => a - b);
  for (const k of idx) {
    const op = ops[k];
    parts.push(bytes.subarray(cursor, op.start));
    parts.push(enc(' ' + replacements.get(k)! + ' '));
    cursor = op.end;
  }
  parts.push(bytes.subarray(cursor));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
