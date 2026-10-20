// Walks a page content stream and records where every glyph is drawn,
// with the exact text state used, so text can be removed glyph-by-glyph and
// replaced with new text in the very same font resource.
import { Op, Operand, serializeOp } from './contentStream';
import { FontMetrics } from './fonts';

export type M = [number, number, number, number, number, number];
export const IDENT: M = [1, 0, 0, 1, 0, 0];

export const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
export const apply = (m: M, x: number, y: number): [number, number] => [
  x * m[0] + y * m[2] + m[4],
  x * m[1] + y * m[3] + m[5],
];
export const invert = (m: M): M => {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det,
  ];
};

export interface TextStyle {
  ctm: M;
  fontRes: string;
  fontSize: number;
  Tc: number;
  Tw: number;
  Tz: number; // 100 = normal
  Ts: number;
  Tr: number;
  fill: string[]; // operators that reproduce the fill colour
}

export interface Glyph {
  opIndex: number;
  elem: number; // index into TJ array (0 for Tj)
  pos: number; // byte offset of the code inside the string
  len: number; // byte length of the code
  code: number;
  tm: M; // text matrix before this glyph
  origin: [number, number]; // user space
  end: [number, number];
  height: number; // font size in user space
  style: TextStyle;
}

export interface ShowOp {
  index: number;
  kind: 'Tj' | 'TJ' | "'" | '"';
  array: Operand[]; // normalised TJ array
}

interface GState {
  ctm: M;
  fontRes: string;
  fontSize: number;
  Tc: number; Tw: number; Tz: number; TL: number; Ts: number; Tr: number;
  fill: string[];
}

export function interpret(ops: Op[], fonts: (res: string) => FontMetrics | undefined) {
  const glyphs: Glyph[] = [];
  const shows = new Map<number, ShowOp>();
  let gs: GState = { ctm: IDENT, fontRes: '', fontSize: 0, Tc: 0, Tw: 0, Tz: 100, TL: 0, Ts: 0, Tr: 0, fill: [] };
  const stack: GState[] = [];
  let tm: M = IDENT;
  let tlm: M = IDENT;

  const nums = (a: Operand[]) => a.map((o) => (o.t === 'num' ? o.v : 0));

  const showString = (opIndex: number, elem: number, bytes: Uint8Array) => {
    const fm = fonts(gs.fontRes);
    const bpc = fm?.bytesPerCode ?? 1;
    const th = gs.Tz / 100;
    const style: TextStyle = {
      ctm: gs.ctm, fontRes: gs.fontRes, fontSize: gs.fontSize, Tc: gs.Tc, Tw: gs.Tw,
      Tz: gs.Tz, Ts: gs.Ts, Tr: gs.Tr, fill: gs.fill,
    };
    for (let p = 0; p + bpc <= bytes.length; p += bpc) {
      const code = bpc === 2 ? (bytes[p] << 8) | bytes[p + 1] : bytes[p];
      const w0 = fm ? fm.width(code) : 0.5;
      const isSpace = bpc === 1 && code === 32;
      const tx = (w0 * gs.fontSize + gs.Tc + (isSpace ? gs.Tw : 0)) * th;
      const trm = mul([gs.fontSize * th, 0, 0, gs.fontSize, 0, gs.Ts], mul(tm, gs.ctm));
      const origin = apply(trm, 0, 0);
      const full = mul(tm, gs.ctm);
      const end = apply(mul([1, 0, 0, 1, tx, gs.Ts], full), 0, 0);
      const height = Math.abs(gs.fontSize) * Math.hypot(full[2], full[3]);
      glyphs.push({ opIndex, elem, pos: p, len: bpc, code, tm, origin, end, height, style });
      tm = mul([1, 0, 0, 1, tx, 0], tm);
    }
  };

  const adjust = (n: number) => {
    const tx = (-n / 1000) * gs.fontSize * (gs.Tz / 100);
    tm = mul([1, 0, 0, 1, tx, 0], tm);
  };

  const nextLine = () => {
    tlm = mul([1, 0, 0, 1, 0, -gs.TL], tlm);
    tm = tlm;
  };

  ops.forEach((op, index) => {
    const a = op.args;
    switch (op.op) {
      case 'q': stack.push({ ...gs }); break;
      case 'Q': if (stack.length) gs = stack.pop()!; break;
      case 'cm': gs = { ...gs, ctm: mul(nums(a) as M, gs.ctm) }; break;
      case 'g': case 'rg': case 'k': case 'sc': case 'scn':
        gs = { ...gs, fill: [...gs.fill.filter((s) => s.endsWith(' cs')), serializeOp(op.op, a)] };
        break;
      case 'cs': gs = { ...gs, fill: [serializeOp('cs', a)] }; break;
      case 'BT': tm = IDENT; tlm = IDENT; break;
      case 'Tf':
        gs = { ...gs, fontRes: a[0]?.t === 'name' ? a[0].v : gs.fontRes, fontSize: a[1]?.t === 'num' ? a[1].v : gs.fontSize };
        break;
      case 'Tc': gs = { ...gs, Tc: nums(a)[0] ?? 0 }; break;
      case 'Tw': gs = { ...gs, Tw: nums(a)[0] ?? 0 }; break;
      case 'Tz': gs = { ...gs, Tz: nums(a)[0] ?? 100 }; break;
      case 'TL': gs = { ...gs, TL: nums(a)[0] ?? 0 }; break;
      case 'Ts': gs = { ...gs, Ts: nums(a)[0] ?? 0 }; break;
      case 'Tr': gs = { ...gs, Tr: nums(a)[0] ?? 0 }; break;
      case 'Td': { const [x, y] = nums(a); tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; break; }
      case 'TD': { const [x, y] = nums(a); gs = { ...gs, TL: -y }; tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; break; }
      case 'Tm': tlm = nums(a) as M; tm = tlm; break;
      case 'T*': nextLine(); break;
      case 'Tj':
        if (a[0]?.t === 'str') {
          shows.set(index, { index, kind: 'Tj', array: [a[0]] });
          showString(index, 0, a[0].v);
        }
        break;
      case "'":
        nextLine();
        if (a[0]?.t === 'str') {
          shows.set(index, { index, kind: "'", array: [a[0]] });
          showString(index, 0, a[0].v);
        }
        break;
      case '"': {
        const [aw, ac] = nums(a);
        gs = { ...gs, Tw: aw, Tc: ac };
        nextLine();
        const s = a[2];
        if (s?.t === 'str') {
          shows.set(index, { index, kind: '"', array: [s] });
          showString(index, 0, s.v);
        }
        break;
      }
      case 'TJ':
        if (a[0]?.t === 'arr') {
          shows.set(index, { index, kind: 'TJ', array: a[0].v });
          a[0].v.forEach((el, e) => {
            if (el.t === 'str') showString(index, e, el.v);
            else if (el.t === 'num') adjust(el.v);
          });
        }
        break;
    }
  });
  return { glyphs, shows };
}

/**
 * Rewrites show-text operators so the given glyphs disappear while every
 * other glyph keeps its exact position (removed glyphs become kerning gaps).
 */
export function removeGlyphs(
  glyphs: Glyph[],
  shows: Map<number, ShowOp>,
  remove: Set<Glyph>,
  fonts: (res: string) => FontMetrics | undefined,
): Map<number, string> {
  const byOp = new Map<number, Glyph[]>();
  for (const g of glyphs) {
    if (!byOp.has(g.opIndex)) byOp.set(g.opIndex, []);
    byOp.get(g.opIndex)!.push(g);
  }
  const out = new Map<number, string>();
  for (const [opIndex, list] of byOp) {
    if (!list.some((g) => remove.has(g))) continue;
    const show = shows.get(opIndex)!;
    const newArr: Operand[] = [];
    let pendingGap = 0; // in TJ units (thousandths of text space)
    let curBytes: number[] = [];
    const flushStr = () => {
      if (curBytes.length) {
        if (pendingGap) { newArr.push({ t: 'num', v: pendingGap }); pendingGap = 0; }
        newArr.push({ t: 'str', v: Uint8Array.from(curBytes), hex: true });
        curBytes = [];
      }
    };
    show.array.forEach((el, e) => {
      if (el.t === 'num') {
        flushStr();
        pendingGap += el.v;
        return;
      }
      if (el.t !== 'str') return;
      for (const g of list.filter((x) => x.elem === e)) {
        if (remove.has(g)) {
          flushStr();
          const fm = fonts(g.style.fontRes);
          const fs = g.style.fontSize || 1;
          const w0 = fm ? fm.width(g.code) : 0.5;
          const isSpace = g.len === 1 && g.code === 32;
          const adv = w0 + (g.style.Tc + (isSpace ? g.style.Tw : 0)) / fs;
          pendingGap -= adv * 1000;
        } else {
          for (let k = 0; k < g.len; k++) curBytes.push(el.v[g.pos + k]);
        }
      }
    });
    flushStr();
    // trailing gap matters for following ops in the same BT block
    if (pendingGap) newArr.push({ t: 'num', v: pendingGap });
    const arrSrc = serializeOp('TJ', [{ t: 'arr', v: newArr.length ? newArr : [{ t: 'str', v: new Uint8Array(0), hex: true }] }]);
    if (show.kind === 'TJ' || show.kind === 'Tj') out.set(opIndex, arrSrc);
    else if (show.kind === "'") out.set(opIndex, 'T* ' + arrSrc);
    else {
      const g0 = list[0].style;
      out.set(opIndex, `${g0.Tw} Tw ${g0.Tc} Tc T* ${arrSrc}`);
    }
  }
  return out;
}
