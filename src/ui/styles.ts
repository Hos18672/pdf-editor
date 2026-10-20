export const css = String.raw`
:root {
  --desk: #e8ecf3;
  --desk-2: #dde3ee;
  --paper: #ffffff;
  --ink: #1e2559;
  --ink-2: #3b4380;
  --muted: #646b8f;
  --line: #d2d8e5;
  --marker: #ffe14d;
  --danger: #c93434;
  --ok: #157a52;
  --radius-s: 6px;
  --radius-m: 12px;
  --shadow-page: 0 1px 2px rgba(30,37,89,.10), 0 8px 24px -8px rgba(30,37,89,.22);
  --font: "Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--desk); color: var(--ink); font: 15px/1.45 var(--font); -webkit-font-smoothing: antialiased; overscroll-behavior: none; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

/* ---------- home ---------- */
.home { min-height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: center; gap: 48px; padding: 48px clamp(20px, 6vw, 96px); }
.home h1 { font-size: clamp(36px, 5.4vw, 64px); line-height: 1.02; letter-spacing: -0.03em; font-weight: 800; margin: 0 0 20px; max-width: 12ch; }
.home p.lead { font-size: 18px; color: var(--muted); max-width: 46ch; margin: 0 0 28px; }
.home ul { list-style: none; padding: 0; margin: 28px 0 0; display: grid; gap: 10px; max-width: 46ch; }
.home li { display: flex; gap: 10px; align-items: flex-start; }
.home li svg { flex: none; margin-top: 2px; color: var(--ink-2); }
.home .privacy { margin-top: 28px; font-size: 13px; color: var(--muted); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 20px; border-radius: 999px; border: 1px solid var(--ink); background: var(--ink); color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; }
.btn:hover { background: var(--ink-2); }
.btn.ghost { background: transparent; color: var(--ink); border-color: var(--line); }
.btn.ghost:hover { background: var(--paper); }
.btn.small { height: 34px; padding: 0 14px; font-size: 14px; }
.btn:disabled { opacity: .45; cursor: default; }
.btn.danger { background: var(--danger); border-color: var(--danger); }

.drop { position: relative; aspect-ratio: 0.77; max-height: 72vh; width: min(100%, 460px); justify-self: center; }
.drop .sheet { position: absolute; inset: 0; background: var(--paper); border-radius: 4px; box-shadow: var(--shadow-page); }
.drop .sheet.back1 { transform: rotate(-4deg) translate(-10px, 8px); background: #f6f8fc; }
.drop .sheet.back2 { transform: rotate(3deg) translate(12px, 4px); background: #fafbfe; }
.drop .sheet.front { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 32px; text-align: center; border: 2px dashed transparent; transition: border-color .15s, transform .15s; cursor: pointer; }
.drop.over .sheet.front { border-color: var(--ink); transform: translateY(-4px); }
.drop .lines { position: absolute; left: 40px; right: 40px; top: 44px; display: grid; gap: 10px; opacity: .55; }
.drop .lines i { display: block; height: 7px; border-radius: 4px; background: var(--desk); }
.drop .lines i:nth-child(1) { width: 55%; height: 12px; background: var(--desk-2); }
.drop .lines i:nth-child(3) { width: 85%; }
.drop .lines i:nth-child(4) { width: 70%; }
.drop .stroke { position: relative; font-weight: 700; font-size: 20px; isolation: isolate; }
.drop .stroke::before { content: ""; position: absolute; left: -6px; right: -6px; bottom: 2px; height: 11px; background: var(--marker); z-index: -1; transform: skew(-12deg) rotate(-1deg); border-radius: 2px; }
.drop .hint { color: var(--muted); font-size: 14px; }
.home .error { color: var(--danger); margin-top: 16px; font-weight: 600; }

/* ---------- editor shell ---------- */
.app { height: 100%; display: grid; grid-template-rows: 56px minmax(0, 1fr); }
.topbar { display: flex; align-items: center; gap: 8px; padding: 0 12px 0 8px; background: var(--paper); border-bottom: 1px solid var(--line); min-width: 0; }
.topbar .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.topbar .name small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }
.iconbtn { width: 40px; height: 40px; display: inline-grid; place-items: center; border-radius: 10px; border: 0; background: transparent; cursor: pointer; flex: none; }
.iconbtn:hover:not(:disabled) { background: var(--desk); }
.iconbtn:disabled { opacity: .35; cursor: default; }
.zoom { display: flex; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); }
.zoom span { width: 44px; text-align: center; }

.body { display: grid; grid-template-columns: 84px minmax(0, 1fr) auto; min-height: 0; }
.rail { background: var(--paper); border-right: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; padding: 8px 6px; overflow-y: auto; }
.tool { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 9px 2px 7px; border: 0; background: transparent; border-radius: 10px; cursor: pointer; font-size: 11.5px; color: var(--muted); }
.tool:hover { background: var(--desk); color: var(--ink); }
.tool svg { position: relative; z-index: 1; }
.tool .mark { position: absolute; top: 14px; width: 30px; height: 14px; background: var(--marker); border-radius: 3px; transform: skew(-14deg) rotate(-3deg) scaleX(0); transform-origin: left; transition: transform .18s ease-out; }
.tool.active { color: var(--ink); font-weight: 650; }
.tool.active .mark { transform: skew(-14deg) rotate(-3deg) scaleX(1); }
.rail hr { border: 0; border-top: 1px solid var(--line); margin: 6px 8px; }

.canvasWrap { position: relative; overflow: auto; min-height: 0; touch-action: pan-x pan-y; }
.pages { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 28px 16px 120px; min-width: min-content; }
.pageOuter { position: relative; flex: none; }
.pageNum { position: absolute; left: 0; right: 0; bottom: -20px; text-align: center; font-size: 12px; color: var(--muted); }
.page { position: absolute; left: 50%; top: 50%; background: var(--paper); box-shadow: var(--shadow-page); transform-origin: center; user-select: none; -webkit-user-select: none; }
.page canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.page .layer { position: absolute; inset: 0; }
.page.tool-text, .page.tool-sign, .page.tool-image { cursor: copy; }
.page.tool-whiteout, .page.tool-highlight, .page.tool-rect, .page.tool-ellipse, .page.tool-line, .page.tool-draw { cursor: crosshair; touch-action: none; }

.run { position: absolute; white-space: pre; transform-origin: 0 0; border-radius: 2px; cursor: text; }
.tool-edit .run:hover, .tool-text .run:hover { outline: 1.5px solid rgba(30,37,89,.55); background: rgba(255,225,77,.18); }
.run.edited { cursor: text; }
.run .cover { position: absolute; inset: -2px -3px; border-radius: 1px; }
.run .txt { position: absolute; left: 0; white-space: pre; }
.run textarea { position: absolute; left: 0; margin: 0; padding: 0; border: 0; border-radius: 1px; resize: none; overflow: hidden; white-space: pre; outline: none; box-shadow: 0 0 0 3px var(--paper), 0 0 0 4.5px var(--ink), 0 8px 22px -6px rgba(30,37,89,.35); font-kerning: normal; }
.layer.passive .run { pointer-events: none; }

.obj { position: absolute; touch-action: none; }
.obj.selected { outline: 1.5px solid var(--ink); outline-offset: 2px; }
.obj .handle { position: absolute; width: 18px; height: 18px; right: -12px; bottom: -12px; background: var(--paper); border: 2px solid var(--ink); border-radius: 50%; cursor: nwse-resize; touch-action: none; }
.obj .handle::after { content: ""; position: absolute; inset: -10px; }
.obj textarea, .obj .tview { position: absolute; inset: 0; margin: 0; padding: 0; border: 0; background: transparent; resize: none; overflow: hidden; white-space: pre; line-height: 1.2; outline: none; }
.obj.dragging { cursor: grabbing; }
.obj.editing { cursor: text; }
.objbar { position: absolute; left: 50%; bottom: calc(100% + 12px); transform: translateX(-50%); display: flex; align-items: center; gap: 2px; padding: 4px; background: var(--ink); border-radius: 12px; box-shadow: 0 10px 24px -8px rgba(20,24,56,.55); z-index: 5; white-space: nowrap; }
.objbar::after { content: ""; position: absolute; left: 50%; top: 100%; margin-left: -6px; border: 6px solid transparent; border-top-color: var(--ink); }
.objbar.below { bottom: auto; top: calc(100% + 12px); }
.objbar.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: var(--ink); }
.objbar button { width: 38px; height: 36px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #fff; cursor: pointer; padding: 0; touch-action: none; }
.objbar button:hover { background: rgba(255,255,255,.14); }
.objbar button.danger { color: #ff9b9b; }
.objbar .grip { cursor: move; background: var(--marker); color: var(--ink); }
.objbar .grip:hover { background: var(--marker); }
.objbar .sep { width: 1px; height: 22px; background: rgba(255,255,255,.22); margin: 0 3px; }
.objbar.moving button:not(.grip), .objbar.moving .sep { visibility: hidden; }
.objbar svg { position: static; pointer-events: none; flex: none; }
@media (max-width: 760px) { .objbar button { width: 44px; height: 40px; } }
.tool-edit .obj { cursor: grab; }
.obj img { width: 100%; height: 100%; display: block; pointer-events: none; }
.obj > svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.draft { position: absolute; border: 1.5px dashed var(--ink); pointer-events: none; }

/* properties panel */
.panel { width: 280px; background: var(--paper); border-left: 1px solid var(--line); padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
.panel h3 { margin: 0; font-size: 15px; }
.panel .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.panel label.f { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
.panel select, .panel input[type=number] { height: 36px; border: 1px solid var(--line); border-radius: var(--radius-s); padding: 0 10px; font: inherit; color: var(--ink); background: #fff; min-width: 0; }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--line); cursor: pointer; padding: 0; }
.swatch.on { box-shadow: 0 0 0 2px var(--ink); }
.swatch.none { background: linear-gradient(135deg, #fff 45%, var(--danger) 45%, var(--danger) 55%, #fff 55%); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button { border: 0; background: #fff; height: 34px; min-width: 38px; padding: 0 10px; cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button.on { background: var(--ink); color: #fff; }
.note { font-size: 13px; color: var(--muted); background: var(--desk); border-radius: var(--radius-s); padding: 10px 12px; }
.note.warn { background: #fff6d6; color: #6a5300; }
.panel .close { display: none; }

/* page manager */
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 16px; }
.thumb { display: grid; gap: 6px; justify-items: center; }
.thumb .tp { width: 100%; aspect-ratio: .75; display: grid; place-items: center; background: var(--desk); border-radius: 6px; overflow: hidden; }
.thumb .tp canvas { max-width: 92%; max-height: 92%; box-shadow: var(--shadow-page); background: #fff; }
.thumb .acts { display: flex; gap: 2px; }
.thumb .acts .iconbtn { width: 32px; height: 32px; }
.thumb .n { font-size: 12px; color: var(--muted); }

/* modal */
.scrim { position: fixed; inset: 0; background: rgba(20,24,56,.42); display: grid; place-items: center; z-index: 50; padding: 16px; }
.modal { background: var(--paper); border-radius: 16px; width: min(560px, 100%); max-height: calc(100% - 16px); overflow: auto; padding: 20px; box-shadow: 0 30px 80px -20px rgba(20,24,56,.5); display: grid; gap: 16px; }
.modal.wide { width: min(880px, 100%); }
.modal header { display: flex; align-items: center; justify-content: space-between; }
.modal h2 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.tabs button { border: 0; background: none; padding: 10px 12px; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs button.on { color: var(--ink); border-color: var(--ink); font-weight: 600; }
.sigpad { position: relative; height: 200px; border: 1px solid var(--line); border-radius: var(--radius-m); background: #fff; touch-action: none; }
.sigpad canvas { width: 100%; height: 100%; display: block; border-radius: var(--radius-m); }
.sigpad .base { position: absolute; left: 24px; right: 24px; bottom: 48px; border-top: 1px solid var(--line); pointer-events: none; }
.sigpad .ph { position: absolute; left: 24px; bottom: 24px; color: var(--muted); font-size: 13px; pointer-events: none; }
.typed { display: grid; gap: 10px; }
.typed input { height: 44px; border: 1px solid var(--line); border-radius: var(--radius-s); padding: 0 12px; font: inherit; font-size: 16px; }
.typed .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.typed .opts button { height: 64px; border: 1px solid var(--line); border-radius: var(--radius-m); background: #fff; font-size: 30px; cursor: pointer; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 10px; }
.typed .opts button.on { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.saved { display: flex; gap: 8px; flex-wrap: wrap; }
.saved .s { position: relative; width: 140px; height: 64px; border: 1px solid var(--line); border-radius: var(--radius-s); background: #fff; display: grid; place-items: center; cursor: pointer; padding: 6px; }
.saved .s img { max-width: 100%; max-height: 100%; }
.saved .s .x { position: absolute; top: -8px; right: -8px; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line); background: #fff; font-size: 12px; cursor: pointer; display: grid; place-items: center; padding: 0; }
.modal footer { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }

.toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--ink); color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 14px; z-index: 60; box-shadow: 0 10px 30px -10px rgba(20,24,56,.6); max-width: calc(100% - 32px); }
.busy { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(232,236,243,.7); z-index: 70; font-weight: 600; }
.spin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--ink); animation: spin 0.8s linear infinite; margin: 0 auto 10px; }
@keyframes spin { to { transform: rotate(360deg); } }
.shapes { position: absolute; left: 84px; z-index: 20; background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 6px; display: flex; gap: 2px; box-shadow: 0 10px 30px -12px rgba(30,37,89,.4); }
.shapes .tool { width: 66px; }

/* ---------- small screens ---------- */
@media (max-width: 760px) {
  .home { grid-template-columns: 1fr; gap: 28px; padding: 28px 20px 40px; }
  .home h1 { font-size: 38px; }
  .home p.lead { font-size: 16px; }
  .drop { width: min(62%, 240px); order: -1; }
  .drop .lines { left: 24px; right: 24px; top: 28px; gap: 7px; }
  .drop .stroke { font-size: 16px; }
  .app { grid-template-rows: 52px minmax(0, 1fr) auto; }
  .topbar { padding: 0 4px; gap: 2px; }
  .topbar .zoom { display: none; }
  .topbar .dl-label { display: none; }
  .topbar .btn { padding: 0 12px; }
  .body { grid-template-columns: minmax(0, 1fr); }
  .rail { position: fixed; left: 0; right: 0; bottom: 0; z-index: 30; flex-direction: row; border-right: 0; border-top: 1px solid var(--line); overflow-x: auto; overflow-y: hidden; padding: 4px 6px calc(4px + env(safe-area-inset-bottom)); gap: 0; scrollbar-width: none; }
  .rail::-webkit-scrollbar { display: none; }
  .rail .tool { min-width: 64px; }
  .rail hr { border-top: 0; border-left: 1px solid var(--line); margin: 8px 4px; }
  .pages { padding: 16px 8px 140px; gap: 18px; }
  .panel { position: fixed; left: 0; right: 0; bottom: 0; width: auto; max-height: 52vh; z-index: 40; border-left: 0; border-top: 1px solid var(--line); border-radius: 16px 16px 0 0; box-shadow: 0 -12px 40px -12px rgba(30,37,89,.35); padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); gap: 14px; }
  .panel .close { display: inline-grid; position: absolute; right: 8px; top: 6px; }
  .shapes { position: fixed; left: 8px; right: 8px; bottom: 74px; justify-content: center; }
  .modal { padding: 16px; border-radius: 14px; }
  .typed .opts button { font-size: 24px; }
}
`;
