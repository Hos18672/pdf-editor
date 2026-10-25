import { useCallback, useReducer } from 'react';
import type { EditorObject, PageState, FontFamily, FormValues, Looks, CharLook } from '../engine/types';

export type Tool =
  | 'edit' | 'fill' | 'text' | 'sign' | 'image' | 'whiteout' | 'redact' | 'highlight' | 'underline' | 'strike' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'link' | 'remove';

export interface RunEdit {
  text: string;
  sizeScale: number;
  color: string | null;
  /** size of each character (code point of `text`) × sizeScale; absent: all the same */
  scales?: number[];
  /** look of each character where it differs from the line (bold, italic, underline, strike, colour) */
  looks?: Looks;
  /** the line moved on its page (viewport units at zoom 1) */
  dx?: number; dy?: number;
}

/** per-character sizes worth keeping (null when they are all 1 or don't fit the text) */
export function cleanScales(text: string, scales?: number[] | null): number[] | undefined {
  if (!scales || scales.length !== [...text].length || scales.every((k) => Math.abs(k - 1) < 1e-3)) return undefined;
  return scales.map((k) => Math.round(k * 1000) / 1000);
}

/**
 * per-character looks worth keeping: keys equal to the text's own setting (base) are dropped;
 * undefined when nothing is left or they don't fit the text
 */
export function cleanLooks(text: string, looks?: Looks | null, base: CharLook = {}): Looks | undefined {
  const n = [...text].length;
  if (!looks || looks.length !== n) return undefined;
  let any = false;
  const out = looks.map((l) => {
    if (!l) return null;
    const o: CharLook = {};
    for (const k of ['b', 'i', 'u', 's'] as const) if (l[k] !== undefined && !!l[k] !== !!base[k]) o[k] = !!l[k];
    if (l.c && l.c.toLowerCase() !== (base.c ?? '').toLowerCase()) o.c = l.c;
    if (!Object.keys(o).length) return null;
    any = true;
    return o;
  });
  return any ? out : undefined;
}
export const sameLooks = (a?: Looks | null, b?: Looks | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface Snapshot {
  pages: PageState[];
  objects: EditorObject[];
  edits: Record<string, RunEdit>;
  forms: FormValues;
}

export interface ToolStyle {
  color: string;
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  fontSize: number;
  family: FontFamily;
  highlight: string;
  /** underline / strike-through colour */
  ink: string;
  /** new text takes the font, size and colour of the page's text next to it */
  match: boolean;
  /** Remove: the brush's radius (pt) */
  removeSize: number;
}

interface State {
  present: Snapshot;
  past: Snapshot[];
  future: Snapshot[];
}

type Action =
  | { type: 'reset'; pages: PageState[] }
  | { type: 'commit'; fn: (s: Snapshot) => Snapshot; merge?: boolean }
  | { type: 'undo' }
  | { type: 'redo' };

const empty: Snapshot = { pages: [], objects: [], edits: {}, forms: {} };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'reset':
      return { present: { ...empty, pages: a.pages }, past: [], future: [] };
    case 'commit': {
      const next = a.fn(s.present);
      if (next === s.present) return s;
      if (a.merge) return { ...s, present: next };
      return { present: next, past: [...s.past.slice(-80), s.present], future: [] };
    }
    case 'undo':
      if (!s.past.length) return s;
      return { present: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.present, ...s.future] };
    case 'redo':
      if (!s.future.length) return s;
      return { present: s.future[0], past: [...s.past, s.present], future: s.future.slice(1) };
  }
}

export function useHistory() {
  const [state, dispatch] = useReducer(reducer, { present: empty, past: [], future: [] });
  const commit = useCallback((fn: (s: Snapshot) => Snapshot, merge = false) => {
    dispatch({ type: 'commit', fn, merge });
  }, []);
  return {
    snap: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    commit,
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    reset: (pages: PageState[]) => dispatch({ type: 'reset', pages }),
    past: state.past.length,
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);
