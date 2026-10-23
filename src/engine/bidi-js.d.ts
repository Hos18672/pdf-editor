declare module 'bidi-js' {
  interface EmbeddingLevels { levels: Uint8Array; paragraphs: { start: number; end: number; level: number }[] }
  interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl' | 'auto'): EmbeddingLevels;
    getMirroredCharactersMap(text: string, levels: EmbeddingLevels, start?: number, end?: number): Map<number, string>;
    getReorderSegments(text: string, levels: EmbeddingLevels, start?: number, end?: number): [number, number][];
  }
  export default function bidiFactory(): Bidi;
}
