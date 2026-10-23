// The editing field of a line of the PDF's own text: an editable element whose letters can have
// sizes of their own (select a word or a letter, then change its size). The text is plain: one span
// per stretch of letters of one size (`data-k`, × the line's size, in em so the line's size scales all).
import { useSyncExternalStore } from 'react';

/** the text and per-letter sizes (one per code point, newlines included) shown in an editing field */
export function readField(root: HTMLElement): { text: string; scales: number[] } {
  let text = '';
  const scales: number[] = [];
  const kOf = (n: Node) => {
    for (let e: Node | null = n.parentNode; e && e !== root; e = e.parentNode) {
      const k = (e as HTMLElement).dataset?.k;
      if (k) return +k || 1;
    }
    return 1;
  };
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = (n.textContent ?? '').replace(/​/g, '').replace(/\r/g, '');
      const k = kOf(n);
      for (const ch of t) { text += ch; scales.push(k); }
      return;
    }
    const el = n as HTMLElement;
    if (el.tagName === 'BR') {
      // a lone <br> that only keeps an empty line open counts once
      if (el.nextSibling || !el.parentNode || el.parentNode === root) { text += '\n'; scales.push(kOf(el)); }
      return;
    }
    // block elements some browsers put in for new lines
    if ((el.tagName === 'DIV' || el.tagName === 'P') && !first && text && !text.endsWith('\n')) { text += '\n'; scales.push(1); }
    el.childNodes.forEach((c, i) => walk(c, i === 0));
  };
  root.childNodes.forEach((c, i) => walk(c, i === 0));
  // a trailing newline the browser keeps for the caret
  if (text.endsWith('\n') && root.lastChild?.nodeName === 'BR') { text = text.slice(0, -1); scales.pop(); }
  return { text, scales };
}

/** fill an editing field with text in spans of one size each */
export function fillField(root: HTMLElement, text: string, scales?: number[]) {
  root.textContent = '';
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    const k = scales?.[i] ?? 1;
    let j = i;
    let part = '';
    while (j < chars.length && (scales?.[j] ?? 1) === k) part += chars[j++];
    const span = document.createElement('span');
    span.dataset.k = String(k);
    if (k !== 1) span.style.fontSize = `${k}em`;
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
}
let active: LineEditor | null = null;
let version = 0;
const subs = new Set<() => void>();
export function setLineEditor(e: LineEditor | null) { active = e; lineEditorChanged(); }
export function lineEditor(): LineEditor | null { return active; }
export function lineEditorChanged() { version++; subs.forEach((f) => f()); }
/** re-renders when the selection in the edited line changes; returns the selected letters' size */
export function useLineSelSize(key: string | null | undefined): number | null {
  useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => version);
  return active && key && active.key === key ? active.selSize() : null;
}
