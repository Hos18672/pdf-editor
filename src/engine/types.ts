import type { M } from './interpreter';
export type { M };

export type FontFamily = 'Helvetica' | 'Times' | 'Courier';

/** An edit of text that already exists in the PDF. Region is in PDF user space. */
export interface TextEdit {
  page: number; // original page index
  key: string;
  region: { o: [number, number]; u: [number, number]; width: number; height: number };
  text: string; // '' = delete
  sizeScale: number;
  color: string | null; // hex override, null = keep original colour
  /** unicode char -> char code in the original font (only glyphs that exist in it) */
  charMap: Record<string, number>;
  fallback: { family: FontFamily; bold: boolean; italic: boolean };
  bgColor: string; // used only when the text cannot be removed from the stream
}

interface Base {
  id: string;
  page: number; // original page index
  x: number; // viewport coords at scale 1 (y down)
  y: number;
  w: number;
  h: number;
  opacity?: number;
}

export type EditorObject =
  | (Base & { type: 'text'; text: string; family: FontFamily; size: number; color: string; bold: boolean; italic: boolean })
  | (Base & { type: 'image' | 'signature'; src: string })
  | (Base & { type: 'rect' | 'ellipse'; stroke: string; fill: string | null; strokeWidth: number })
  | (Base & { type: 'whiteout'; fill: string })
  | (Base & { type: 'highlight'; fill: string })
  | (Base & { type: 'line'; stroke: string; strokeWidth: number; x2: number; y2: number })
  | (Base & { type: 'draw'; stroke: string; strokeWidth: number; points: number[] }); // relative to x,y

export interface PageState {
  src: number; // original page index
  rotation: number; // extra rotation in degrees (0/90/180/270)
}

export interface ExportInput {
  bytes: Uint8Array;
  pages: PageState[];
  objects: EditorObject[];
  edits: TextEdit[];
  /** user space -> viewport (scale 1, original rotation) for each original page */
  viewMatrices: Record<number, M>;
}
