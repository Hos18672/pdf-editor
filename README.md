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
- Undo / redo, zoom (buttons, Ctrl+wheel, pinch on touch).
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
  exporter.ts            writes edits and new objects with pdf-lib
public/pdfjs, public/fonts   bundled pdf.js and UI/signature fonts (works offline)
```

On the web the editor renders directly; on Android it runs in a WebView
(Expo DOM component) and calls native functions to pick and save/share files.

Rendering uses pdf.js 3.11; writing uses pdf-lib.

## Known limits (next steps)

- Editing works line by line; paragraphs don't reflow yet.
- Subset fonts only contain the glyphs the document already used, so new
  characters use a standard font (flagged in the UI).
- Persian/Arabic: existing text renders fine, but typing new right-to-left text
  needs a shaping step and a Unicode fallback font (planned).
- Text inside form XObjects is covered and rewritten rather than removed.
- Password-protected PDFs must be unlocked first.
