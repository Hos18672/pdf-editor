// The editing field of a line of the PDF's own text: an editable element whose letters can have
// sizes of their own (select a word or a letter, then change its size). The text is plain: one span
// per stretch of letters of one size (`data-k`, × the line's size, in em so the line's size scales all).
import { useSyncExternalStore } from 'react';
import type { CharLook } from '../engine/types';
import { FAUX_BOLD } from '../engine/looks';

/** what an editing field holds: its text, and per code point (newlines included) a size and a look */
export interface FieldContent { text: string; scales: number[]; looks: (CharLook | null)[] }

/** the text, per-letter sizes and looks (one per code point, newlines included) shown in an editing field */
export function readField(root: HTMLElement): FieldContent {
  let text = '';
  const scales: number[] = [];
  const looks: (CharLook | null)[] = [];
  const of = (n: Node): [number, CharLook | null] => {
    for (let e: Node | null = n.parentNode; e && e !== root; e = e.parentNode) {
      const d = (e as HTMLElement).dataset;
      if (d?.k) {
        let l: CharLook | null = null;
        try { l = d.l ? JSON.parse(d.l) : null; } catch { l = null; }
        return [+d.k || 1, l];
      }
    }
    return [1, null];
  };
  const push = (ch: string, k: number, l: CharLook | null) => { text += ch; scales.push(k); looks.push(l); };
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').replace(/\u200b/g, '').replace(/\r/g, '');
      const [k, l] = of(n);
      for (const ch of t) push(ch, k, l);
      return;
    }
    const el = n as HTMLElement;
    if (el.tagName === 'BR') {
      // a lone <br> that only keeps an empty line open counts once
      if (el.nextSibling || !el.parentNode || el.parentNode === root) { const [k, l] = of(el); push('\n', k, l); }
      return;
    }
    // block elements some browsers put in for new lines
    if ((el.tagName === 'DIV' || el.tagName === 'P') && !first && text && !text.endsWith('\n')) push('\n', 1, null);
    el.childNodes.forEach((c, i) => walk(c, i === 0));
  };
  root.childNodes.forEach((c, i) => walk(c, i === 0));
  // a trailing newline the browser keeps for the caret
  if (text.endsWith('\n') && root.lastChild?.nodeName === 'BR') { text = text.slice(0, -1); scales.pop(); looks.pop(); }
  return { text, scales, looks };
}

/**
 * How letters with a look of their own are shown. 'real': the font has bold and italic faces (the
 * standard fonts). 'faux': one face only (a PDF's embedded font): bold is a thin outline round the
 * letters and italic a slant, as in the saved file.
 */
export type LookMode = 'real' | 'faux';
/** CSS of a stretch of letters with a look, inside text whose own setting is `base` */
export function lookCss(l: CharLook | null | undefined, base: CharLook, mode: LookMode): Record<string, string> {
  const css: Record<string, string> = {};
  const b = l?.b ?? !!base.b, i = l?.i ?? !!base.i, u = l?.u ?? !!base.u, s = l?.s ?? !!base.s;
  if (mode === 'real') {
    if (l?.b !== undefined) css.fontWeight = b ? '700' : '400';
    if (l?.i !== undefined) css.fontStyle = i ? 'italic' : 'normal';
  } else {
    if (l?.b && !base.b) { css.WebkitTextStroke = `${FAUX_BOLD}em currentColor`; css.paintOrder = 'stroke fill'; }
    if (l?.i && !base.i) { css.fontStyle = 'oblique 12deg'; css.fontSynthesis = 'style'; }
  }
  const deco = [u ? 'underline' : '', s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) { css.textDecorationLine = deco; css.textDecorationSkipInk = 'none'; css.textDecorationThickness = '0.06em'; }
  if (l?.c) css.color = l.c;
  return css;
}
const lookKey = (l: CharLook | null | undefined) => (l && Object.keys(l).length ? JSON.stringify(l) : '');

/** fill an editing field with text in spans of one size and look each */
export function fillField(root: HTMLElement, text: string, scales?: number[] | null, looks?: (CharLook | null)[] | null,
  base: CharLook = {}, mode: LookMode = 'faux') {
  root.textContent = '';
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const k = scales?.[i] ?? 1, lk = lookKey(looks?.[i]);
    let j = i;
    let part = '';
    while (j < chars.length && (scales?.[j] ?? 1) === k && lookKey(looks?.[j]) === lk) part += chars[j++];
    const span = document.createElement('span');
    span.dataset.k = String(k);
    if (lk) span.dataset.l = lk;
    if (k !== 1) span.style.fontSize = `${k}em`;
    Object.assign(span.style, lookCss(looks?.[i], base, mode));
    span.textContent = part;
    root.appendChild(span);
    i = j;
  }
  // an empty line still needs room for the caret
  if (!chars.length || text.endsWith('\n')) root.appendChild(document.createElement('br'));
}

/** the selection inside a field as code-point offsets (null: not inside) */
export function fieldSelection(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const at = (node: Node, off: number) => {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(node, off);
    const frag = document.createElement('div');
    frag.appendChild(pre.cloneContents());
    return [...readField(frag).text].length;
  };
  const a = at(r.startContainer, r.startOffset), b = at(r.endContainer, r.endOffset);
  return a <= b ? [a, b] : [b, a];
}

/** put the selection (or caret) at code-point offsets */
export function setFieldSelection(root: HTMLElement, a: number, b = a) {
  const find = (target: number): [Node, number] => {
    let left = target;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let last: [Node, number] = [root, 0];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) {
        const cps = [...(n.textContent ?? '')];
        if (left <= cps.length) return [n, cps.slice(0, left).join('').length];
        left -= cps.length;
        last = [n, (n.textContent ?? '').length];
      } else if ((n as HTMLElement).tagName === 'BR' && n.nextSibling) {
        if (left === 0) return [n.parentNode!, Array.prototype.indexOf.call(n.parentNode!.childNodes, n)];
        left -= 1;
      }
    }
    return last;
  };
  const sel = window.getSelection();
  if (!sel) return;
  const r = document.createRange();
  const [sn, so] = find(a), [en, eo] = find(b);
  try { r.setStart(sn, so); r.setEnd(en, eo); } catch { r.selectNodeContents(root); r.collapse(false); }
  sel.removeAllRanges();
  sel.addRange(r);
}

// ----- the line being edited, for the size controls (they act on its selected letters) -----
export interface LineEditor {
  key: string;
  /** size (pt) of the selected letters, null when nothing is selected */
  selSize(): number | null;
  /** give the selected letters this size (pt); false when nothing is selected */
  setSelSize(pt: number): boolean;
  /** the look the selected letters (all letters with `all`) share (a key is left out when they differ); null when nothing is selected */
  selLook(all?: boolean): CharLook | null;
  /** give the selected letters (all letters with `all`) this look; false when nothing is selected */
  setSelLook(p: CharLook, all?: boolean): boolean;
}
let active: LineEditor | null = null;
let version = 0;
const subs = new Set<() => void>();
export function setLineEditor(e: LineEditor | null) { active = e; lineEditorChanged(); }
export function lineEditor(): LineEditor | null { return active; }
export function lineEditorChanged() { version++; subs.forEach((f) => f()); }
/** re-renders when the selection in the edited line changes; returns the selected letters' look */
export function useLineSelLook(key: string | null | undefined): CharLook | null {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return active && key && active.key === key ? active.selLook() : null;
}
/** re-renders when the selection in the edited line changes; returns the selected letters' size */
export function useLineSelSize(key: string | null | undefined): number | null {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return active && key && active.key === key ? active.selSize() : null;
}

/** the look the letters a..b share, over the text's own setting (keys that differ are left out) */
export function sharedLook(text: string, looks: (CharLook | null)[] | undefined, a: number, b: number, base: CharLook): CharLook {
  const cps = [...text];
  const out: CharLook = {};
  let first = true;
  for (let i = a; i < b && i < cps.length; i++) {
    if (cps[i] === '\n') continue;
    const l = looks?.[i];
    const e: CharLook = { b: l?.b ?? !!base.b, i: l?.i ?? !!base.i, u: l?.u ?? !!base.u, s: l?.s ?? !!base.s, c: l?.c ?? base.c };
    if (first) { Object.assign(out, e); first = false; continue; }
    for (const k of ['b', 'i', 'u', 's', 'c'] as const) if (out[k] !== e[k]) delete out[k];
  }
  if (first) Object.assign(out, { b: !!base.b, i: !!base.i, u: !!base.u, s: !!base.s, c: base.c });
  return out;
}
/** the looks with `p` given to the letters a..b (newlines left alone) */
export function withLook(text: string, looks: (CharLook | null)[] | undefined, a: number, b: number, p: CharLook): (CharLook | null)[] {
  const cps = [...text];
  const out = cps.map((_, i) => looks?.[i] ?? null);
  for (let i = a; i < b && i < cps.length; i++) {
    if (cps[i] === '\n') continue;
    const n: CharLook = { ...(out[i] ?? {}), ...p };
    if (p.c === undefined && 'c' in p) delete n.c;
    out[i] = n;
  }
  return out;
}

/**
 * The size and look controls of an editing field (selection = the letters last selected in it).
 * `after` gets what the field holds after a change.
 */
export function fieldEditor(o: {
  key: string; el: () => HTMLElement | null; sel: () => [number, number] | null; baseSize: number;
  base: CharLook; mode: LookMode; after: (c: FieldContent) => void;
}): LineEditor {
  const redo = (c: FieldContent, s: [number, number]) => {
    const el = o.el()!;
    fillField(el, c.text, c.scales, c.looks, o.base, o.mode);
    el.focus({ preventScroll: true });
    setFieldSelection(el, s[0], s[1]);
    o.after(c);
    lineEditorChanged();
  };
  return {
    key: o.key,
    selSize: () => {
      const el = o.el(), s = o.sel();
      if (!el || !s || s[0] === s[1]) return null;
      return Math.round(o.baseSize * (readField(el).scales[s[0]] ?? 1) * 10) / 10;
    },
    setSelSize: (pt) => {
      const el = o.el(), s = o.sel();
      if (!el || !s || s[0] === s[1]) return false;
      const c = readField(el);
      const k = Math.max(0.2, Math.min(8, pt / o.baseSize));
      const cps = [...c.text];
      for (let i = s[0]; i < s[1] && i < c.scales.length; i++) if (cps[i] !== '\n') c.scales[i] = k;
      redo(c, s);
      return true;
    },
    selLook: (all) => {
      const el = o.el(), s = o.sel();
      if (!el || (!all && (!s || s[0] === s[1]))) return null;
      const c = readField(el);
      return all ? sharedLook(c.text, c.looks, 0, [...c.text].length, o.base) : sharedLook(c.text, c.looks, s![0], s![1], o.base);
    },
    setSelLook: (p, all) => {
      const el = o.el(), s0 = o.sel();
      if (!el) return false;
      const c = readField(el);
      const n = [...c.text].length;
      const s: [number, number] | null = all ? [0, n] : s0 && s0[0] !== s0[1] ? s0 : null;
      if (!s) return false;
      c.looks = withLook(c.text, c.looks, s[0], s[1], p);
      redo(c, all ? (s0 ?? [n, n]) : s);
      return true;
    },
  };
}
