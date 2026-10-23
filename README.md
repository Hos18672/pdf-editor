# PDF Editor (web + Android)

A Sejda-style PDF editor built with Expo / React Native. One codebase runs as a
responsive web app and as an Android app.

## What it does

- **Edit existing text in its original font.** Click any line, retype it. The
  old glyphs are removed from the page's content stream and the new text is
  written with the *same embedded font resource*, size, colour, spacing and
  rotation. Characters the embedded (subset) font doesn't contain fall back to
  the closest standard font for just those characters, and the panel tells you which ones.
- Change size / colour of existing text, or delete it.
- Add text, images, signatures (draw, type or upload — white background removed,
  saved on the device), whiteout, highlights, boxes, circles, lines, freehand drawing.
- Move / resize / duplicate / delete anything you added.
- Organize pages: rotate, reorder, delete.
- Clicking existing text always edits it (with the Edit and Add-text tools). While typing, the
  embedded font is re-registered with a Unicode cmap, so the edit box shows the document's own
  glyphs at the exact size, colour and baseline.
- Added objects have a move grip (works while typing) and a toolbar with Edit / Duplicate / Delete.
- Undo / redo, zoom (buttons, Ctrl+wheel, two-finger pinch + pan on touch, anchored under the fingers).
- Everything runs on the device; the file is never uploaded.

## Run it

```bash
npm install
npx expo start --web        # web
npx expo run:android        # Android (development build — needs Android SDK)
```

Production builds:

```bash
npx expo export -p web                        # static site in dist/
npx eas-cli@latest build -p android --profile preview   # APK via EAS cloud build
```

Engine test (edits a sample PDF and prints the text before/after):

```bash
npm run test:engine
```

## How it is built

```
src/app/                 Expo Router screen (native shell: file picker, save/share)
src/components/PdfEditorDom.tsx   'use dom' component — the whole editor
src/ui/                  Editor UI (React DOM): pages, tools, panels, signature pad
src/engine/              PDF engine (pure TS, no DOM)
  contentStream.ts       lossless content-stream tokenizer / rewriter
  interpreter.ts         tracks text state, finds every glyph's position; removes glyphs
  fonts.ts               glyph widths from the PDF font dictionaries
  pdfText.ts             pdf.js text runs + which characters each embedded font can draw
  sfnt.ts                rewrites a font's cmap to Unicode (for typing in the original font)
  exporter.ts            writes edits and new objects with pdf-lib
public/pdfjs, public/fonts   bundled pdf.js and UI/signature fonts (works offline)
```

On the web the editor renders directly; on Android it runs in a WebView
(Expo DOM component) and calls native functions to pick and save/share files.

Rendering uses pdf.js 3.11; writing uses pdf-lib.

## Scanner

Camera or photos → page found and straightened → cleaned (Magic, Photo, Grey, B/W …) → PDF at real
paper size, optionally searchable (Tesseract, German + English). Everything runs on the device,
in Web Workers inside the app's WebView (`src/ui/scan/`):

```
detect.ts, bend.ts     find the page's corners and follow curved sides
kernels.ts             perspective + curved-side warp, straightening of printed lines, blur removal, looks
dewarp.ts, aiWorker.ts AI flattening of curved pages (UVDoc model, onnxruntime-web on WebAssembly)
engine.ts, Scanner.tsx jobs, caching, the review screen
```

**AI flattening.** Pages that look bent (curved sides, or printed lines that wander) get a second
opinion from [UVDoc](https://github.com/tanguymagne/UVDoc) (MIT; 7.9 M parameters, weights stored
as 16-bit floats in `public/scan/uvdoc.onnx`, 15 MB; WebAssembly runtime `ort.wasm`, 14 MB, copied
from `onnxruntime-web` by `node scripts/build-worker.mjs`). The model only moves existing pixels
(never draws), its map is pinned to the page outline, and it is used only if the printed lines come
out straighter; otherwise the classical result stays. In the review screen a page that got it shows
**Flattened**, which switches it off and on. Flat pages never load the model. If the model can't run,
scanning works as before.

The model was trained on the UVDoc dataset and Doc3D. Doc3D's terms of use aren't clearly published,
so check the licensing before commercial distribution.

Benchmark with synthetic photos, OCR scoring and an emulator test: `test/scan-bench/README.md`.

## Known limits (next steps)

- Editing works line by line; paragraphs don't reflow yet.
- Subset fonts only contain the glyphs the document already used, so new
  characters use a standard font (flagged in the UI).
- Text inside form XObjects is covered and rewritten rather than removed.
- Password-protected PDFs must be unlocked first.
