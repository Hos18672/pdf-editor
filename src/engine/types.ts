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
  bgColor: string; // used when the text cannot be removed from the stream, or sits on a scan
  /** colour of the visible ink (for invisible OCR text over a scanned image) */
  fgColor?: string;
  /** free space above / below the baseline (user space) before the neighbouring lines */
  room?: { up: number; down: number };
  /** look of the text printed in a scan; edits on scans are drawn as a matching picture */
  scan?: ScanStyle;
  /** a line recognised on a picture page (its letters are only in the picture) */
  ocr?: boolean;
  /** size of each character (code point of `text`, newlines included) × the line's size; absent: all 1 */
  scales?: number[];
  /** the line moved by this much (PDF user space) */
  offset?: [number, number];
}

export interface ScanStyle {
  family: 'Carlito' | 'Arimo' | 'Tinos' | 'Roboto';
  bold: boolean;
  /** font size / the line's region height */
  sizeRatio: number;
  /** horizontal stretch that matches the scan's letter widths */
  stretch: number;
  /** blur radius / font size */
  blur: number;
  /** how well the font matched (0–1) */
  score: number;
  /** where the printed letters start / sit relative to the text layer (× font size; dy > 0 = lower) */
  dx?: number; dy?: number;
  /** horizontal extent of the printed letters relative to the layer start (× font size) */
  inkX0?: number; inkX1?: number;
  /** reach of the printed letters above / below their baseline (× the layer height) */
  inkUp?: number; inkDown?: number;
}

/** A font embedded in the document, used again for new text. */
export interface DocFont {
  /** pdf.js name of the font (the UI's key) and its name as shown */
  key: string;
  label: string;
  /** its name in the file (without a subset prefix) */
  name?: string;
  /** a line of the document written in it: original page index and region (PDF user space) */
  page: number;
  region: TextEdit['region'];
  /** unicode char -> char code, for the letters the font has */
  charMap: Record<string, number>;
  /** CSS font-family list that shows it on screen */
  css: string;
  /** baseline below the top of a line (× font size, line height 1.2) */
  base: number;
  /** every letter it (and other pieces of the same font on that page) can write */
  chars: string;
  /** the shipped font that writes the letters it lacks */
  match: import('./matchFonts').MatchFont;
  /** size of the shipped font that gives the same letter height (× font size) */
  matchScale?: number;
}

interface Base {
  id: string;
  page: number; // original page index
  x: number; // viewport coords at scale 1 (y down)
  y: number;
  w: number;
  h: number;
  opacity?: number;
  /** clockwise turn around the box centre, degrees (lines turn their end points instead) */
  rot?: number;
}

export type EditorObject =
  /** typed text: a standard font (family), or a font of the document (font) with the family as stand-in for letters it lacks */
  | (Base & { type: 'text'; text: string; family: FontFamily; size: number; color: string; bold: boolean; italic: boolean; font?: DocFont })
  | (Base & { type: 'image' | 'signature'; src: string })
  | (Base & { type: 'rect' | 'ellipse'; stroke: string; fill: string | null; strokeWidth: number })
  | (Base & { type: 'whiteout'; fill: string })
  /** black box: what is under it is removed from the file (text, picture pixels) */
  | (Base & { type: 'redact' })
  /** a highlight, or (style) a line under / through the text */
  | (Base & { type: 'highlight'; fill: string; style?: 'underline' | 'strike' })
  | (Base & { type: 'line'; stroke: string; strokeWidth: number; x2: number; y2: number; arrow?: boolean })
  /** a clickable area: a web address, or a page of the document (original index) */
  | (Base & { type: 'link'; url: string; target?: number })
  | (Base & { type: 'draw'; stroke: string; strokeWidth: number; points: number[] }) // relative to x,y
  | (Base & { type: 'mark'; kind: 'check' | 'cross' | 'dot'; color: string });

/** Form field values by fully qualified field name: text/choice = string, checkbox = boolean, radio = export value */
export type FormValues = Record<string, string | boolean>;

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
  forms?: FormValues;
  /** turn form fields into plain page content */
  flatten?: boolean;
  /** recognised lines of picture pages: saved as an invisible (searchable) text layer */
  ocrLayer?: Record<number, import('./textLayer').LayerLine[]>;
  /** lines of an invisible text layer that were read again (e.g. split into table cells): removed */
  dropText?: Record<number, TextEdit['region'][]>;
  /** text edits on scans / picture pages drawn with the page's own letters (null: not possible) */
  scanImage?: (e: TextEdit) => Promise<ClonedText | null>;
  /** bytes of a shipped font (public/fonts/match/<file>) for letters a document font lacks */
  matchFont?: (file: string) => Promise<Uint8Array>;
  /** table borders and other rules of a page (viewport units): covers over edited lines keep them */
  rules?: (page: number) => Promise<{ x: number; y: number; w: number; h: number; color: string }[]>;
  /**
   * the page under a cover (viewport units) with the old letters filled in from the background around
   * them, as a picture placed over `x, y, w, h` (null: not available, a flat paper colour is used)
   */
  coverImage?: (page: number, rect: { x: number; y: number; w: number; h: number }, lineH: number, bg: string, fg: string) => Promise<{ png: Uint8Array; x: number; y: number; w: number; h: number } | null>;
}

/** Replacement text for a line of a scan, as a picture made of the page's own letters. */
export interface ClonedText {
  png: Uint8Array;
  /** size of the picture and where its corner sits relative to the text layer's baseline start (pt) */
  w: number; h: number; left: number; below: number;
  /** printed letters of the original line, for the cover (× the line's layer height; dy > 0 = lower) */
  inkX0: number; inkX1: number; dy: number;
  /** how far the printed letters reach above / below their baseline (× the layer height) */
  inkUp?: number; inkDown?: number;
}
