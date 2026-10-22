import { useCallback, useReducer } from 'react';
import type { EditorObject, PageState, FontFamily, FormValues } from '../engine/types';

export type Tool =
  | 'edit' | 'fill' | 'text' | 'sign' | 'image' | 'whiteout' | 'redact' | 'highlight' | 'underline' | 'strike' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'draw' | 'link';

export interface RunEdit {
  text: string;
  sizeScale: number;
  color: string | null;
}

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
