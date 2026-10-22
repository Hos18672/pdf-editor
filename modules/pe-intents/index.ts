import { requireOptionalNativeModule } from 'expo';

export interface IncomingFile { uri: string; name: string; mime: string | null; size: number | null }
export interface Incoming {
  /** open: a PDF; import: other files or text (turn into a PDF, then edit); convert: the "Convert to PDF" share entry;
   *  scan / open / sign / convert (no files): a shortcut or widget button */
  mode: string;
  files: IncomingFile[];
  text: string | null;
  subject: string | null;
}

interface PeIntentsModule {
  takeIntent(): Incoming | null;
  readUri(uri: string): Promise<string>;
  refreshShortcuts(): void;
  addListener(event: 'onIntent', fn: () => void): { remove(): void };
}

export const PeIntents = requireOptionalNativeModule<PeIntentsModule>('PeIntents');
