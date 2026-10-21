# Prompt for Claude Code: PDF Editor design update

Before running this prompt:
1. Download this project as a zip and unzip it into `design/` at the root of the `pdf-editor` repo.
2. Run Claude Code from the repo root.
3. Paste in everything below the line.

---

Update the **visual design** of my web app PDF Editor (https://hos18672.github.io/pdf-editor/, also packaged as an Android WebView app) to match the redesign in `design/`.

This is a design update. Keep every existing feature and all the PDF logic working exactly as it does now. Files must never leave the device.

## 0. Before coding
- Explore the repo and tell me in a few lines:
  - the framework and build setup
  - where the styles live
  - the main UI components: start screen, top bar, tool bar, properties, dialogs, page organizer, toasts
- Open these files in a browser; they are the visual spec. Each `.dc.html` opens directly, and the Tweaks panel switches `bp` (mobile / tablet / desktop / large) plus `screen` or `state`.
  - `design/PDF Editor Redesign.dc.html`: overview of every screen. **Sections 15–16 (v2) replace 01 and 02 wherever they differ.**
  - `design/Design System.dc.html`: tokens, components, interaction notes
  - `design/Start v2.dc.html`: new start screen
  - `design/Editor Menu v2.dc.html`: new floating tool menu
  - `design/Editor.dc.html`, `PropsPanel.dc.html`, `SignaturePanel.dc.html`, `Tools.dc.html`: the other screens
- Read each file's inline styles for exact values. Don't eyeball screenshots.

## 1. Tokens: add these first, as CSS custom properties
- **Colours:**
  - `--ink` #1E2559 · `--ink-hover` #2B3478 · `--sel` #3446C9
  - `--marker` #FFE14D · `--marker-100` #FFF4B8
  - `--desk` #ECEEF3 · `--surface` #FFF · `--surface-2` #F5F6F9 · `--line` #E1E4EB
  - `--text` #151833 · `--muted` #5D637A · `--danger` #B83227 · `--success` #1E7A4C
  - Tool tints: change #DDE2FF · add #FFE14D · mark up #FCE3D8 · document/convert #E3F1E9
- **Dark theme** (follows `prefers-color-scheme`, plus a manual toggle via the moon button on Start):
  - desk #0F1118 · surface #191C27 · surface-2 #222635 · line #2D3245
  - text #ECEEF6 · muted #9CA2BA
  - ink #B4BDFF, with #0F1118 for text on ink
  - Marker stays yellow, and PDF pages stay white.
- **Type:** Schibsted Grotesk 400–800.
  - Headlines are 800 weight with tight tracking (−0.045em).
  - UI labels are 600 weight.
  - Use tabular numbers for zoom, counters and page numbers.
  - Nothing below 12px.
- **Radii** (the new look is softer):
  - pill chips and nav buttons 999px
  - buttons and inputs 14–16px
  - rail items and tiles 18–20px
  - floating bars and flyouts 20–22px
  - rail 26px
  - drop card and sheets 28–32px
  - PDF pages stay at 3px
- **Shadows:**
  - resting: `0 1px 2px rgba(20,23,46,.06), 0 0 0 1px rgba(20,23,46,.05)`
  - floating: `0 1px 2px rgba(20,23,46,.06), 0 18px 48px rgba(20,23,46,.14)`
  - hero/page: `0 40px 80px rgba(20,23,46,.20)`
  - primary button: `0 8px 20px rgba(30,37,89,.28)`
- **Desk texture:** a dot grid, `radial-gradient(#C9CEDB 1px, transparent 1px)` at 22px spacing and 55% opacity.
- **Icons:** Phosphor.
  - duotone at 22–23px for tools
  - fill for the active tool
  - regular at 18–20px for bars

## 2. Start screen (match `Start v2.dc.html`)
- **Background:** desk colour with the dot grid, plus a soft blurred yellow glow at the top right (`filter: blur(90px)`, opacity .35).
- **Nav:**
  - Left: logo mark (navy rounded square, white sheet, yellow dot) and "PDF Editor".
  - Right: "All tools", "Android app", and a theme toggle.
- **Hero copy:**
  - Privacy pill "Files never leave your device" with a lock icon.
  - Headline "Edit any PDF. / Right here." (88px desktop, 112px large, 84px tablet, 46px mobile).
  - A short lead line below it.
- **Drop card:**
  - White, 28px radius, with an animated dashed inner border.
  - Navy icon tile, "Drop a PDF anywhere", and the primary "Choose PDF →" button.
  - The whole window accepts drops, plus Ctrl+V to paste a file. On the Android app, opening a shared PDF goes straight in.
- **Quick tool chips:** Sign, Fill a form, Combine, Convert to PDF, More tools. They lift on hover. On mobile they sit in one horizontally scrolling row.
- **Live demo illustration** (right column on desktop, below the copy on tablet and mobile): three floating sheets, with the front sheet showing an edited line, a highlight sweep, a signature writing in and the object toolbar popping up. It's decorative, so give it `aria-hidden="true"`.
- **Layout:**
  - Desktop/large: two columns, max width 1560px.
  - Tablet and mobile: one column.
  - Must fit 390×844 without the primary action going below the fold.
- **States:**
  - **Drag-over:** the card turns navy, scales to 1.02 and pulses a yellow glow; it says "Release to open" with the file name.
  - **Opening:** a mini page with a yellow scan line, "Opening <file> · 3 / 8", a shimmering progress bar, and "Reading fonts so your edits match the original". **Use real progress** from the loader, page by page.
  - **Errors:** password-protected or invalid file, shown in the same card slot.

## 3. Editor menu (match `Editor Menu v2.dc.html`)
- **Top bar:**
  - A floating rounded bar (20px radius, 16px inset, translucent white with `backdrop-filter: blur(14px)`).
  - Contents: back, file name, page count, a yellow "N changes" pill, undo/redo, the zoom group, and the navy Download button.
  - On mobile it's an icon-only Download button.
- **Tablet, desktop and large: floating tool rail.**
  - White, 26px radius, 16px from the left edge, vertically centred (use `top:0; bottom:0; margin:auto 0; height:max-content`, **not** a transform, so the entrance animation can't break the centring).
  - Grouped with hairline separators: **Change** (Edit, Fill) · **Add** (Text, Sign, Image) · **Mark up** (Whiteout, Highlight, Shapes, Draw) · **Document** (Pages).
  - Items are 68×58 with an 18px radius.
  - The active item is a yellow chip with a filled icon and a soft yellow shadow. Hover is a marker-100 tint.
  - Tools with options show a small corner triangle.
- **Tool flyout:** opens beside the rail, aligned to the active item.
  - It shows the tool name and its keyboard shortcut, style tiles, ink swatches, and an opacity slider.
  - Highlight: Marker / Underline / Strike. Shapes: rectangle / ellipse / line / arrow.
  - Closes on Esc, a click outside, or choosing a different tool.
- **Mobile: floating navy dock.**
  - 72px tall, 26px radius, 12px from the sides, above the home indicator (respect safe-area insets).
  - It holds the 4 most recently used tools plus "More".
  - The active tool expands into a yellow pill with its label.
  - "More" opens a bottom sheet titled "All tools", with the same four groups as rounded 84px tiles (tinted icon chip, label).
  - While editing text, the dock is replaced by the slim properties bar, as in the earlier design.
- The **page** stays centred on the desk; the rail floats over the desk margin and never over the page at 100% zoom.

## 4. Motion
- **Easing:** use `cubic-bezier(.2,.8,.2,1)` for every entrance.
- **Start screen:**
  - Copy and illustration rise 14px and fade in (600–700ms, staggered by 150ms).
  - The headline marker stroke draws once in 1.4s.
  - The demo loops every 4–8s.
- **Rail:** enters with an 8px slide and fade (400ms).
- **Flyout:** 260ms. Tool switch: 180ms.
- **Dock:** the active pill resizes in 250ms. The sheet rises 40px in 320ms.
- **Toasts:** slide up from the bottom and auto-dismiss after 4s.
- **Loading:** the scan line moves at 1.1s alternate; the progress bar shimmers at 1.2s linear.
- **Reduced motion:** under `prefers-reduced-motion`, stop all loops and use opacity-only transitions.

## 5. Everything else
Restyle the remaining screens to the same tokens and radii, following the overview sections 03–14:
- text editing and the properties panel
- the selected-object toolbar
- the signature dialog
- the pages organizer
- the tools hub, combine, extract/remove, insert, convert and fill-form screens (if they exist yet)
- all states

Don't add new features in this pass unless they're needed for the layout.

## 6. Done criteria
- Test at 390, 820, 1440 and 1920, in light and dark, with real PDFs.
- Check that the Android WebView still works.
- **Accessibility:**
  - Contrast at least 4.5:1 for text.
  - Touch targets at least 44px.
  - Every icon button has an `aria-label`.
  - Tools use `aria-pressed`.
  - Visible focus ring: 2px `--sel`, 2px offset.
  - Full keyboard use.
- No new heavy dependencies; the animations are pure CSS.
- Small commits, in this order: tokens → start → top bar and rail/dock → flyouts → remaining screens.
- Finish with a short list of what changed and anything that didn't match the design.
