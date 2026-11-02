// Comparing two versions of a document: lines first (Myers), then the words inside changed lines (LCS).

export type Op = { k: 'eq' | 'del' | 'ins'; a0: number; a1: number; b0: number; b1: number };

/** Myers' O(ND) difference of two sequences of keys; null when they differ in more than maxD places */
export function myers(a: string[], b: string[], maxD = 2000): Op[] | null {
  // common start and end first: most of two versions of a letter is the same
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  const N = A.length, M = B.length, max = N + M;
  const ops: Op[] = [];
  const push = (k: Op['k'], a0: number, a1: number, b0: number, b1: number) => {
    if (a1 <= a0 && b1 <= b0) return;
    const l = ops[ops.length - 1];
    if (l && l.k === k && l.a1 === a0 && l.b1 === b0) { l.a1 = a1; l.b1 = b1; } else ops.push({ k, a0, a1, b0, b1 });
  };
  push('eq', 0, s, 0, s);
  if (N || M) {
    const off = max + 1;
    let v = new Int32Array(2 * max + 3);
    const trace: Int32Array[] = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, maxD); d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && A[x] === B[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= N && y >= M) { found = d; break; }
      }
      if (found >= 0) break;
    }
    if (found < 0) return null;
    // walk back through the saved fronts
    const rev: Op[] = [];
    let x = N, y = M;
    for (let d = found; d > 0; d--) {
      const vp = trace[d];
      const k = x - y;
      const prevK = k === -d || (k !== d && vp[off + k - 1] < vp[off + k + 1]) ? k + 1 : k - 1;
      const px = vp[off + prevK], py = px - prevK;
      const sx = prevK === k + 1 ? px : px + 1, sy = prevK === k + 1 ? py + 1 : py;
      if (x > sx) rev.push({ k: 'eq', a0: sx, a1: x, b0: sy, b1: y });
      if (prevK === k + 1) rev.push({ k: 'ins', a0: px, a1: px, b0: py, b1: py + 1 });
      else rev.push({ k: 'del', a0: px, a1: px + 1, b0: py, b1: py });
      x = px; y = py;
    }
    if (x > 0) rev.push({ k: 'eq', a0: 0, a1: x, b0: 0, b1: y });
    for (const o of rev.reverse()) push(o.k, o.a0 + s, o.a1 + s, o.b0 + s, o.b1 + s);
  }
  push('eq', a.length - e, a.length, b.length - e, b.length);
  return ops;
}

/** LCS of two short sequences (word level inside changed lines) */
export function lcs(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  if (n * m > 400000) return [{ k: 'del', a0: 0, a1: n, b0: 0, b1: 0 }, { k: 'ins', a0: n, a1: n, b0: 0, b1: m }].filter((o) => o.a1 > o.a0 || o.b1 > o.b0) as Op[];
  const L = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    L[i * (m + 1) + j] = a[i] === b[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
  const ops: Op[] = [];
  const push = (k: Op['k'], i: number, j: number) => {
    const l = ops[ops.length - 1];
    const o = { k, a0: i, a1: i + (k === 'ins' ? 0 : 1), b0: j, b1: j + (k === 'del' ? 0 : 1) };
    if (l && l.k === k && l.a1 === o.a0 && l.b1 === o.b0) { l.a1 = o.a1; l.b1 = o.b1; } else ops.push(o);
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { push('eq', i, j); i++; j++; }
    else if (j < m && (i >= n || L[i * (m + 1) + j + 1] >= L[(i + 1) * (m + 1) + j])) { push('ins', i, j); j++; }
    else { push('del', i, j); i++; }
  }
  return ops;
}

export interface Word { w: string; page: number; s: number; e: number }
export interface Line { text: string; words: Word[] }
export interface Change { del: Word[]; ins: Word[]; before: string; after: string; pageA: number; pageB: number }

const norm = (s: string) => s.normalize('NFC').replace(/[­​]/g, '').replace(/[‐‑–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”„]/g, '"');

/** a page's text as lines of words (with where each word sits in the page's text) */
export function linesOf(text: string, page: number): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const raw of text.split('\n')) {
    const words: Word[] = [];
    for (const m of raw.matchAll(/\S+/g)) words.push({ w: norm(m[0]), page, s: at + m.index!, e: at + m.index! + m[0].length });
    if (words.length) out.push({ text: words.map((x) => x.w).join(' '), words });
    at += raw.length + 1;
  }
  return out;
}

/** the differences between two documents (pages of text each), word by word */
export function compareDocs(a: string[], b: string[]): Change[] | null {
  const la = a.flatMap((t, p) => linesOf(t, p)), lb = b.flatMap((t, p) => linesOf(t, p));
  const lineOps = myers(la.map((l) => l.text), lb.map((l) => l.text), 3000);
  if (!lineOps) return null;
  const wa = la.flatMap((l) => l.words), wb = lb.flatMap((l) => l.words);
  // index of each line's first word
  const fa: number[] = [], fb: number[] = [];
  la.reduce((n, l, i) => (fa[i] = n, n + l.words.length), 0); fa.push(wa.length);
  lb.reduce((n, l, i) => (fb[i] = n, n + l.words.length), 0); fb.push(wb.length);
  const changes: Change[] = [];
  const ctx = (ws: Word[], from: number, to: number) => ws.slice(Math.max(0, from), Math.max(0, to)).map((x) => x.w).join(' ');
  for (let i = 0; i < lineOps.length; i++) {
    const o = lineOps[i];
    if (o.k === 'eq') continue;
    // a run of changed lines (deletions and insertions next to each other)
    let a0 = o.a0, a1 = o.a1, b0 = o.b0, b1 = o.b1;
    while (i + 1 < lineOps.length && lineOps[i + 1].k !== 'eq') { i++; a1 = lineOps[i].a1; b1 = lineOps[i].b1; }
    const A = wa.slice(fa[a0], fa[a1]), B = wb.slice(fb[b0], fb[b1]);
    const wops = lcs(A.map((x) => x.w), B.map((x) => x.w));
    // next to each other (a word taken out, another put in): one change
    for (let j = 0; j < wops.length; j++) {
      if (wops[j].k === 'eq') continue;
      const first = wops[j];
      let last = first;
      while (j + 1 < wops.length && wops[j + 1].k !== 'eq') last = wops[++j];
      const del = A.slice(first.a0, last.a1), ins = B.slice(first.b0, last.b1);
      const ga = fa[a0] + first.a0, gb = fb[b0] + first.b0;
      changes.push({
        del, ins, pageA: (del[0] ?? wa[Math.min(ga, wa.length - 1)])?.page ?? 0, pageB: (ins[0] ?? wb[Math.min(gb, wb.length - 1)])?.page ?? 0,
        before: ctx(wb, gb - 5, gb), after: ctx(wb, gb + ins.length, gb + ins.length + 5),
      });
    }
  }
  return changes;
}
