# Prompt for Claude Code: design-only upgrade (no feature changes)

**Before you start:**
1. Download this project as a zip.
2. Unzip it into `design/` at the root of the `pdf-editor` repo.
3. Run Claude Code from the repo root and paste in everything below the line.

---

Upgrade the **visual design only** of my web app PDF Editor (https://hos18672.github.io/pdf-editor/, also packaged as an Android WebView app) to match the redesign in `design/`.

## Hard rules (read first)
- **Do not remove, rename or change any function, tool, feature, setting, route, keyboard shortcut or behaviour.** Every tool that exists today must still exist and work the same way.
- **Do not touch PDF logic:**
  - loading, rendering, text editing and font matching
  - objects, undo/redo, zoom and export
  - storage
  - the Android bridge
- Only change markup structure where a layout needs it, plus styles, icons, animations and copy for labels and states.
- If the design shows a tool or screen the app doesn't have yet, **skip it**. Don't add features in this pass; list what you skipped at the end.
- If the design is missing a tool the app has, **keep the tool** and style it to match its neighbours.
- Keep all existing element IDs, `data-*` hooks, event handlers and test selectors. If you must move an element, move it with its handlers intact.
- Files never leave the device. Add no network calls.
- **Before committing each step:** open the app, load a PDF, and click through every tool to confirm nothing broke.

## 0. Explore first
1. Map the repo for me in a few lines:
   - framework and build
   - where the styles live
   - every UI component: start screen, top bar, tool bar or menu, properties panel, floating object toolbar, dialogs, pages organizer, toasts and loading states
2. **Make a checklist** of every tool and action currently in the UI (buttons, menu items, shortcuts, gestures). I'll use it to check nothing went missing.
3. Open the design files in a browser; they are the visual spec. Each `.dc.html` opens directly, and the Tweaks panel switches breakpoint and screen. Read the inline styles for exact values.
   - `design/PDF Editor Redesign.dc.html`: overview of every screen. Newer sections win where they overlap:
     - **17–19 (Phone and Tablet v3)** for phones and tablets
     - **15–16 (Start v2, Editor menu v2)** for desktop and large screens
     - **01–08** for everything else
   - `design/Design System.dc.html`: tokens, components and interaction notes
   - Supporting files: `design/Mobile v3.dc.html`, `Start v2.dc.html`, `Editor Menu v2.dc.html`, `Editor.dc.html`, `PropsPanel.dc.html`, `SignaturePanel.dc.html`

## 1. Tokens (CSS custom properties)
**Colours:**
- Ink and accent:
  - `--ink` #1E2559 · `--ink-hover` #2B3478
  - `--sel` #3446C9 (selection, focus)
  - `--marker` #FFE14D (active tool) · `--marker-100` #FFF4B8
- Surfaces and text:
  - `--desk` #ECEEF3 · `--surface` #FFF · `--surface-2` #F5F6F9 · `--line` #E1E4EB
  - `--text` #151833 · `--muted` #5D637A
- Status:
  - `--danger` #B83227 · `--success` #1E7A4C
- Tool-group tints:
  - Change #DDE2FF · Add #FFF1A8
  - Mark up #FCE3D8 · Document #E3F1E9

**Dark theme:** follows `prefers-color-scheme`, plus a manual toggle.
- desk #0F1118 · surface #191C27 · surface-2 #222635 · line #2D3245
- text #ECEEF6 · muted #9CA2BA
- ink #B4BDFF
- Marker stays yellow, and PDF pages stay white.

**Type:** Schibsted Grotesk 400–800.
- Headlines: 800 weight, −0.045em tracking.
- Labels: 600 weight.
- Use tabular numbers for zoom and page counters.
- Never set text below 12px.

**Radii:**
- 3px for PDF pages
- 14–16px for buttons and inputs
- 18–20px for tool items and tiles
- 22–24px for floating bars and strips
- 26–30px for the tool tray and rail
- 28–32px for cards and sheets
- 999px for pills

**Shadows:**
- resting: `0 1px 2px rgba(20,23,46,.06), 0 0 0 1px rgba(20,23,46,.05)`
- floating: `0 18px 48px rgba(20,23,46,.14)`
- tray: `0 18px 44px rgba(30,37,89,.36)`

**Desk texture:** a dot grid, `radial-gradient(#C9CEDB 1px, transparent 1px)` at 22px, 50–55% opacity.

**Icons:** Phosphor.
- Regular weight in bars.
- Fill weight for the active tool.
- Duotone weight for tiles.
- Map each existing tool to the closest Phosphor icon, keeping its meaning.

## 2. Phones (<600px): match sections 17–18
- **Floating top islands** (no full-width bar):
  - a round back button
  - a pill with the file name, the page count and a yellow-dot "N edits"
  - round undo and redo buttons
  - a round navy Download button
  - Everything 44px, translucent white with `backdrop-filter: blur(12px)`, and respecting the top safe area.
- **The page runs edge to edge** on the desk, with a slim page scrubber and a "1 / 4" pill on the right edge.
- **Navy "pencil tray" at the bottom:**
  - 76px tall, 30px radius, 12px side insets, above the gesture bar (respect safe-area insets).
  - The active tool rises 16px out of the tray as a yellow chip with a 4px navy ring.
  - Show your most-used tools plus **More**. More opens an "All tools" sheet listing **every** existing tool as rounded tiles, grouped Change / Add / Mark up / Document, with search.
  - **Every current tool must stay reachable within two taps.**
- **Tool options:** a white strip just above the tray (colours, styles, opacity).
- **Editing existing text:**
  - The tray hides and the page scrolls or zooms so the edited line sits above the keyboard.
  - A slim white properties bar is docked to the keyboard: font chip, size − / +, colour, and a "…" button for Restore original / Delete.
- **Selected object:** the existing floating toolbar is restyled navy with 44px buttons. Keep exactly the actions it has today; resize knob 30px.
- **Sheets:**
  - Signature: saved signatures, Draw / Type / Upload, ink colours, stroke width, Save on this device, Clear, Place signature.
  - All tools.
  - Password for a locked PDF.
  - Errors.
  - Sheets have 32px top radius and a drag handle.
- **Pages organizer:**
  - 3-column grid with a "…" menu per page.
  - While dragging, show a yellow insertion marker.
  - A navy bottom tray holds the actions that exist today (e.g. Rotate / Delete).
- **States:**
  - **Opening:** a page skeleton with shimmer and a yellow scan line, plus a progress pill showing real progress.
  - **Download:** the tray becomes the progress bar, then a "Saved" toast with Android Share if the app already supports sharing.
- **Home/start:**
  - Logo row and theme toggle.
  - Headline "Edit any PDF. / Right here." with a yellow marker underline.
  - Navy "Open a PDF" card with a yellow "Choose file" button.
  - Recent files and tool tiles, if those exist today.
  - The privacy note "Files stay on this phone".

## 3. Tablets (600–1199px): match section 19
- **Portrait:**
  - Top island bar: back, file and changes pill, undo/redo, zoom, Download.
  - A wide bottom tray showing all tools with labels.
  - A floating page-thumbnail rail on the right.
  - The text properties bar is docked above the keyboard.
  - Signature and password dialogs are centred cards.
- **Landscape:** the tray stands vertically on the left; tool options open beside it and never cover the page.

## 4. Desktop and large (≥1200px): match sections 15–16
- **Floating rounded top bar:** file name, changes pill, undo/redo, zoom pill, navy Download.
- **Floating rounded tool rail on the left:**
  - Vertically centred with `top:0; bottom:0; margin:auto 0; height:max-content`, **not** a transform.
  - Grouped with hairlines. The active tool is a yellow chip.
  - Tools with options open a flyout beside the rail.
- Keep the right properties panel and the optional thumbnail column if the app has them. The page is centred, with a maximum width of about 780px.
- **Start screen (Start v2):**
  - Large headline with an animated marker stroke.
  - Rounded drop card with a moving dashed border.
  - Tool chips.
  - A decorative live-demo illustration with `aria-hidden`.
  - Drag-over state: navy with a yellow glow.
  - Opening state: scan line and real progress.

## 5. Motion
- **Easing:** `cubic-bezier(.2,.8,.2,1)`.
- **Timings:**
  - tool switch 180–280ms
  - strips and flyouts 260ms
  - sheets rise in 340ms
  - toasts slide up and dismiss after 4s
- **Loading:** shimmer 1.4s linear; the scan line loops.
- **Reduced motion:** with `prefers-reduced-motion`, stop the loops and fall back to opacity-only transitions.
- **CSS only:** no animation libraries.

## 6. Accessibility
- Touch targets at least 44px.
- Text contrast at least 4.5:1.
- `aria-label` on every icon button; `aria-pressed` on tools.
- Focus ring: 2px `--sel` with a 2px offset.
- The keyboard still works everywhere it does today.

## 7. Process and done criteria
**Commit order** (small commits):
1. tokens
2. phone shell (islands, tray, sheets)
3. tablet
4. desktop
5. start screens
6. states and motion

**Test** at 390, 820, 1180 (landscape), 1440 and 1920, in light and dark, and in the Android WebView. Use:
- a text PDF
- a fillable form, if forms are supported today
- a signature
- a password-protected PDF
- a PDF of 50+ pages, to check scrolling

**Finish with:**
- The tool and action checklist from step 0, each item ticked as still working.
- What changed visually.
- Anything in the design you skipped because the feature doesn't exist yet.
