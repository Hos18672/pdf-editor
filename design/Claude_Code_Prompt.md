# Prompt for Claude Code — PDF Editor redesign + new tools

Copy everything below the line into Claude Code, run it from the root of the `pdf-editor` repo, and put this project's exported design files in `design/` in that repo (download the project as a zip and unzip it there).

---

You're updating my web app **PDF Editor** (live at https://hos18672.github.io/pdf-editor/, also packaged as an Android app). It's a browser-only PDF editor; **files must never leave the device**: no uploads, no server calls, no analytics on file contents. Implement the redesign in `design/` and add the new tools listed below.

## 0. Before writing code
1. Explore the repo: framework, build, how PDFs are rendered (pdf.js?) and written (pdf-lib?), how text editing, objects, undo/redo, zoom and the Android wrapper work. Summarize this for me in a few lines.
2. Open these design files in a browser and treat them as the visual spec. Each `.dc.html` opens directly; the editor and tools files have `bp` and `screen` switches in their Tweaks panel:
   - `design/PDF Editor Redesign.dc.html`: overview of every screen at 390 / 820 / 1440 / 1920
   - `design/Design System.dc.html`: tokens, components, interaction notes
   - `design/Start.dc.html`, `Editor.dc.html`, `PropsPanel.dc.html`, `SignaturePanel.dc.html`, `PdfPage.dc.html`, `Tools.dc.html`
3. Propose a short plan (files to add or change, libraries to add) and wait for my OK only if you need to replace the core rendering or editing approach. Otherwise go ahead.
4. Keep every existing feature working. Don't rewrite working PDF logic just to restyle it.

## 1. Design system (build first, as CSS custom properties + reusable components)
**Style: "paper on a desk".** The document is the hero; the chrome stays quiet.

Colours (light):
- `--ink` #1E2559 (primary actions); `--ink-hover` #2B3478; `--sel` #3446C9 (selection, focus ring)
- `--marker` #FFE14D (active tool, with navy glyphs); `--marker-100` #FFF4B8 (hover)
- `--desk` #ECEEF3 (workspace background); `--surface` #FFFFFF; `--surface-2` #F5F6F9; `--line` #E1E4EB
- `--text` #151833; `--muted` #5D637A; `--danger` #B83227; `--success` #1E7A4C

Dark theme (follows `prefers-color-scheme`, with a manual toggle):
- desk #0F1118, surface #191C27, surface-2 #222635, line #2D3245
- text #ECEEF6, muted #9CA2BA
- ink #B4BDFF (text on ink #0F1118), sel #8E9BFF, danger #FF8A7E, success #5BD69A
- Marker stays yellow; **PDF pages stay white**.

Type: **Schibsted Grotesk** (400/500/600/700). Scale:
- Display 40/44 bold, −0.025em
- Title 24/30 bold
- Heading 17/24 semibold
- Body 15/22
- Label 13/18 medium
- Micro 11/14 semibold, uppercase, +0.06em

Use tabular numbers for zoom, counters and page numbers. Never go below 12px.

Spacing 4/8/12/16/24/32/48/64. Radii: 3 for paper, 6 for chips, 10 for buttons, 14 for panels, 20 for sheets and modals.

Shadows:
- page: `0 1px 2px rgba(20,23,46,.06), 0 10px 30px rgba(20,23,46,.10)`
- panel: `0 2px 8px rgba(20,23,46,.08), 0 0 0 1px rgba(20,23,46,.04)`
- overlay: `0 16px 48px rgba(20,23,46,.20)`

Icons: Phosphor. Use regular at 18–20px in bars and toolbars; the rail and dock use the duotone set at 22px, with the active tool shown filled on yellow.

Components to build once and reuse:
- Buttons: primary, secondary, ghost, danger
- Icon button: 44px; states for hover, disabled and focus ring (2px `--sel`, 2px offset)
- Tool rail and dock item, with an animated marker fill
- Floating object toolbar: navy pill containing move handle | size − value + | duplicate | delete
- Bottom sheet, modal, segmented tabs, colour swatches, size stepper, toggle, toast

Motion:
- Tool switch: 180ms ease-out
- Panels and sheets: rise 8px and fade in, 220–260ms; close in 160ms
- Toasts: slide up from the bottom, auto-dismiss after 4s
- `prefers-reduced-motion`: opacity only

Accessibility:
- Text contrast at least 4.5:1; touch targets at least 44px
- Full keyboard support
- `aria-label` on every icon button; `aria-pressed` on tools

## 2. Layout per breakpoint
- **Mobile (<600px):**
  - Compact top bar: back, file name with page count and change count, undo, redo, round Download button.
  - Tools sit in a horizontally scrollable bottom dock, reachable with the thumb.
  - While editing text, the dock becomes a slim properties bar above the keyboard; a caret expands it into a half sheet.
  - Auto-scroll so the edited line sits in the top third. **Never cover the text being edited.**
  - Dialogs are bottom sheets. Respect safe-area insets.
- **Tablet (600–1099px):**
  - Full top bar with a left tool rail.
  - Properties float as a card bottom-right; move it bottom-left if it would overlap the selection.
- **Desktop (1100–1599px):**
  - Top bar (with zoom pill − % + and fit width), left tool rail (84px).
  - Page centred on the desk.
  - Right properties panel (320px) showing the current selection, or the list of changes when nothing is selected.
- **Large (≥1600px):** add a page-thumbnail column next to the rail. The page grows to at most about 780–820px wide; use the extra width for panels, never stretch.

## 3. Screens: restyle what exists
1. **Start:** open or drop a PDF, short value proposition, privacy note "Processed on your device", recent files if you already store any, and a "More tools" entry to the new tools hub.
2. **Editor workspace:**
   - Tools: Edit, Fill form (new), Add text, Sign, Image, Whiteout, Highlight, Shapes, Draw, Pages.
   - The top bar shows the change count.
3. **Edit existing text:**
   - Inline editor in place on the line: navy 2px ring plus a soft halo, caret where the user tapped.
   - Properties: font name, size stepper, colour swatches, Restore original, Delete.
4. **Selected added object:**
   - Blue outline with corner dots and a resize knob.
   - The floating toolbar sits 12px above the object and flips below it near the top of the page.
   - Hide the size stepper for images.
5. **Signature dialog:**
   - Saved signatures, Draw / Type / Upload tabs, ink colours.
   - "Save on this device" (localStorage or IndexedDB), Clear, and Place signature.
6. **Pages organizer:** thumbnail grid with drag to reorder, rotate, delete and multi-select.
7. **States:**
   - Opening (progress), preparing download, success toast.
   - Error: password-protected PDF (offer a password field, unlock locally) or invalid PDF.
   - Empty state.

## 4. Interactions (see "Interaction notes" in the design system)
- **Selection:**
  - Tap or click selects; tapping empty paper or pressing Esc deselects.
  - Delete/Backspace removes; Ctrl/⌘+D duplicates with an 8px offset.
  - Arrow keys move 1pt, Shift+arrow 10pt. Shift-click multi-selects on desktop.
- **Dragging:**
  - Drag starts after 4px of travel.
  - The toolbar hides while dragging.
  - Snap guides to the page centre and margins within 6px.
  - Resize keeps aspect ratio for images and signatures (Alt frees it).
- **Zoom:**
  - Pinch zooms around the midpoint between the fingers; two-finger pan.
  - Double-tap toggles fit-width and 200%.
  - Ctrl/⌘+wheel zooms at the cursor; Ctrl+0 fits width.
  - Range 25–400%.
  - Handles keep a constant screen size at every zoom level.
  - One-finger drag on the desk scrolls (except while Draw is active).

## 5. New features (see sections 09–14 in the overview, `Tools.dc.html`)
Each one is a route or view reachable from the **All tools** hub, which groups tools into Edit & sign, Organize pages and Convert to PDF. Each tool's main action sits in the right panel on desktop and in a sticky bottom bar on mobile.

1. **Fill a form:**
   - For AcroForm PDFs, detect fields (pdf-lib `getForm()`; render widgets with the pdf.js annotation layer, or your own overlay).
   - Support text, multiline, date, checkbox, radio, dropdown/list and signature fields.
   - Tint fields so they read as tappable; the active field gets the selection ring.
   - Panel shows a field list with filled/active/empty status, an "x of y filled" progress bar, and Previous / Next field. Tab moves through fields.
   - Mobile: a navy field navigator above the keyboard (prev / next / field name / Done), and the page scrolls so the field stays visible.
   - For flat forms with no fields: tap to place a tick, cross, dot, text or date mark.
   - "Flatten on download" toggle. Keep values in the undo history.
2. **Combine PDFs:**
   - Add several PDFs and images; drag to reorder; per-file page range ("All pages" or "1–3").
   - Remove a file. Output file name. Option to add a bookmark for each file.
   - Use pdf-lib `copyPages`.
3. **Extract pages:**
   - Grid with a checkbox on each page and a range input ("1–2, 5"); Select all.
   - Output as one PDF, or one PDF per page as a .zip (JSZip). The original stays unchanged.
4. **Remove pages:**
   - Same grid; the Extract/Remove switch sits at the top.
   - Selected pages are marked red; show "8 → 6 pages". Undoable.
5. **Insert pages:**
   - A "+" in each gap between pages; the chosen gap becomes a dashed "New page" slot.
   - Options: blank page (Match / A4 / Letter, count), pages from another PDF, images (one page each), and camera scan in the Android app only (use the wrapper's camera API).
6. **Convert to PDF, entirely on device:**
   - Images: JPG, PNG, WebP, HEIC (use `heic2any`).
   - Word: DOCX via `mammoth` (HTML), then laid out to PDF.
   - Excel: XLSX, XLS, CSV, ODS via SheetJS, one table per sheet.
   - PowerPoint: PPTX via a client-side parser; one slide per page.
   - Text, Markdown and HTML.
   - Options: page size (Fit content / A4 / Letter), orientation, margins, and "Combine into one PDF".
   - A queue with status per file: ready (preview), converting (progress), waiting, unsupported (retry).
   - Show the honest note that complex Office layouts can shift.
   - Load converters lazily (dynamic import) so the editor stays fast.
   - If a format can't be done well client-side, tell me and stub it as "not supported yet" instead of uploading anything.

## 6. Constraints and done criteria
- No network requests involving file data. Lazy-load heavy libraries. Works offline after first load (add or keep a service worker) and inside the Android WebView.
- Test at 390, 820, 1440 and 1920 widths, in light and dark themes, with:
  - a text PDF (edit a line)
  - a fillable form
  - a password-protected PDF
  - a 50+ page PDF (check scrolling performance)
- Keep commits small and logical: design system → layout shell → editor screens → organizer → each new tool.
- At the end, list what you changed, the libraries you added and their size, and anything you couldn't do on device.
