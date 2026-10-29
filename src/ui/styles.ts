// "Paper on a desk": the document is the hero, the chrome stays quiet.
export const css = String.raw`
:root {
  --desk: #ECEEF3; --surface: #FFFFFF; --surface-2: #F5F6F9; --surface-3: #EEF0F4;
  --line: #E1E4EB; --line-2: #D5D9E2; --line-3: #BFC4D2;
  --text: #151833; --muted: #5D637A; --muted-2: #3F4560; --faint: #A7ACBE;
  --ink: #1E2559; --ink-hover: #2B3478; --on-ink: #FFFFFF; --sel: #3446C9; --sel-tint: rgba(52,70,201,.08);
  --marker: #FFE14D; --marker-100: #FFF4B8; --on-marker: #1E2559;
  --danger: #B83227; --danger-bg: #FBE7E4; --success: #1E7A4C; --success-bg: #E3F1E9;
  --bar: #1E2559; --toast: #151833; --scrim: rgba(16,19,40,.38);
  --paper: #FFFFFF;
  --shadow-page: 0 1px 2px rgba(20,23,46,.06), 0 10px 30px rgba(20,23,46,.10);
  --shadow-float: 0 2px 10px rgba(20,23,46,.10);
  --shadow-panel: 0 2px 8px rgba(20,23,46,.08), 0 0 0 1px rgba(20,23,46,.04);
  --shadow-card: 0 1px 2px rgba(20,23,46,.05), 0 0 0 1px rgba(20,23,46,.04);
  --shadow-overlay: 0 1px 2px rgba(20,23,46,.06), 0 16px 40px rgba(20,23,46,.16);
  --shadow-modal: 0 30px 80px rgba(16,19,40,.35);
  --font: "Schibsted Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --safe-b: env(safe-area-inset-bottom, 0px);
  --safe-t: env(safe-area-inset-top, 0px);
  --safe-l: env(safe-area-inset-left, 0px);
  --safe-r: env(safe-area-inset-right, 0px);
  /* v2: softer, floating chrome */
  --ease: cubic-bezier(.2,.8,.2,1);
  --shadow-rest: 0 1px 2px rgba(20,23,46,.06), 0 0 0 1px rgba(20,23,46,.05);
  --shadow-lift: 0 1px 2px rgba(20,23,46,.06), 0 18px 48px rgba(20,23,46,.14);
  --shadow-hero: 0 40px 80px rgba(20,23,46,.20);
  --shadow-primary: 0 8px 20px rgba(30,37,89,.28);
  --glass: rgba(255,255,255,.88);
  --dots: rgba(201,206,219,.55);
  --desk-dots: radial-gradient(var(--dots) 1px, transparent 1px) 0 0 / 22px 22px;
  --tint-change: #DDE2FF; --tint-add: #FFE14D; --tint-markup: #FCE3D8; --tint-doc: #E3F1E9; --on-tint: #1E2559;
  --chip: #F1F2F6;
  --pill-chg: #FFF4B8; --on-pill-chg: #5C4A00;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --desk: #0F1118; --surface: #191C27; --surface-2: #222635; --surface-3: #262A3A;
  --line: #2D3245; --line-2: #383E54; --line-3: #4A5068;
  --text: #ECEEF6; --muted: #9CA2BA; --muted-2: #C3C8DA; --faint: #6B7189;
  --ink: #B4BDFF; --ink-hover: #CDD3FF; --on-ink: #0F1118; --sel: #8E9BFF; --sel-tint: rgba(142,155,255,.12);
  --marker-100: #3A3620;
  --danger: #FF8A7E; --danger-bg: #3A1E1E; --success: #5BD69A; --success-bg: #17322A;
  --bar: #262D6E; --toast: #2A2F45; --scrim: rgba(0,0,0,.55);
  --shadow-page: 0 1px 2px rgba(0,0,0,.4), 0 12px 32px rgba(0,0,0,.45);
  --shadow-float: 0 2px 12px rgba(0,0,0,.45);
  --shadow-panel: 0 0 0 1px var(--line), 0 6px 20px rgba(0,0,0,.35);
  --shadow-card: 0 0 0 1px var(--line);
  --shadow-overlay: 0 0 0 1px var(--line), 0 16px 40px rgba(0,0,0,.5);
  --shadow-modal: 0 0 0 1px var(--line), 0 30px 80px rgba(0,0,0,.6);
  --shadow-rest: 0 0 0 1px var(--line);
  --shadow-lift: 0 0 0 1px var(--line), 0 18px 48px rgba(0,0,0,.5);
  --shadow-hero: 0 40px 80px rgba(0,0,0,.55);
  --shadow-primary: 0 8px 20px rgba(0,0,0,.4);
  --glass: rgba(25,28,39,.86);
  --dots: rgba(255,255,255,.07);
  --tint-change: #2C3363; --tint-add: #FFE14D; --tint-markup: #4A2C26; --tint-doc: #1D3A2E; --on-tint: #ECEEF6;
  --chip: #262A3A;
  --pill-chg: #4A4220; --on-pill-chg: #FFE98A;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
/* Android app: the DOM page renders the screens straight into #root (a row flexbox there), where a
   size-contained screen (.start uses container-type) would collapse to 0px wide. Stack them instead. */
#root { display: flex; flex-direction: column; }
.start, .app, .tscreen { width: 100%; min-width: 0; }
body { background: var(--desk); color: var(--text); font: 14px/1.45 var(--font); -webkit-font-smoothing: antialiased; overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus { outline: none; }
:focus-visible { outline: 2px solid var(--sel); outline-offset: 2px; }
.num { font-variant-numeric: tabular-nums; }
@keyframes pe-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes pe-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-property: opacity !important; transition-duration: .01ms !important; animation-name: pe-fade !important; animation-iteration-count: 1 !important; }
  .spin, .spinner { animation: spin 1.6s linear infinite !important; }
}

/* ---------- buttons ---------- */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 14px; border: 0; background: transparent; font-weight: 600; font-size: 14px; white-space: nowrap; transition: background .15s, box-shadow .15s; text-decoration: none; color: var(--text); }
.btn:disabled { opacity: .4; cursor: default; }
.btn.primary { background: var(--ink); color: var(--on-ink); box-shadow: 0 1px 2px rgba(20,23,46,.2); }
.btn.primary.lg, .btn.primary.xl { box-shadow: var(--shadow-primary); }
.btn.primary:hover:not(:disabled) { background: var(--ink-hover); }
.btn.secondary { box-shadow: inset 0 0 0 1px var(--line-2); }
.btn.secondary:hover:not(:disabled) { background: var(--surface-2); }
.btn.ghost:hover:not(:disabled) { background: var(--surface-2); }
.btn.danger { color: var(--danger); }
.btn.danger:hover:not(:disabled) { background: var(--danger-bg); }
.btn.danger.solid { background: var(--danger); color: #fff; }
.btn.lg { height: 48px; border-radius: 16px; padding: 0 20px; font-size: 15px; }
.btn.xl { height: 52px; border-radius: 16px; padding: 0 24px; font-size: 15px; font-weight: 700; }
.btn.block { width: 100%; }
.ibtn { width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center; border-radius: 14px; border: 0; background: transparent; flex: none; padding: 0; color: var(--text); transition: background .15s; }
.ibtn:hover:not(:disabled) { background: var(--surface-2); }
.ibtn:disabled { opacity: .35; cursor: default; }
.ibtn.muted { color: var(--muted); }
.ibtn.danger { color: var(--danger); }
.ibtn.danger:hover:not(:disabled) { background: var(--danger-bg); }
.ibtn.primary { background: var(--ink); color: var(--on-ink); width: 44px; height: 44px; border-radius: 14px; box-shadow: var(--shadow-primary); }
.ibtn.primary:hover { background: var(--ink-hover); }
.label { font-size: 13px; font-weight: 500; color: var(--muted); }
.kicker { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.field { display: flex; flex-direction: column; gap: 8px; }
.input { height: 44px; border-radius: 14px; border: 0; box-shadow: inset 0 0 0 1px var(--line-2); background: var(--surface); padding: 0 12px; font-size: 15px; width: 100%; min-width: 0; }
.input:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--sel); }

/* segmented control */
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 4px; gap: 4px; background: var(--surface-3); border-radius: 14px; }
.seg button { height: 36px; border: 0; border-radius: 11px; background: transparent; color: var(--muted-2); font-weight: 500; font-size: 13.5px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; white-space: nowrap; }
.seg button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(20,23,46,.12); }
:root[data-theme="dark"] .seg button.on { background: var(--surface-2); box-shadow: 0 0 0 1px var(--line-2); }
.seg.lg button { height: 40px; font-size: 14px; }

/* swatches */
.swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.swatch { width: 44px; height: 44px; margin: -6px; border: 0; background: transparent; padding: 0; display: grid; place-items: center; border-radius: 50%; position: relative; }
.swatch i { display: block; width: 30px; height: 30px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(20,23,46,.14); }
:root[data-theme="dark"] .swatch:not(.on) i { box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
.swatch.on i { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.swatch.none i { background: linear-gradient(135deg, transparent 45%, var(--danger) 45%, var(--danger) 55%, transparent 55%), var(--surface); }
.swatch.custom i { border: 1.5px dashed var(--line-3); box-shadow: none; display: grid; place-items: center; color: var(--muted); }
.swatch.custom { cursor: pointer; }

/* colour picker (react-colorful) */
.cp-scrim { position: fixed; inset: 0; z-index: 85; background: var(--scrim); display: flex; align-items: center; justify-content: center; padding: calc(24px + var(--safe-t)) 24px calc(24px + var(--safe-b)); animation: pe-fade .18s; }
.cp { width: 100%; max-width: 340px; max-height: calc(100% - 16px); overflow-y: auto; background: var(--surface); color: var(--text); border-radius: 28px; padding: 18px 18px 16px; box-shadow: var(--shadow-modal); display: flex; flex-direction: column; gap: 16px; animation: pe-in .2s ease-out; font-family: var(--font); user-select: none; -webkit-user-select: none; }
.cp-scrim.sheet { align-items: flex-end; padding: 0; }
.cp-scrim.sheet .cp { max-width: none; border-radius: 28px 28px 0 0; padding: 8px 18px calc(16px + var(--safe-b, 0px)); max-height: 92%; }
.cp .grab { width: 40px; height: 4px; border-radius: 2px; background: var(--line-3); margin: 4px auto 0; }
.cp-head { display: flex; align-items: center; gap: 8px; }
.cp-head h3 { flex: 1; margin: 0; font-size: 17px; font-weight: 600; }
.cp .react-colorful { width: 100%; height: auto; gap: 14px; }
.cp .react-colorful__saturation { height: 190px; flex: none; border-radius: 14px; border-bottom: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.cp-scrim.sheet .react-colorful__saturation { height: min(220px, 34vh); }
.cp .react-colorful__hue { height: 22px; flex: none; border-radius: 11px; }
.cp .react-colorful__pointer { width: 26px; height: 26px; border-width: 3px; box-shadow: 0 1px 6px rgba(0,0,0,.3); }
.cp .react-colorful__hue-pointer { width: 18px; height: 30px; border-radius: 9px; }
.cp .react-colorful__interactive:focus:not(:focus-visible) { outline: none; }
.cp-row { display: flex; align-items: center; gap: 10px; }
.cp-compare { display: flex; flex: none; border-radius: 10px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--line-2); }
.cp-compare i { display: block; width: 26px; height: 40px; box-shadow: inset 0 0 0 1px rgba(20,23,46,.08); }
.cp-hex { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 12px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); background: var(--surface); color: var(--muted); font-variant-numeric: tabular-nums; }
.cp-hex:focus-within { box-shadow: inset 0 0 0 2px var(--sel); }
.cp-hex input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font: 600 15px/1 var(--font); text-transform: uppercase; letter-spacing: .04em; user-select: text; -webkit-user-select: text; }
.cp-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 6px; }
.cp-chip { aspect-ratio: 1; width: 100%; min-width: 0; padding: 0; border: 0; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(20,23,46,.16); cursor: pointer; }
:root[data-theme="dark"] .cp-chip { box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); }
.cp-chip.on { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.cp-recent { display: flex; flex-direction: column; gap: 8px; }
.cp-acts { display: flex; gap: 10px; }
.cp-acts .btn { flex: 1; height: 46px; }

/* stepper */
.stepper { display: flex; align-items: center; height: 44px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); background: var(--surface); min-width: 0; }
.stepper button { width: 42px; height: 100%; border: 0; background: transparent; display: grid; place-items: center; padding: 0; color: var(--text); flex: none; border-radius: 14px; }
.stepper button:hover { background: var(--surface-2); }
.stepper .v { flex: 1; text-align: center; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.stepper .v small { font-weight: 400; color: var(--muted); font-size: 12px; }
.stepper.soft { box-shadow: none; background: var(--surface-2); }

/* toggle */
.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; min-height: 44px; }
.toggle .t { display: flex; flex-direction: column; gap: 2px; }
.toggle .t b { font-weight: 500; }
.toggle .t span { font-size: 12.5px; color: var(--muted); }
.toggle input { position: absolute; opacity: 0; pointer-events: none; }
.toggle .sw { width: 44px; height: 26px; flex: none; border-radius: 13px; background: var(--line-3); position: relative; transition: background .18s; }
.toggle .sw::after { content: ""; position: absolute; left: 3px; top: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .18s ease-out; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.toggle input:checked + .sw { background: var(--ink); }
.toggle input:checked + .sw::after { transform: translateX(18px); }
.toggle input:focus-visible + .sw { outline: 2px solid var(--sel); outline-offset: 2px; }
.check { display: flex; align-items: center; gap: 10px; min-height: 44px; cursor: pointer; font-weight: 500; }
.check input { position: absolute; opacity: 0; pointer-events: none; }
.check .box { width: 22px; height: 22px; border-radius: 6px; box-shadow: inset 0 0 0 1.5px var(--line-3); display: grid; place-items: center; color: transparent; flex: none; }
.check input:checked + .box { background: var(--ink); color: var(--on-ink); box-shadow: none; }
.check input:focus-visible + .box { outline: 2px solid var(--sel); outline-offset: 2px; }

/* ---------- start (v2) ---------- */
.start { position: relative; height: 100%; overflow-x: hidden; overflow-y: auto; background: var(--desk-dots), var(--desk); color: var(--text); display: flex; flex-direction: column; container-type: inline-size; isolation: isolate; }
/* the yellow glow behind the page stack: drawn inside the page (a blurred circle past the edge let the page scroll sideways) */
.s2-glow { position: absolute; left: 0; right: 0; top: 0; height: min(1100px, 100%); background: radial-gradient(ellipse 42% 60% at 88% 12%, rgba(255,225,77,.42), rgba(255,225,77,.16) 45%, transparent 72%); pointer-events: none; z-index: -1; }
:root[data-theme="dark"] .s2-glow { opacity: .10; }
.s2-nav { position: relative; z-index: 5; flex: none; display: flex; align-items: center; gap: 12px; padding: calc(24px + var(--safe-t)) calc(40px + var(--safe-r)) 24px calc(40px + var(--safe-l)); }
.s2-nav .sp { flex: 1; }
.s2-brand { font-weight: 800; font-size: 18px; letter-spacing: -.02em; white-space: nowrap; }
.logo3 { flex: none; display: grid; place-items: center; }
.logo3 img { width: 118%; height: 118%; object-fit: contain; filter: drop-shadow(0 4px 10px rgba(30,37,89,.22)); pointer-events: none; }
.logo2 { position: relative; flex: none; border-radius: 12px; background: #1E2559; display: grid; place-items: center; box-shadow: 0 6px 16px rgba(30,37,89,.3); }
.logo2 i { width: 40%; height: 50%; background: #fff; border-radius: 2px 6px 2px 2px; }
.logo2 b { position: absolute; right: 17.5%; bottom: 17.5%; width: 25%; height: 25%; border-radius: 50%; background: #FFE14D; border: 2px solid #1E2559; }
.s2-navbtn { height: 40px; padding: 0 16px; border-radius: 999px; border: 0; background: color-mix(in srgb, var(--surface) 72%, transparent); box-shadow: inset 0 0 0 1px var(--line-2, rgba(20,23,46,.08)); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: var(--text); text-decoration: none; white-space: nowrap; transition: background .18s; }
.s2-navbtn:hover { background: var(--surface); }
.s2-round { width: 44px; height: 44px; flex: none; border-radius: 999px; border: 0; background: color-mix(in srgb, var(--surface) 80%, transparent); box-shadow: 0 1px 2px rgba(20,23,46,.08); display: grid; place-items: center; color: var(--text); padding: 0; transition: background .18s; }
.s2-round:hover { background: var(--surface); }
.s2-hero { position: relative; flex: 1 0 auto; display: grid; overflow-x: clip; overflow-y: visible; overflow-clip-margin: 0; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 64px; align-items: center; align-content: center; padding: 0 72px 40px; max-width: 1560px; width: 100%; margin: 0 auto; }
.s2-copy { display: flex; flex-direction: column; gap: 26px; min-width: 0; animation: s2-up .6s var(--ease) both; }
.s2-pill { display: inline-flex; align-self: flex-start; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 6px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-rest); font-size: 13px; font-weight: 600; }
.s2-pill .lk { width: 24px; height: 24px; border-radius: 50%; background: var(--success-bg); color: var(--success); display: grid; place-items: center; }
.start h1 { margin: 0; font-size: clamp(52px, min(5.6vw, 9.5vh), 76px); font-weight: 800; letter-spacing: -.045em; line-height: .95; white-space: nowrap; }
.start h1 .mk { background-image: linear-gradient(var(--marker), var(--marker)); background-repeat: no-repeat; background-position: 0 88%; background-size: 100% 42%; padding: 0 .06em; margin: 0 -.06em; animation: s2-mark 1.4s .3s cubic-bezier(.6,0,.2,1) both; }
:root[data-theme="dark"] .start h1 .mk { background-image: linear-gradient(rgba(255,225,77,.5), rgba(255,225,77,.5)); }
.s2-lead { margin: 0; font-size: 19px; line-height: 1.5; color: var(--muted-2); max-width: 30em; text-wrap: pretty; }
/* the card slot: drop target / opening / password / error */
.s2-card { position: relative; border-radius: 28px; padding: 28px; background: var(--surface); box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 24px 60px rgba(20,23,46,.12); display: flex; align-items: center; gap: 18px; animation: pe-in .26s var(--ease); }
:root[data-theme="dark"] .s2-card { box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgba(0,0,0,.45); }
.s2-card.drop { cursor: pointer; }
/* marching dashes that follow the rounded corners (an SVG outline; pathLength 1000 keeps the dashes even
   on any card size, the loop moves exactly one dash + gap so it never jumps) */
.s2-card.drop .dash { position: absolute; inset: 8px; width: calc(100% - 16px); height: calc(100% - 16px); overflow: visible; pointer-events: none; }
.s2-card.drop .dash rect { fill: none; stroke: var(--line-3); stroke-width: 1.5px; stroke-dasharray: 5 5; animation: s2-dash 2.4s linear infinite; }
.s2-card.stack { flex-direction: column; align-items: stretch; }
.s2-card.over { background: #1E2559; color: #fff; transform: scale(1.02); animation: s2-glowpulse 1.6s ease-in-out infinite; }
.s2-head { display: flex; align-items: center; gap: 16px; flex: 1; min-width: 0; }
.s2-tile { width: 60px; height: 60px; flex: none; border-radius: 20px; background: #1E2559; color: #FFE14D; display: grid; place-items: center; box-shadow: 0 10px 24px rgba(30,37,89,.3); }
.s2-tile.y { background: #FFE14D; color: #1E2559; box-shadow: none; }
.s2-tile.warn, .s2-tile.err { background: var(--danger-bg); color: var(--danger); box-shadow: none; }
.s2-ct { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.s2-ct b { font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.s2-ct span { font-size: 14px; color: var(--muted); line-height: 1.45; }
.s2-card.over .s2-ct b { font-size: 22px; } .s2-card.over .s2-ct span { color: #C9CEF0; }
.s2-cta { flex: none; transition: transform .2s, background .2s; }
.s2-cta:hover { transform: translateY(-1px); }
.s2-card .pw { width: 100%; }
.s2-card .pw .btn { height: 44px; }
/* opening */
.s2-mini { position: relative; width: 56px; height: 74px; flex: none; border-radius: 6px; background: #fff; box-shadow: 0 0 0 1px #E1E4EB, 0 6px 16px rgba(20,23,46,.12); padding: 10px 8px; display: flex; flex-direction: column; gap: 5px; overflow: hidden; }
.s2-mini i { display: block; height: 3px; background: #E4E6EC; }
.s2-mini i.t { height: 5px; width: 70%; background: #1E2559; border-radius: 2px; } .s2-mini i.s { width: 60%; }
.s2-mini .scan { position: absolute; left: 0; right: 0; height: 10px; background: linear-gradient(180deg, rgba(255,225,77,0), rgba(255,225,77,.9)); animation: s2-scan 1.1s ease-in-out infinite alternate; }
.s2-load { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.s2-load .top { display: flex; justify-content: space-between; gap: 12px; }
.s2-load .top b { font-weight: 700; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.s2-load .top span { font-size: 14px; color: var(--muted); white-space: nowrap; }
.s2-load .sub { font-size: 13px; color: var(--muted); }
.s2-bar { height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.s2-bar > div { height: 100%; border-radius: 4px; background: linear-gradient(90deg, #1E2559 0%, #3446C9 50%, #1E2559 100%); background-size: 200% 100%; animation: s2-shim 1.2s linear infinite; transition: width .25s var(--ease); }
:root[data-theme="dark"] .s2-bar > div { background-image: linear-gradient(90deg, #8E9BFF 0%, #CDD3FF 50%, #8E9BFF 100%); }
/* quick tool chips */
.s2-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.s2-chip { flex: none; height: 44px; padding: 0 16px 0 6px; border-radius: 999px; border: 0; background: color-mix(in srgb, var(--surface) 85%, transparent); box-shadow: var(--shadow-rest); display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; transition: transform .2s var(--ease), box-shadow .2s; }
.s2-chip:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(20,23,46,.12); }
.s2-chip > span { width: 32px; height: 32px; border-radius: 50%; color: #1E2559; display: grid; place-items: center; }
/* live demo (decorative) */
/* the page stack: all three sheets the same size (--pw), which follows the window's height too, so the
   whole stack stays in view at 100% on laptop screens */
.s2-art { --pw: min(440px, calc((100vh - 200px) / 1.32), 36vw); position: relative; height: calc(var(--pw) * 1.25 + 56px); animation: s2-up .7s .15s var(--ease) both; }
.s2-art .sheet { position: absolute; background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(20,23,46,.12); }
.s2-art .back { left: 50%; top: 28px; width: var(--pw); margin-left: calc(var(--pw) / -2); aspect-ratio: 1 / 1.25; }
.s2-art .back.l { --r: -7deg; translate: -13% 4%; animation: s2-float 7s ease-in-out infinite; }
.s2-art .back.r { --r: 5deg; translate: 12% -3%; animation: s2-float 8s .8s ease-in-out infinite; }
.s2-art .front { --r: -1.5deg; left: 50%; top: 28px; width: var(--pw); margin-left: calc(var(--pw) / -2); aspect-ratio: 1 / 1.25; border-radius: 16px; box-shadow: 0 2px 4px rgba(20,23,46,.06), var(--shadow-hero); animation: s2-float 6s .3s ease-in-out infinite; padding: 9%; display: flex; flex-direction: column; gap: 3.4%; container-type: inline-size; color: #2A2E45; }
.front .ttl { font-size: 6cqw; font-weight: 800; letter-spacing: -.03em; color: #151833; }
.front .ln { display: block; height: 1.6cqw; background: #ECEEF3; border-radius: 2px; }
.front .edit { font-size: 3.6cqw; display: flex; align-items: center; }
.front .edit .box { margin-left: 1.4cqw; padding: .4cqw 1.2cqw; border-radius: 1.4cqw; outline: 2px solid #1E2559; box-shadow: 0 0 0 6px rgba(30,37,89,.08); font-weight: 600; }
.front .edit .caret { width: 2px; height: 4.4cqw; background: #1E2559; margin-left: 2px; animation: s2-blink 1s steps(1) infinite; }
.front .hl { position: relative; height: 3.6cqw; }
.front .hl .ln { position: absolute; left: 0; right: 0; top: 1cqw; }
.front .hl .sweep { position: absolute; left: -1cqw; top: 0; height: 3.6cqw; background: #FFE14D; opacity: .75; border-radius: 1cqw; mix-blend-mode: multiply; animation: s2-sweep 4s ease-in-out infinite; }
.front .sp { flex: 1; }
.front .sig { position: relative; align-self: flex-end; width: 52%; }
.front .sig .bar { position: absolute; bottom: calc(100% + 1cqw); left: 50%; display: flex; gap: 1cqw; padding: 1.2cqw; background: #1E2559; border-radius: 3cqw; color: #fff; animation: s2-pop 4s ease-in-out infinite; white-space: nowrap; }
.front .sig .bar span { width: 8cqw; height: 7cqw; display: grid; place-items: center; } .front .sig .bar .del { color: #FF9C8F; }
.front .sig .bar svg { width: 4.6cqw; height: 4.6cqw; }
.front .sig .name { font-family: "Caveat", cursive; font-size: 10cqw; color: #1E2559; line-height: 1.1; text-align: center; animation: s2-sig 4s ease-in-out infinite; }
.front .sig .lbl { border-top: 1.5px solid #2A2E45; padding-top: 1.2cqw; font-size: 2.8cqw; color: #5D637A; }
.s2-badge { position: absolute; left: 0; bottom: 6%; display: flex; align-items: center; gap: 10px; padding: 10px 16px 10px 10px; border-radius: 18px; background: var(--surface); box-shadow: 0 16px 40px rgba(20,23,46,.16); font-size: 13px; font-weight: 600; animation: s2-up .6s .9s both; }
.s2-badge > span:first-child { width: 32px; height: 32px; border-radius: 10px; background: var(--success-bg); color: var(--success); display: grid; place-items: center; }
.s2-badge .t { display: flex; flex-direction: column; gap: 1px; } .s2-badge small { font-weight: 500; color: var(--muted); font-size: 12px; }
@keyframes s2-float { 0%, 100% { transform: translateY(0) rotate(var(--r)); } 50% { transform: translateY(-10px) rotate(var(--r)); } }
@keyframes s2-mark { 0%, 15% { background-size: 0% 42%; } 45%, 100% { background-size: 100% 42%; } }
@keyframes s2-sweep { 0%, 20% { width: 0; } 55%, 100% { width: 78%; } }
@keyframes s2-blink { 50% { opacity: 0; } }
@keyframes s2-sig { 0%, 40% { clip-path: inset(0 100% 0 0); } 80%, 100% { clip-path: inset(0 0 0 0); } }
@keyframes s2-pop { 0%, 55% { opacity: 0; transform: translate(-50%, 6px) scale(.94); } 70%, 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes s2-dash { to { stroke-dashoffset: -30; } }
@keyframes s2-scan { 0% { top: 6%; } 100% { top: 90%; } }
@keyframes s2-shim { to { background-position: -200% 0; } }
@keyframes s2-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes s2-glowpulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,225,77,.55), 0 30px 60px rgba(30,37,89,.35); } 50% { box-shadow: 0 0 0 14px rgba(255,225,77,0), 0 30px 60px rgba(30,37,89,.35); } }
.s2-recent { position: relative; width: 100%; max-width: 1560px; margin: 0 auto; padding: 8px 72px calc(48px + var(--safe-b)); animation: s2-up .6s .2s var(--ease) both; }
.s2-recent .rh { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.s2-recent h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.s2-recent .rs { font-size: 13px; color: var(--muted); }
.s2-recent .rl { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.s2-recent .rc { position: relative; border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-rest); transition: transform .2s var(--ease), box-shadow .2s; }
.s2-recent .rc:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(20,23,46,.12); }
.s2-recent .rc.off { opacity: .6; }
.s2-recent .ro { width: 100%; display: flex; align-items: center; gap: 14px; padding: 12px 44px 12px 12px; border: 0; background: none; text-align: left; font: inherit; color: var(--text); cursor: pointer; border-radius: 18px; }
.s2-recent .rt { width: 46px; height: 60px; flex: none; border-radius: 6px; background: #fff; box-shadow: 0 0 0 1px rgba(20,23,46,.1), 0 2px 6px rgba(20,23,46,.08); overflow: hidden; display: grid; place-items: center; color: #C0392B; }
.s2-recent .rt img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
.s2-recent .ri { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.s2-recent .ri b { font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.s2-recent .ri span { font-size: 12.5px; color: var(--muted); display: flex; align-items: center; gap: 7px; white-space: nowrap; overflow: hidden; }
.s2-recent .rk { font-style: normal; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: var(--chip); color: var(--muted-2); }
.s2-recent .rk.edited { background: var(--pill-chg); color: var(--on-pill-chg); }
.s2-recent .rk.scanned { background: var(--success-bg); color: var(--success); }
.s2-recent .rx { position: absolute; right: 8px; top: 50%; margin-top: -16px; width: 32px; height: 32px; border-radius: 50%; border: 0; background: transparent; color: var(--faint); display: grid; place-items: center; cursor: pointer; }
.s2-recent .rx:hover { background: var(--surface-2); color: var(--text); }
.s2-recent .rsh { position: absolute; right: 44px; top: 50%; margin-top: -17px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.s2-recent .rsh:hover { background: var(--surface-2); color: var(--text); }
.s2-recent .rc.sh .ro { padding-right: 84px; }
/* touch screens (the Android app): the start screen scrolls without a scroll bar */
@media (pointer: coarse) { .start { scrollbar-width: none; } .start::-webkit-scrollbar { display: none; } }
@container (min-width: 1600px) {
  .s2-hero { padding: 0 120px 48px; }
  .start h1 { font-size: clamp(76px, 5vw, 92px); } .s2-lead { font-size: 21px; }
  .s2-art { --pw: min(560px, calc((100vh - 220px) / 1.32), 36vw); }
}
@container (max-width: 1099px) {
  .s2-hero { grid-template-columns: minmax(0, 1fr); align-content: start; gap: 24px; padding: 24px 56px 48px; }
  .start h1 { font-size: 66px; }
  .s2-art { --pw: min(360px, 60vw); }
  .s2-recent { padding: 8px 56px calc(40px + var(--safe-b)); }
}
@container (max-width: 379px) { .s2-navbtn .lbl { display: none; } .s2-navbtn { padding: 0 11px; } .s2-nav { gap: 8px; } }
@container (max-width: 599px) {
  .s2-nav { padding: calc(16px + var(--safe-t)) calc(20px + var(--safe-r)) 0 calc(20px + var(--safe-l)); }
  .s2-hero { flex: none; gap: 0; padding: 16px calc(20px + var(--safe-r)) var(--safe-b) calc(20px + var(--safe-l)); }
  .s2-copy { gap: 14px; }
  .s2-pill { height: 30px; font-size: 12px; padding: 0 12px 0 4px; }
  .s2-pill .lk { width: 22px; height: 22px; }
  .start h1 { font-size: 36px; line-height: 1; letter-spacing: -.04em; } .s2-lead { font-size: 15px; line-height: 1.45; }
  .s2-card { padding: 16px; flex-direction: column; align-items: stretch; gap: 14px; border-radius: 24px; }
  .s2-card.drop .dash { inset: 6px; width: calc(100% - 12px); height: calc(100% - 12px); }
  .s2-card.drop .dash rect { rx: 19px; ry: 19px; }
  .s2-card.row { flex-direction: row; align-items: center; }
  .s2-tile { width: 48px; height: 48px; border-radius: 15px; }
  .s2-tile svg { width: 23px; height: 23px; }
  .s2-ct b { font-size: 17px; } .s2-ct span { font-size: 13px; }
  .s2-cta { width: 100%; height: 50px; font-size: 16px; }
  .s2-chips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .s2-chip { height: auto; flex-direction: column; justify-content: center; gap: 6px; padding: 12px 4px 10px; border-radius: 18px; font-size: 12.5px; white-space: normal; text-align: center; line-height: 1.15; }
  .s2-chip > span { width: 38px; height: 38px; }
  .s2-chip:hover { transform: none; }
  .s2-recent { padding: 22px calc(20px + var(--safe-r)) calc(28px + var(--safe-b)) calc(20px + var(--safe-l)); }
  .s2-recent h2 { font-size: 19px; }
  .s2-recent .rl { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .s2-recent .ro { padding: 10px 44px 10px 10px; }
  .s2-recent .rt { width: 40px; height: 52px; }
  .s2-art { --pw: 180px; height: 250px; }
  .s2-badge { display: none; }
  .s2-glow { width: 360px; height: 360px; }
}
@container (max-width: 379px) { .start h1 { font-size: 31px; } .s2-chip { font-size: 11.5px; } }
@media (prefers-reduced-motion: reduce) {
  .s2-art *, .s2-card .dash rect, .s2-mini .scan, .s2-bar > div, .s2-card.over { animation: none !important; }
  .front .sig .bar { opacity: 1; transform: translate(-50%, 0); }
  .front .hl .sweep { width: 78%; }
}
.progress { width: min(280px, 80%); height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.progress > div { height: 100%; background: var(--ink); border-radius: 3px; transition: width .2s; }
.err-ic { width: 56px; height: 56px; border-radius: 16px; background: var(--danger-bg); color: var(--danger); display: grid; place-items: center; }
.pw { display: flex; gap: 8px; width: min(340px, 100%); }
.more-tools { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ink); background: none; border: 0; padding: 0; height: 44px; }

/* ---------- editor shell (v2: floating chrome over the desk) ---------- */
.app { height: var(--app-h, 100%); display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--desk); }
.topbar { height: 60px; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 16px 0 12px; background: var(--surface); border-bottom: 1px solid var(--line); position: relative; z-index: 6; min-width: 0; }
.topbar.float { position: absolute; left: calc(16px + var(--safe-l)); right: calc(16px + var(--safe-r)); top: calc(16px + var(--safe-t)); z-index: 12; height: 60px; gap: 8px; padding: 0 8px; border: 0; border-radius: 20px; background: var(--glass); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 8px 24px rgba(20,23,46,.08); animation: pe-in .3s var(--ease) both; }
:root[data-theme="dark"] .topbar.float { box-shadow: 0 0 0 1px var(--line), 0 8px 24px rgba(0,0,0,.35); }
.topbar.float .ibtn { width: 44px; height: 44px; }
.topbar .doc { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; padding-left: 2px; }
.pdfchip { width: 32px; height: 40px; flex: none; border-radius: 4px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 5px; font-size: 9px; font-weight: 700; color: var(--danger); letter-spacing: .04em; }
.topbar .names { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.topbar .fname { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fmeta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.fmeta .dot { width: 3px; height: 3px; border-radius: 50%; background: currentColor; }
.fmeta .chg { height: 18px; padding: 0 7px; border-radius: 999px; background: var(--pill-chg); color: var(--on-pill-chg); font-weight: 600; display: inline-flex; align-items: center; font-variant-numeric: tabular-nums; }
.topbar .group { display: flex; align-items: center; gap: 0; }
.zoompill { display: flex; align-items: center; height: 40px; background: var(--chip); border-radius: 14px; padding: 0 4px; gap: 0; }
.zoompill .ibtn { width: 32px !important; height: 32px !important; border-radius: 10px; }
.zoompill .ibtn:hover:not(:disabled) { background: var(--surface); }
.zoompill .pct { min-width: 48px; text-align: center; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; border: 0; background: none; padding: 0; height: 32px; border-radius: 10px; }
.zoompill .pct:hover { background: var(--surface); }
.zoompill .div { width: 1px; height: 20px; background: var(--line); margin: 0 2px; }
.topbar .dl { height: 44px; padding: 0 18px 0 14px; font-weight: 700; box-shadow: 0 6px 16px rgba(30,37,89,.3); }
:root[data-theme="dark"] .topbar .dl { box-shadow: none; }

.body { flex: 1; min-height: 0; display: flex; position: relative; }
/* floating tool rail, grouped by intent */
.rail { position: absolute; left: calc(16px + var(--safe-l)); top: calc(92px + var(--safe-t)); bottom: calc(16px + var(--safe-b)); margin: auto 0; height: max-content; max-height: calc(100% - 108px - var(--safe-t) - var(--safe-b)); overflow-y: auto; scrollbar-width: none; z-index: 10; display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 26px; background: var(--surface); box-shadow: var(--shadow-lift); animation: rail-in .4s var(--ease) both; }
.rail::-webkit-scrollbar { display: none; }
.rgroup { display: flex; flex-direction: column; gap: 2px; }
.rgroup + .rgroup { padding-top: 6px; border-top: 1px solid var(--surface-3); }
@keyframes rail-in { from { opacity: 0; transform: translateX(-8px) scale(.97); } to { opacity: 1; transform: none; } }
.tool { width: 68px; height: 58px; flex: none; border-radius: 18px; border: 0; background: transparent; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: var(--muted-2); font-size: 10.5px; font-weight: 600; letter-spacing: .01em; transition: background .18s ease-out, color .18s ease-out, box-shadow .18s ease-out; padding: 0; position: relative; }
.tool:hover { background: var(--marker-100); color: var(--on-marker); }
:root[data-theme="dark"] .tool:hover { color: var(--text); }
.tool.active { background: var(--marker); color: var(--on-marker); box-shadow: 0 6px 14px rgba(224,180,0,.35); }
.tool span { white-space: nowrap; }
.tool.opts::after { content: ""; position: absolute; right: 7px; bottom: 7px; border-left: 5px solid transparent; border-bottom: 5px solid currentColor; opacity: .5; }
/* tool flyout: beside the rail, aligned to the tool */
.flyout2 { position: absolute; left: calc(116px + var(--safe-l)); z-index: 30; width: 252px; max-height: calc(100% - 16px); overflow-y: auto; padding: 14px; border-radius: 22px; background: var(--surface); box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 24px 60px rgba(20,23,46,.18); display: flex; flex-direction: column; gap: 14px; animation: fly-in .26s var(--ease) both; }
:root[data-theme="dark"] .flyout2 { box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgba(0,0,0,.5); }
@keyframes fly-in { from { opacity: 0; transform: translateX(-8px) scale(.97); } to { opacity: 1; transform: none; } }
.flyout2 .fh { display: flex; justify-content: space-between; align-items: center; }
.flyout2 .fh b { font-weight: 700; font-size: 14px; }
.flyout2 kbd { height: 22px; min-width: 22px; padding: 0 7px; border-radius: 7px; background: var(--chip); font: 700 11.5px/22px var(--font); color: var(--muted); text-align: center; }
.ftiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ftiles button { height: 56px; border-radius: 14px; border: 0; background: var(--chip); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11px; font-weight: 600; padding: 0; }
.ftiles button.on { background: #1E2559; color: #fff; }
.ftiles button.on svg { color: #FFE14D; }
.flyout2 .props.compact { padding: 0; gap: 14px; }
.flyout2.m { left: 12px; right: 12px; width: auto; top: auto; bottom: calc(92px + var(--safe-b)); }


/* thin, quiet scrollbars where the app scrolls (Windows drew wide grey bars next to each other) */
.canvasWrap, .ps-list, .panel, .props, .sheet-body { scrollbar-width: thin; scrollbar-color: rgba(30,37,89,.22) transparent; }
:root[data-theme="dark"] :is(.canvasWrap, .ps-list, .panel, .props, .sheet-body) { scrollbar-color: rgba(255,255,255,.22) transparent; }
:is(.canvasWrap, .ps-list, .panel, .props, .sheet-body)::-webkit-scrollbar { width: 8px; height: 8px; }
:is(.canvasWrap, .ps-list, .panel, .props, .sheet-body)::-webkit-scrollbar-track { background: transparent; }
:is(.canvasWrap, .ps-list, .panel, .props, .sheet-body)::-webkit-scrollbar-thumb { background: rgba(30,37,89,.22); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
:root[data-theme="dark"] :is(.canvasWrap, .ps-list, .panel, .props, .sheet-body)::-webkit-scrollbar-thumb { background-color: rgba(255,255,255,.22); }
:is(.canvasWrap, .ps-list, .panel, .props, .sheet-body)::-webkit-scrollbar-thumb:hover { background-color: rgba(30,37,89,.4); }
.canvasWrap::-webkit-scrollbar-corner { background: transparent; }
.canvasWrap.pan-ready, .canvasWrap.pan-ready * { cursor: grab !important; }
.canvasWrap.panning, .canvasWrap.panning * { cursor: grabbing !important; user-select: none; }
.canvasWrap { flex: 1; min-width: 0; position: relative; overflow: auto; touch-action: pan-x pan-y; overscroll-behavior: contain; background: var(--desk-dots); background-attachment: local; scroll-padding: calc(92px + var(--safe-t)) 0 24px; }
.bp-mobile .canvasWrap { scroll-padding: calc(132px + var(--safe-t)) 0 calc(110px + var(--safe-b)); }
/* the page column leaves room for the floating bar (top) and rail (left) */
.pages { display: flex; flex-direction: column; align-items: center; gap: 28px; padding: calc(100px + var(--safe-t)) calc(40px + var(--safe-r)) calc(96px + var(--safe-b)) calc(132px + var(--safe-l)); min-width: min-content; }
.bp-large .pages { padding: calc(100px + var(--safe-t)) 40px calc(96px + var(--safe-b)) 40px; }
.pagepill { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(20px + var(--safe-b)); height: 36px; padding: 0 14px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-lift); display: flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; z-index: 3; pointer-events: none; }
.pagepill b { color: var(--text); font-weight: 600; }
.deskWrap { flex: 1; min-width: 0; position: relative; display: flex; }

.side { width: 320px; flex: none; margin: calc(92px + var(--safe-t)) calc(16px + var(--safe-r)) calc(16px + var(--safe-b)) 0; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); overflow-y: auto; z-index: 4; }
.floatcard { position: absolute; bottom: calc(16px + var(--safe-b)); width: 320px; max-height: calc(100% - 108px - var(--safe-t) - var(--safe-b)); overflow-y: auto; background: var(--surface); border-radius: 22px; box-shadow: var(--shadow-lift); z-index: 8; animation: pe-in .22s var(--ease); }
.floatcard.r { right: calc(16px + var(--safe-r)); } .floatcard.l { left: calc(116px + var(--safe-l)); }

/* ---------- pages, text runs, objects ---------- */
.pageOuter { position: relative; flex: none; }
.pageNum { position: absolute; left: 0; right: 0; bottom: -22px; text-align: center; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.page { position: absolute; left: 50%; top: 50%; background: var(--paper); box-shadow: var(--shadow-page); border-radius: 3px; transform-origin: center; user-select: none; -webkit-user-select: none; }
.page canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 3px; }
.page .layer { position: absolute; inset: 0; }
.page.tool-text, .page.tool-fill { cursor: copy; }
.page.tool-whiteout, .page.tool-highlight, .page.tool-rect, .page.tool-ellipse, .page.tool-line, .page.tool-draw, .page.tool-underline, .page.tool-strike, .page.tool-arrow, .page.tool-link, .page.tool-remove { cursor: crosshair; touch-action: none; }
.page.tool-highlight, .page.tool-underline, .page.tool-strike { cursor: text; }

.run { position: absolute; white-space: pre; transform-origin: 0 0; border-radius: 2px; cursor: text; }
.tool-edit .run:hover, .tool-text .run:hover { outline: 1px dashed rgba(30,37,89,.6); outline-offset: 1px; }
.run .cover { position: absolute; inset: -2px -3px; border-radius: 1px; }
.findbar { position: absolute; z-index: 15; top: calc(88px + var(--safe-t)); left: 50%; transform: translateX(-50%); width: min(560px, calc(100% - 24px)); height: 52px; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 16px; border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-lift); color: var(--muted); animation: pe-in .2s ease-out; }
.findbar.m { top: calc(76px + var(--safe-t)); }
.findbar input { flex: 1; min-width: 0; height: 44px; border: 0; outline: 0; background: transparent; font: inherit; font-size: 15px; color: var(--text); padding: 0 6px; }
.findbar .fcount { font-size: 12.5px; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 36px; text-align: right; color: var(--muted-2); }
.findbar .ibtn { width: 38px; height: 38px; }
.privpanel { position: absolute; z-index: 15; top: calc(88px + var(--safe-t)); right: calc(16px + var(--safe-r)); width: 360px; max-height: calc(100% - 120px); overflow-y: auto; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); animation: pe-in .2s ease-out; }
.privpanel .props, .privsheet .props { gap: 14px; }
.privpanel h3, .privsheet h3 { margin: 0; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.privsheet { z-index: 31; }
.pc-wait { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 14px; padding: 8px 0; }
.pc-list { display: flex; flex-direction: column; gap: 8px; }
.pc-k { border-radius: 16px; box-shadow: inset 0 0 0 1px var(--line); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.pc-k.off { opacity: .55; }
.pc-top { display: flex; align-items: center; gap: 10px; cursor: pointer; }
.pc-top input { width: 18px; height: 18px; accent-color: var(--ink); flex: none; }
.pc-t { flex: 1; display: flex; flex-direction: column; gap: 1px; } .pc-t b { font-size: 14px; } .pc-t span { font-size: 12px; color: var(--muted); }
.pc-n { min-width: 26px; height: 24px; border-radius: 999px; background: #FDE2E2; color: #B42323; font-size: 12.5px; font-weight: 700; display: grid; place-items: center; padding: 0 8px; }
.pc-vals { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 28px; }
.pc-vals button { height: 28px; border: 0; border-radius: 8px; background: var(--surface-2); font: 12.5px ui-monospace, Menlo, Consolas, monospace; color: var(--text); padding: 0 8px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
.pc-vals small { font-family: var(--font); color: var(--muted); font-size: 11px; }
.pc-vals span { font-size: 12px; color: var(--muted); align-self: center; }
.linkbtn { border: 0; background: none; padding: 0; font: inherit; font-weight: 700; color: inherit; text-decoration: underline; cursor: pointer; }
.redbox { position: absolute; inset: 0; background: #111; background-image: repeating-linear-gradient(135deg, rgba(255,255,255,.06) 0 6px, transparent 6px 12px); }
.hitbox { position: absolute; background: rgba(255,196,0,.38); border-radius: 2px; mix-blend-mode: multiply; pointer-events: none; z-index: 2; }
.hitbox.cur { background: rgba(255,140,0,.55); box-shadow: 0 0 0 2px #FF8A00; }
.hitbox.priv { background: rgba(214,58,58,.28); box-shadow: inset 0 0 0 1.5px #D63A3A; mix-blend-mode: normal; }
.run canvas.cover { border-radius: 0; pointer-events: none; }
.run .txt { position: absolute; left: 0; white-space: pre; }
.run img.clone { position: absolute; max-width: none; pointer-events: none; user-select: none; }
.run textarea { position: absolute; left: 0; margin: 0; padding: 0; border: 0; border-radius: 3px; resize: none; overflow: hidden; white-space: pre; outline: none; box-shadow: 0 0 0 1.5px #1E2559; font-kerning: normal; }
.run.selected:not(.editing) { outline: 2px solid #1E2559; outline-offset: 3px; }
/* the editing field of a line: plain text, letters may have their own sizes (spans in em) */
.run .lfield { position: absolute; margin: 0; padding: 0 1px; border-radius: 3px; white-space: pre; outline: none; box-shadow: 0 0 0 1.5px #1E2559; font-kerning: normal; cursor: text; -webkit-user-select: text; user-select: text; }
.run .lfield ::selection, .run .lfield::selection { background: rgba(52,70,201,.28); }
/* moving a line: a dashed box to drag */
.run.moving { z-index: 4; }
.run .movebox { position: absolute; border: 1.5px dashed #3446C9; border-radius: 6px; background: rgba(52,70,201,.06); cursor: move; touch-action: none; pointer-events: auto; }
.run .movebox .grip { position: absolute; left: -12px; top: -12px; width: 24px; height: 24px; border-radius: 12px; background: #3446C9; color: #fff; display: grid; place-items: center; box-shadow: 0 2px 6px rgba(20,23,46,.25); }
/* copied text: tap where it goes */
.pastepill { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(150px + env(safe-area-inset-bottom)); z-index: 60; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 16px; border-radius: 999px; background: #1E2559; color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 10px 30px rgba(20,23,46,.3); max-width: calc(100vw - 32px); }
.pastepill .pp-t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pastepill button { border: 0; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; font: inherit; font-size: 13px; padding: 6px 12px; cursor: pointer; }
.desk .pastepill, .pastepill.desk { bottom: 24px; }
.page.pasting { cursor: copy; }
.run.changed, .run.edited { z-index: 1; }
.run.editing { z-index: 3; }
.draft, .draftline { z-index: 3; }
.layer.passive .run { pointer-events: none; }

.obj { position: absolute; touch-action: none; z-index: 2; }
.obj.thin::before { content: ''; position: absolute; left: 50%; top: 50%; width: max(100%, 36px); height: max(100%, 36px); transform: translate(-50%, -50%); }
.obj.selected { outline: 1.5px solid var(--sel); outline-offset: 0; }
:root[data-theme="dark"] .obj.selected { outline-color: #3446C9; }
.obj .dotc { position: absolute; width: 9px; height: 9px; background: #fff; border: 1.5px solid #3446C9; border-radius: 50%; pointer-events: none; }
.obj .handle { position: absolute; width: 18px; height: 18px; right: -9px; bottom: -9px; background: #3446C9; border: 2px solid #fff; border-radius: 50%; cursor: nwse-resize; touch-action: none; box-shadow: 0 1px 4px rgba(20,23,46,.3); display: grid; place-items: center; color: #fff; }
.obj .handle::after { content: ""; position: absolute; inset: -13px; }
.obj textarea, .obj .tview, .obj .tfield { position: absolute; inset: 0; margin: 0; padding: 0; border: 0; background: transparent; resize: none; overflow: hidden; white-space: pre; line-height: 1.2; outline: none; }
.obj.dragging { cursor: grabbing; }
.obj.editing { cursor: text; }
.obj .tfield { cursor: text; -webkit-user-select: text; user-select: text; font-kerning: normal; }
.obj .tfield[data-empty]::before { content: attr(data-ph); position: absolute; left: 0; top: 0; opacity: .38; pointer-events: none; font-weight: 400; font-style: normal; text-decoration: none; }
.obj .tfield ::selection, .obj .tfield::selection { background: rgba(52,70,201,.28); }
.ttools { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); width: 100%; }
.ttools button { flex: 1 1 0; min-width: 0; max-width: 44px; padding: 0; height: 38px; border: 0; border-radius: 11px; background: none; color: var(--text); display: grid; place-items: center; }
.ttools button:hover:not(:disabled):not(.on) { background: var(--hover, rgba(0,0,0,.05)); }
.ttools button.on { background: var(--ink); color: var(--on-ink); }
.ttools button:disabled { opacity: .35; }
.ttools .sep { width: 1px; height: 22px; background: var(--line-2); margin: 0 4px; flex: none; }
.slimbar .fmtrow { display: flex; align-items: center; gap: 8px; padding: 6px 8px 0; overflow-x: auto; scrollbar-width: none; }
.slimbar .fmtrow::-webkit-scrollbar { display: none; }
.slimbar .fmtrow .ttools { box-shadow: none; padding: 0; width: max-content; }
.slimbar .fmtrow .ttools button { flex: none; width: 40px; max-width: none; height: 40px; }
.tool-edit .obj { cursor: grab; }
.obj img { width: 100%; height: 100%; display: block; pointer-events: none; }
.obj > svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.draft { position: absolute; border: 1.5px dashed var(--sel); pointer-events: none; }
.draft.link { border-color: #2563EB; }
.obj .linkbox { position: absolute; inset: 0; border: 1.5px dashed #2563EB; background: rgba(37,99,235,.07); border-radius: 3px; color: #2563EB; display: flex; align-items: flex-start; justify-content: flex-end; padding: 1px; }
.guide { position: absolute; background: #3446C9; pointer-events: none; z-index: 4; }
.guide.v { top: 0; bottom: 0; width: 1px; } .guide.h { left: 0; right: 0; height: 1px; }

/* floating object toolbar (fixed, kept on screen) */
.objbar { position: fixed; display: flex; align-items: center; gap: 2px; padding: 4px; background: var(--bar); color: #fff; border-radius: 16px; box-shadow: 0 10px 28px rgba(20,23,46,.28); z-index: 40; white-space: nowrap; font-family: var(--font); animation: pe-fade .15s ease-out; }
.objbar::after { content: ""; position: absolute; left: clamp(14px, var(--ax, 50%), calc(100% - 14px)); top: 100%; margin-left: -6px; border: 6px solid transparent; border-top-color: var(--bar); }
.objbar.below::after { top: auto; bottom: 100%; border-top-color: transparent; border-bottom-color: var(--bar); }
.objbar button { width: 40px; height: 40px; display: grid; place-items: center; border: 0; border-radius: 12px; background: transparent; color: #fff; padding: 0; touch-action: none; }
.objbar button:hover { background: rgba(255,255,255,.14); }
.objbar button.danger { color: #FF9C8F; }
.objbar .grip { cursor: grab; opacity: .9; }
.objbar .sep { width: 1px; height: 20px; background: rgba(255,255,255,.18); margin: 0 2px; }
.objbar .fsize { min-width: 24px; text-align: center; font-weight: 600; font-size: 13px; font-variant-numeric: tabular-nums; }
.objbar.moving { background: transparent; box-shadow: none; }
.objbar.moving::after, .objbar.moving > :not(.grip) { visibility: hidden; }
.objbar.moving .grip { background: var(--bar); box-shadow: 0 8px 24px rgba(20,23,46,.25); }
.objbar svg { pointer-events: none; }
.loupe { position: fixed; z-index: 80; border-radius: 14px; overflow: hidden; pointer-events: none; border: 3px solid #fff; box-shadow: 0 0 0 1.5px #1E2559, 0 14px 34px -8px rgba(20,24,56,.55); background: #fff; }
.loupe canvas { display: block; }

/* ---------- properties panel ---------- */
.props { display: flex; flex-direction: column; gap: 24px; padding: 20px 20px 24px; }
.props .head { display: flex; align-items: flex-start; gap: 12px; }
.props .head .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.props .head h3 { margin: 0; font-size: 17px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.props .head .ibtn { width: 36px; height: 36px; color: var(--muted); }
.props .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.props .acts { display: flex; flex-direction: column; gap: 8px; }
.props .acts2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.props .hint { font-size: 12.5px; line-height: 1.55; color: var(--muted); }
.props .lineacts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.props .lineacts .btn { justify-content: center; padding-left: 8px; padding-right: 8px; min-width: 0; }
.props .keys { font-size: 12.5px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
.props .keys b { font-weight: 600; }
.fontbox { height: 44px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); display: flex; align-items: center; gap: 10px; padding: 0 12px; min-width: 0; }
.fontbox .aa { font-size: 16px; flex: none; }
.fontbox .fn { flex: 1; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { font-size: 11px; font-weight: 600; padding: 3px 7px; border-radius: 6px; background: var(--surface-2); color: var(--muted); flex: none; }
.note { font-size: 13px; color: var(--muted-2); background: var(--surface-2); border-radius: 16px; padding: 12px; display: flex; gap: 10px; line-height: 1.45; }
.note.warn { background: #FFF6D6; color: #6A5300; }
:root[data-theme="dark"] .note.warn { background: #3A3620; color: #F3E3A0; }
.btn.outline { box-shadow: inset 0 0 0 1px var(--line-2); height: 44px; }
.btn.outline:hover:not(:disabled) { background: var(--surface-2); }
.btn.outline.danger:hover:not(:disabled) { background: var(--danger-bg); }
.changes { display: flex; flex-direction: column; gap: 2px; }
.changes button { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 8px; margin: 0 -8px; border-radius: 14px; border: 0; background: none; text-align: left; color: var(--text); min-width: 0; }
.changes button:hover { background: var(--surface-2); }
.changes button svg { color: var(--muted); }
.changes .l { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.changes .p { font-size: 12px; color: var(--muted); flex: none; }
.empty-changes { font-size: 13px; color: var(--muted); padding: 8px 0; }
.bstyle { height: 44px; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); display: grid; grid-template-columns: 1fr 1fr; padding: 3px; gap: 3px; }
.bstyle button { border: 0; border-radius: 11px; background: none; font-size: 15px; }
.bstyle button.on { background: var(--ink); color: var(--on-ink); }
.bstyle button:disabled { opacity: .35; }
.fontpick { display: flex; flex-wrap: wrap; gap: 6px; }
.fontpick button { min-height: 36px; max-width: 100%; padding: 0 12px; border: 0; border-radius: 11px; background: var(--surface-3); color: var(--text); font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fontpick button.std { color: var(--muted-2); }
.fontpick button.on { background: var(--ink); color: var(--on-ink); }
.range { width: 100%; accent-color: var(--ink); height: 44px; }

/* ---------- mobile ---------- */
.dock3 { position: absolute; left: calc(10px + var(--safe-l)); right: calc(10px + var(--safe-r)); bottom: calc(10px + var(--safe-b)); height: 72px; z-index: 12; border-radius: 24px; background: var(--surface); box-shadow: 0 12px 36px rgba(20,23,46,.16), 0 0 0 1px rgba(20,23,46,.05); display: flex; align-items: stretch; padding: 0 4px; animation: pe-in .3s var(--ease) both; }
:root[data-theme="dark"] .dock3 { box-shadow: 0 14px 40px rgba(0,0,0,.55), 0 0 0 1px var(--line); }
.dock3 .dk-scroll { flex: 1; min-width: 0; display: flex; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 26px), transparent); mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 26px), transparent); }
.dock3 .dk-scroll::-webkit-scrollbar { display: none; }
.dk3 { flex: none; width: 64px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 0; background: none; padding: 0; color: var(--muted); font: inherit; font-size: 11.5px; font-weight: 600; letter-spacing: -.005em; scroll-snap-align: start; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.dk3 .ic { width: 50px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: var(--muted-2); transition: background .22s var(--ease), color .22s var(--ease), transform .15s var(--ease); }
.dk3.on { color: var(--text); font-weight: 700; }
.dk3.on .ic { background: var(--ink); color: var(--on-ink); }
.dk3:active .ic { transform: scale(.9); }
.dk3.more { width: 60px; }
.dock3 .sep { width: 1px; flex: none; background: var(--line); margin: 16px 2px; }
.pgtab { position: absolute; right: calc(10px + var(--safe-r)); bottom: calc(96px + var(--safe-b)); z-index: 11; height: 40px; padding: 0 14px 0 12px; border: 0; border-radius: 999px; background: var(--surface); color: var(--muted); box-shadow: var(--shadow-lift); display: flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; cursor: pointer; animation: pe-in .3s var(--ease) both; }
.pgtab svg { color: var(--ink); margin-right: 4px; }
.pgtab b { color: var(--text); }
.bp-tablet .pgtab { bottom: calc(20px + var(--safe-b)); }
.pstrip { width: 164px; flex: none; margin: calc(92px + var(--safe-t)) 12px calc(16px + var(--safe-b)) 0; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); display: flex; flex-direction: column; overflow: hidden; z-index: 4; animation: ps-in .3s var(--ease) both; }
.pstrip.ov { position: absolute; right: calc(10px + var(--safe-r)); top: calc(84px + var(--safe-t)); bottom: calc(92px + var(--safe-b)); width: 138px; margin: 0; z-index: 14; }
.pstrip.ov .ps-c { display: none; }
.pstrip.ov .ps-h { padding-left: 12px; }
.pstrip.ov .ps-h .ibtn { width: 32px; height: 32px; }
.pstrip.ov .ps-list { padding: 6px 14px 14px; }
.bp-tablet .pstrip.ov { bottom: calc(16px + var(--safe-b)); width: 150px; }
.ps-scrim { position: absolute; inset: 0; z-index: 13; background: transparent; }
@keyframes ps-in { from { opacity: 0; transform: translateX(16px); } }
.ps-h { display: flex; align-items: center; gap: 0; padding: 8px 6px 4px 14px; min-width: 0; }
.ps-h b { font-size: 14px; font-weight: 700; white-space: nowrap; }
.ps-h .ibtn { flex: none; }
.ps-h .ps-c { flex: none; margin-left: 6px; font-size: 11.5px; font-weight: 700; color: var(--muted); background: var(--chip); border-radius: 999px; padding: 1px 7px; font-variant-numeric: tabular-nums; }
.ps-h .ibtn { width: 32px; height: 32px; }
.ps-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 16px 16px; display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; }
.ps-it { display: flex; flex-direction: column; align-items: center; gap: 5px; border: 0; background: none; padding: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; color: var(--muted); -webkit-tap-highlight-color: transparent; }
.ps-th { width: 100%; display: block; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 1px 2px rgba(20,23,46,.08), 0 0 0 1px rgba(20,23,46,.08); outline: 2.5px solid transparent; outline-offset: 2px; transition: outline-color .15s, transform .15s var(--ease); }
.ps-th canvas { width: 100%; height: auto; display: block; }
.ps-it:hover .ps-th { outline-color: var(--line-3); }
.ps-it:active .ps-th { transform: scale(.97); }
.ps-it.on .ps-th { outline-color: var(--sel); }
.ps-it.on .ps-n { color: #fff; background: var(--sel); }
:root[data-theme="dark"] .ps-it.on .ps-n { color: var(--on-ink); }
.ps-n { min-width: 22px; padding: 1px 6px; border-radius: 999px; text-align: center; font-variant-numeric: tabular-nums; }
.rothandle { position: absolute; left: 50%; top: -38px; width: 26px; height: 26px; margin-left: -13px; border-radius: 50%; background: var(--surface); color: var(--sel); box-shadow: 0 1px 4px rgba(20,23,46,.25), 0 0 0 1.5px var(--sel); display: grid; place-items: center; cursor: grab; touch-action: none; z-index: 3; }
.rothandle::after { content: ''; position: absolute; left: 50%; top: 26px; width: 1.5px; height: 12px; margin-left: -.75px; background: var(--sel); pointer-events: none; }
.rothandle::before { content: ''; position: absolute; inset: -10px; }
.rothandle:active { cursor: grabbing; }
.rotval { position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%); padding: 3px 8px; border-radius: 8px; background: var(--toast); color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; pointer-events: none; }
.ibtn.on { background: var(--sel-tint); color: var(--sel); }
.toolsheet { position: absolute; left: 8px; right: 8px; bottom: calc(8px + var(--safe-b)); z-index: 21; max-height: calc(100% - 24px - var(--safe-t) - var(--safe-b)); overflow-y: auto; border-radius: 32px; background: var(--surface); padding: 10px 16px 20px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 -10px 40px rgba(20,23,46,.2); animation: sheet-up .32s var(--ease) both; }
@keyframes sheet-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
.toolsheet .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line-2); align-self: center; flex: none; }
.toolsheet .tsh { display: flex; align-items: center; gap: 4px; padding: 0 0 0 4px; }
.toolsheet .tsh h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -.02em; }
.ibtn.round { border-radius: 50%; background: var(--chip); width: 44px; height: 44px; }
.toolsheet .tsg { display: flex; flex-direction: column; gap: 8px; }
.toolsheet .kicker { font-size: 11.5px; font-weight: 700; letter-spacing: .07em; padding: 0 4px; }
.toolsheet .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.toolsheet .tile { height: 84px; border-radius: 20px; border: 0; background: var(--surface-2); color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; font-size: 12px; font-weight: 600; padding: 0; }
.toolsheet .tile.on { background: #1E2559; color: #fff; }
.toolsheet .tile .chip { width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; color: var(--on-tint); }
.toolsheet .tile.on .chip, .toolsheet .tile .chip[style*="FFE14D"], .toolsheet .tile .chip[style*="marker"], .toolsheet .tile .chip[style*="tint-add"] { color: #1E2559; }
.toolsheet .more-tools { align-self: center; }
.slimbar.fillfloat { position: absolute; left: 12px; right: 12px; bottom: calc(96px + var(--safe-b)); border: 0; border-radius: 20px; box-shadow: var(--shadow-lift); padding-bottom: 0; z-index: 11; }
.slimbar { flex: none; position: relative; z-index: 7; background: var(--surface); border-top: 1px solid var(--line); animation: pe-in .2s ease-out; padding-bottom: var(--safe-b); }
.slimbar .row { display: flex; align-items: center; gap: 6px; padding: 6px 8px; }
.slimbar .chipb { height: 44px; padding: 0 10px; border-radius: 14px; background: var(--surface-2); display: flex; align-items: center; gap: 6px; font-weight: 500; min-width: 0; max-width: 34vw; border: 0; }
.slimbar .chipb .fn { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slimbar .stepper { height: 44px; box-shadow: none; background: var(--surface-2); flex: none; }
.slimbar .stepper button { width: 36px; }
.slimbar .stepper .v { min-width: 24px; padding: 0 2px; }
.slimbar .cdot { width: 44px; height: 44px; border-radius: 14px; background: var(--surface-2); display: grid; place-items: center; border: 0; flex: none; }
.slimbar .cdot i { width: 22px; height: 22px; border-radius: 50%; box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px var(--line-2); }
.slimbar .sp { flex: 1; }
.slimbar .btn.primary { height: 44px; padding: 0 14px; }
.slimbar .more { max-height: 46vh; overflow-y: auto; border-top: 1px solid var(--line); }
.slimbar .more .props { padding-top: 16px; }
.sheet-scrim { position: absolute; inset: 0; z-index: 20; background: var(--scrim); animation: pe-fade .2s; }
.bsheet { position: absolute; left: 0; right: 0; bottom: 0; z-index: 21; background: var(--surface); border-radius: 28px 28px 0 0; box-shadow: 0 -10px 40px rgba(16,19,40,.25); max-height: calc(80% - var(--safe-t)); overflow-y: auto; animation: pe-in .26s ease-out; padding-bottom: var(--safe-b); }
.bsheet .grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 10px auto 0; }

/* ---------- modal / signature ---------- */
.scrim { position: fixed; inset: 0; background: var(--scrim); display: flex; align-items: center; justify-content: center; z-index: 50; padding: calc(24px + var(--safe-t)) 24px calc(24px + var(--safe-b)); animation: pe-fade .2s; }
.modal { background: var(--surface); border-radius: 28px; width: 100%; max-width: 560px; max-height: calc(100% - 16px); overflow: auto; padding: 24px; box-shadow: var(--shadow-modal); display: flex; flex-direction: column; gap: 20px; animation: pe-in .24s ease-out; }
.modal .mhead { display: flex; align-items: center; gap: 12px; }
.modal .mhead h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.modal .mhead .ibtn { color: var(--muted); }
.modal .grab { display: none; }
.saved { display: flex; gap: 10px; overflow-x: auto; padding: 2px; scrollbar-width: thin; }
.saved .s { position: relative; flex: none; width: 150px; height: 64px; border-radius: 16px; box-shadow: inset 0 0 0 1px var(--line-2); background: #fff; display: flex; align-items: center; justify-content: center; padding: 8px 28px 8px 12px; transition: box-shadow .15s; }
.saved .s:hover, .saved .s:focus-visible { box-shadow: inset 0 0 0 2px var(--ink); outline: none; }
.saved .s img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.saved .s .x { position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border-radius: 6px; border: 0; background: transparent; color: #5D637A; display: grid; place-items: center; padding: 0; }
.saved .s .x:hover { background: #FBE7E4; color: #B83227; }
.sigpad { position: relative; height: 220px; border-radius: 20px; background: #F7F8FA; color: #151833; border: 1px dashed #BFC4D2; touch-action: none; overflow: hidden; }
.sigpad canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.sigpad .base { position: absolute; left: 28px; right: 28px; bottom: 34%; border-top: 1px solid #BFC4D2; pointer-events: none; }
.sigpad .xm { position: absolute; left: 28px; bottom: calc(34% + 6px); color: #A7ACBE; pointer-events: none; }
.sigpad .ph { position: absolute; right: 12px; top: 10px; font-size: 12px; color: #5D637A; pointer-events: none; }
.sigpad.upload { display: grid; place-items: center; text-align: center; cursor: pointer; padding: 16px; border-style: dashed; }
.typed { display: flex; flex-direction: column; gap: 10px; }
.typed .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.typed .opts button { height: 64px; border: 0; box-shadow: inset 0 0 0 1px var(--line-2); border-radius: 16px; background: #fff; font-size: 28px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 10px; }
.typed .opts button.on { box-shadow: inset 0 0 0 2px var(--ink); }
.inkrow { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.inkrow .inks { display: flex; align-items: center; gap: 10px; }
.modal .foot { display: flex; gap: 10px; }
.modal .foot .btn.primary { flex: 1; }
.modal.confirm { max-width: 420px; gap: 22px; padding: 28px; }
.cc-head { display: flex; flex-direction: column; gap: 16px; }
.cc-tile { width: 52px; height: 52px; border-radius: 18px; background: var(--marker); color: #1E2559; display: grid; place-items: center; flex: none; }
.cc-head h2 { margin: 0 0 6px; font-size: 21px; font-weight: 700; letter-spacing: -.015em; }
.cc-head p { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
.cc-actions { display: flex; flex-direction: column; gap: 8px; }
.cc-actions .btn { width: 100%; justify-content: center; }
.cc-actions .btn.danger { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 35%, transparent); }
.scrim.sheet .modal.confirm { padding: 10px 20px calc(20px + var(--safe-b)); gap: 20px; }
.scrim.sheet .modal.confirm .cc-head { flex-direction: row; align-items: flex-start; margin-top: 8px; }

/* ---------- export progress / busy / toast ---------- */
.busy { position: fixed; inset: 0; z-index: 70; background: color-mix(in srgb, var(--desk) 60%, transparent); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 24px; animation: pe-fade .2s; }
.busy .card { width: 100%; max-width: 360px; background: var(--surface); border-radius: 28px; padding: 28px; box-shadow: 0 24px 60px rgba(16,19,40,.22); display: flex; flex-direction: column; gap: 16px; animation: pe-in .24s ease-out; }
.busy .ic { width: 48px; height: 48px; border-radius: 16px; background: var(--marker); color: #1E2559; display: grid; place-items: center; }
.busy h3 { margin: 0; font-size: 18px; font-weight: 600; }
.busy p { margin: 0; color: var(--muted); line-height: 1.5; }
.busy .progress { width: 100%; }
.busy .progress.indet > div { width: 40%; animation: indet 1.2s ease-in-out infinite; }
@keyframes indet { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
.toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); z-index: 90; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; border-radius: 18px; background: var(--toast); color: #fff; box-shadow: 0 14px 40px rgba(16,19,40,.3); max-width: calc(100% - 32px); animation: toast-in .24s var(--ease); }
@keyframes toast-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
.toast .ti { width: 26px; height: 26px; flex: none; border-radius: 50%; background: #5BD69A; color: #0E3B26; display: grid; place-items: center; }
.toast.err .ti { background: #FF8A7E; color: #4A0F0A; }
.toast .tm { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast .ta { height: 36px; padding: 0 12px; border-radius: 9px; border: 0; background: none; color: #FFE14D; font-weight: 600; flex: none; }
.toast .ta:hover { background: rgba(255,255,255,.08); }
.toast.solo { padding-right: 16px; }

/* ---------- page organizer ---------- */
.org { position: absolute; inset: 0; z-index: 5; background: var(--desk-dots), var(--desk); overflow: auto; display: flex; flex-direction: column; gap: 20px; padding: calc(100px + var(--safe-t)) 48px calc(96px + var(--safe-b)) calc(132px + var(--safe-l)); }
.org .ohead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; max-width: 1240px; width: 100%; margin: 0 auto; }
.org .ohead .t { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; }
.org .ohead h2 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.org .ohead p { margin: 0; color: var(--muted); font-size: 13px; }
.org .selbar { display: flex; align-items: center; gap: 6px; height: 48px; padding: 0 6px 0 16px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-card); font-weight: 600; }
.org .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; max-width: 1240px; width: 100%; margin: 0 auto; }
.org .grid { position: relative; }
.oslot { position: relative; }
.oadd { width: 100%; height: 100%; min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 2px dashed var(--line); border-radius: 20px; background: transparent; color: var(--muted); font: inherit; cursor: pointer; transition: border-color .15s, background .15s, color .15s; }
.oadd:hover, .oadd:focus-visible { border-color: var(--sel); background: var(--sel-tint); color: var(--text); }
.oadd .pl { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: #1E2559; color: #fff; margin-bottom: 4px; }
.oadd b { font-size: 14px; color: var(--text); }
.oadd span:last-child { font-size: 12px; }
.ps-add { margin: 0 12px 12px; height: 40px; border-radius: 14px; border: 1.5px dashed var(--line); background: transparent; color: var(--text); font: inherit; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 6px; flex: none; cursor: pointer; }
.ps-add:hover { border-color: var(--sel); background: var(--sel-tint); }
.bsheet.addpg { z-index: 31; }
.bsheet.keys { position: fixed; z-index: 61; left: 50%; top: 50%; right: auto; bottom: auto; transform: translate(-50%, -50%); width: min(940px, calc(100vw - 32px)); max-height: calc(100vh - 64px); border-radius: 24px; animation: pe-fade .15s; }
.keys-scrim { z-index: 60 !important; background: rgba(16,19,40,.35); }
.keys-h { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 6px 24px; }
.keys-h h3 { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 18px; }
.keys-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px 28px; padding: 6px 24px 24px; }
.keys-grid h4 { margin: 12px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.keys-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 13.5px; border-bottom: 1px solid var(--line, rgba(20,23,46,.06)); }
.keys-k { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.keys-k i { font-style: normal; color: var(--faint, #9aa0b5); font-size: 11px; }
.keys-row kbd { font: 600 11.5px/1 var(--font); padding: 5px 7px; border-radius: 7px; background: var(--surface-2, #F3F4F8); box-shadow: inset 0 -1px 0 var(--line-2, rgba(20,23,46,.12)), 0 0 0 1px var(--line-2, rgba(20,23,46,.1)); color: var(--text); white-space: nowrap; }
.filescrim { z-index: 30; }
.bsheet.filesheet { z-index: 31; padding: 0 18px calc(18px + var(--safe-b)); }
.bsheet.filesheet.center { top: 0; bottom: 0; left: 0; right: 0; margin: auto; height: max-content; width: min(440px, calc(100% - 32px)); border-radius: 24px; box-shadow: var(--shadow-modal); padding-top: 4px; }
.fs-h { display: flex; align-items: center; gap: 12px; padding: 14px 0 12px; }
.fs-h > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fs-h b { font-size: 18px; font-weight: 800; letter-spacing: -.01em; }
.fs-h span { font-size: 12.5px; color: var(--muted); }
.fs-ic { width: 44px; height: 44px; border-radius: 14px; background: var(--surface-2); color: #C0392B; display: grid; place-items: center; flex: none; }
.fs-name { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.fs-name small { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fs-acts { display: grid; gap: 8px; }
.fs-acts button { display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; column-gap: 12px; align-items: center; text-align: left; padding: 10px 12px; border: 0; border-radius: 16px; background: var(--surface-2); color: var(--text); font: inherit; cursor: pointer; }
.fs-acts button:hover { background: var(--chip); }
.fs-acts .ic { grid-row: span 2; width: 44px; height: 44px; border-radius: 12px; background: var(--surface); display: grid; place-items: center; color: var(--accent, #3446C9); }
.fs-acts b { font-size: 15px; font-weight: 700; }
.fs-acts span:not(.ic) { font-size: 12.5px; color: var(--muted); }
.topbar .fbtn { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0; padding: 2px 6px; margin: 0 -6px; border: 0; border-radius: 8px; background: none; color: inherit; font: inherit; font-weight: 700; font-size: 15px; cursor: pointer; text-align: left; }
.topbar .fbtn span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.topbar .fbtn svg { flex: none; opacity: .55; }
.topbar .fbtn:hover { background: var(--surface-2); }
.bsheet.addpg.center { top: 0; bottom: 0; left: 0; right: 0; margin: auto; height: max-content; width: min(420px, calc(100% - 32px)); border-radius: 24px; box-shadow: var(--shadow-modal); }
.addpg .props { gap: 12px; }
.addpg .ap-h, .privpanel .ap-h, .privsheet .ap-h { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.addpg .ap-h h3, .privpanel .ap-h h3, .privsheet .ap-h h3 { margin: 0; font-size: 18px; font-weight: 700; }
.addpg .ap-h .label, .privpanel .ap-h .label, .privsheet .ap-h .label { font-weight: 400; }
.addpg .ap-blank { cursor: default; }
.addpg .ap-or { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.addpg .ap-or::before, .addpg .ap-or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.oslot.hole::before { content: ""; position: absolute; inset: 2px; border-radius: 20px; border: 2px dashed var(--sel); background: var(--sel-tint); }
.oslot.hole > .ocard { opacity: 0; }
.ocard { display: flex; flex-direction: column; gap: 4px; padding: 10px 6px 2px; border-radius: 20px; transition: box-shadow .18s, background .18s; position: relative; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
.ocard .sq { position: relative; aspect-ratio: 1; display: grid; place-items: center; cursor: grab; }
.ocard .sq canvas { max-width: 100%; max-height: 100%; background: #fff; border-radius: 3px; box-shadow: 0 1px 2px rgba(20,23,46,.08), 0 6px 16px rgba(20,23,46,.10); display: block; transition: transform .2s; }
.ocard .row { display: flex; align-items: center; gap: 2px; }
.ocard .row .n { flex: 1; min-width: 0; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ocard .row .ibtn { width: 44px; height: 44px; }
.ocard .handle { width: 40px; height: 44px; display: grid; place-items: center; color: var(--muted); cursor: grab; touch-action: none; border: 0; background: none; padding: 0; }
.ocard .sq canvas { -webkit-user-drag: none; }
.ocard .ck { position: absolute; top: 18px; left: 14px; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.92); box-shadow: inset 0 0 0 1.5px #9AA0B4; color: transparent; z-index: 1; border: 0; padding: 0; }
.ocard.on .ck { background: var(--ink); color: var(--on-ink); box-shadow: none; }
.ocard.on .sq canvas { box-shadow: 0 0 0 3px var(--ink), 0 8px 20px rgba(20,23,46,.14); }

/* ---------- tools hub & tool screens ---------- */
.tscreen > .topbar { height: calc(60px + var(--safe-t)); padding-top: var(--safe-t); padding-left: calc(12px + var(--safe-l)); padding-right: calc(16px + var(--safe-r)); }
.tscreen { height: var(--app-h, 100%); display: flex; flex-direction: column; overflow: hidden; background: var(--desk-dots), var(--desk); }
.tbody { flex: 1; min-height: 0; display: flex; }
.tbody { position: relative; }
.tmain { flex: 1; min-width: 0; overflow: auto; padding: 40px 48px; display: flex; flex-direction: column; align-items: center; }
.tside { width: 340px; flex: none; margin: 16px calc(16px + var(--safe-r)) calc(16px + var(--safe-b)) 0; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); display: flex; flex-direction: column; overflow: hidden; }
.tside .sb { flex: 1; min-height: 0; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 22px; }
.tside .sf { padding: 16px 24px 24px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--line); }
.tside h3 { margin: 0; font-size: 17px; font-weight: 600; }
.tbar { flex: none; display: flex; align-items: center; gap: 12px; padding: 12px 16px calc(12px + var(--safe-b)); background: var(--surface); border-top: 1px solid var(--line); }
.tbar .t { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tbar .t b, .tbar .t span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tbar .t b { font-weight: 600; font-size: 14.5px; }
.tbar .t span { font-size: 12.5px; color: var(--muted); }
/* the action keeps its natural width; the status text gets the rest */
.tbar > .btn, .tbar > .btn.block { width: auto; flex: none; max-width: 62%; }
.privacy-pill { display: flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; border-radius: 999px; background: var(--chip); font-size: 12.5px; color: var(--muted-2); font-weight: 500; white-space: nowrap; }
.privacy-pill svg { color: var(--success); }
.hub { width: 100%; max-width: 1240px; display: flex; flex-direction: column; gap: 28px; }
.hub h1 { margin: 0; font-size: 40px; font-weight: 800; letter-spacing: -.035em; line-height: 1.05; }
.hub .sub { font-size: 15px; color: var(--muted); }
.hub .grp { display: flex; flex-direction: column; gap: 12px; }
.hub .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.hcard { display: flex; align-items: center; gap: 14px; padding: 16px 18px; background: var(--surface); border-radius: 20px; box-shadow: var(--shadow-card); border: 0; text-align: left; min-height: 44px; transition: box-shadow .18s; color: var(--text); }
.hcard { transition: box-shadow .2s, transform .2s var(--ease); }
.hcard:hover { transform: translateY(-2px); box-shadow: 0 10px 24px rgba(20,23,46,.12), 0 0 0 1px rgba(20,23,46,.05); }
.hcard .ti { width: 44px; height: 44px; flex: none; border-radius: 14px; color: #1E2559; display: grid; place-items: center; }
.hcard .tt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.hcard .tt b { font-weight: 600; font-size: 15px; }
.hcard .tt span { font-size: 13px; color: var(--muted); line-height: 1.35; }
.hcard > svg:last-child { color: var(--faint); }
.flist { width: 100%; max-width: 760px; display: flex; flex-direction: column; gap: 10px; }
.frow { display: flex; align-items: center; gap: 10px; padding: 8px 6px 8px 4px; background: var(--surface); border-radius: 18px; box-shadow: var(--shadow-card); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
.frow.hole, .qrow.hole { background: var(--sel-tint); box-shadow: none; outline: 2px dashed var(--sel); outline-offset: -2px; }
.frow.hole > *, .qrow.hole > * { visibility: hidden; }
.fgrip { width: 28px; height: 44px; flex: none; border: 0; background: none; color: var(--faint); cursor: grab; display: grid; place-items: center; padding: 0; border-radius: 8px; }
.fgrip:hover { color: var(--muted); background: var(--surface-2); }
/* the item under the finger while dragging */
@keyframes dnd-pick { from { transform: none; box-shadow: var(--shadow-card); } }
.dnd-lift { width: 100%; height: 100%; cursor: grabbing; }
.dnd-lift > * { height: 100%; background: var(--surface); box-shadow: 0 22px 48px rgba(20,23,46,.26), 0 0 0 2px var(--sel); animation: dnd-pick .16s ease-out; }
.dnd-lift > .ocard { transform: scale(1.04) rotate(-1.5deg); }
.dnd-lift > .frow, .dnd-lift > .qrow { transform: scale(1.02) rotate(-.6deg); border-radius: 18px; }
:root[data-theme="dark"] .dnd-lift > * { box-shadow: 0 22px 48px rgba(0,0,0,.6), 0 0 0 2px var(--sel); }
.frow .fthumb { width: 40px; height: 54px; flex: none; background: #fff; border-radius: 3px; box-shadow: 0 0 0 1px var(--line), 0 2px 6px rgba(20,23,46,.08); overflow: hidden; display: grid; place-items: center; }
.frow .fthumb canvas, .frow .fthumb img { max-width: 100%; max-height: 100%; display: block; }
.frow .fi { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.frow .fi b { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.frow .fi span { font-size: 12.5px; color: var(--muted); }
.frow .range-in { width: 104px; height: 34px; border-radius: 10px; background: var(--surface-3); border: 0; font-size: 12.5px; font-weight: 600; padding: 0 10px; text-align: center; }
.adddash { height: 60px; border-radius: 18px; border: 1.5px dashed var(--line-3); display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 600; color: var(--ink); background: none; width: 100%; }
.adddash:hover { background: var(--surface); }
.pgrid { width: 100%; max-width: 1040px; display: flex; flex-direction: column; gap: 18px; }
.pgrid .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.pgrid .cells { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 28px 26px; }
.pcell { display: flex; flex-direction: column; align-items: center; gap: 8px; position: relative; }
.pcell.fresh .pc canvas { box-shadow: 0 0 0 3px var(--sel), 0 8px 20px rgba(20,23,46,.14); }
.pcell .newtag { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); z-index: 2; background: var(--sel); color: #fff; font-size: 11px; font-weight: 700; padding: 2px 9px; border-radius: 999px; box-shadow: 0 2px 6px rgba(20,23,46,.2); }
.tbar > .btn + .btn { margin-left: -4px; }
.pcell .pc { position: relative; width: 100%; aspect-ratio: 1 / 1.414; display: grid; place-items: center; border-radius: 4px; cursor: pointer; border: 0; padding: 0; background: transparent; }
.pcell .pc canvas { max-width: 100%; max-height: 100%; background: #fff; border-radius: 4px; box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 6px 16px rgba(20,23,46,.08); display: block; }
.pcell.on .pc canvas { box-shadow: 0 0 0 3px var(--ink), 0 8px 20px rgba(20,23,46,.14); }
.pcell.rm.on .pc canvas { box-shadow: 0 0 0 3px var(--danger); opacity: .55; }
.pcell .ck { position: absolute; top: 8px; left: 8px; width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.92); box-shadow: inset 0 0 0 1.5px #9AA0B4; color: transparent; z-index: 2; pointer-events: none; }
.pcell.on .ck { background: #1E2559; color: #fff; box-shadow: none; }
.pcell.rm.on .ck { background: #B83227; }
.pcell .rmx { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.pcell .rmx span { width: 44px; height: 44px; border-radius: 50%; background: #B83227; color: #fff; display: grid; place-items: center; }
.pcell .lb { font-size: 12.5px; color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.pcell.on .lb { color: var(--ink); font-weight: 700; }
.pcell.rm.on .lb { color: var(--danger); text-decoration: line-through; }
.pcell .gap { position: absolute; right: -27px; top: 38%; width: 28px; height: 28px; border-radius: 50%; background: var(--surface); color: var(--ink); box-shadow: 0 0 0 1px var(--line-2), 0 2px 6px rgba(20,23,46,.1); display: grid; place-items: center; z-index: 2; border: 0; padding: 0; }
.pcell .gap.on { background: var(--ink); color: var(--on-ink); }
.newslot { width: 100%; aspect-ratio: 1 / 1.414; border-radius: 4px; border: 2px dashed #3446C9; background: #F3F5FF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #3446C9; font: inherit; font-weight: 600; font-size: 12.5px; cursor: pointer; padding: 8px; text-align: center; transition: background .15s, transform .15s var(--ease); }
.newslot:hover { background: #E8ECFF; }
.newslot:active { transform: scale(.97); }
.newslot small { font-weight: 500; font-size: 11px; opacity: .75; }
:root[data-theme="dark"] .newslot { background: rgba(142,155,255,.1); color: var(--sel); border-color: var(--sel); }
.rangebox { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 4px 0 12px; background: var(--surface); border-radius: 14px; box-shadow: inset 0 0 0 1px var(--line-2); font-size: 13.5px; }
.rangebox input { border: 0; background: none; font-weight: 600; width: 110px; height: 36px; font-variant-numeric: tabular-nums; }
.opt { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 16px; min-height: 44px; box-shadow: inset 0 0 0 1px var(--line); border: 0; background: none; text-align: left; width: 100%; color: var(--text); }
.opt.on { box-shadow: inset 0 0 0 2px var(--ink); }
.opt .oi { width: 40px; height: 40px; flex: none; border-radius: 14px; background: var(--surface-3); color: #1E2559; display: grid; place-items: center; }
.opt.on .oi { background: var(--marker); }
.opt .ot { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.opt .ot b { font-weight: 600; }
.opt .ot span { font-size: 12.5px; color: var(--muted); }
.radio-opt .rd { width: 20px; height: 20px; flex: none; border-radius: 50%; box-shadow: inset 0 0 0 1.5px #9AA0B4; }
.radio-opt.on .rd { box-shadow: inset 0 0 0 6px var(--ink); }
/* page tools (compress, password, numbers, watermark, split, pictures, text) */
.xt { width: 100%; max-width: 720px; display: flex; flex-direction: column; gap: 18px; }
.xt-file { display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 20px; background: var(--surface); box-shadow: var(--shadow-card); }
.xt-th { width: 56px; height: 72px; flex: none; display: grid; place-items: center; overflow: hidden; border-radius: 6px; }
.xt-th canvas { max-width: 100%; max-height: 100%; width: auto; height: auto; box-shadow: 0 0 0 1px rgba(20,23,46,.08), 0 1px 4px rgba(20,23,46,.16); border-radius: 3px; background: #fff; }
.xt-th.lockd { background: var(--surface-3); color: #1E2559; border-radius: 12px; }
.xt-fn { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.xt-fn b { font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xt-fn span { font-size: 13px; color: var(--muted); }
.xt-opts { display: flex; flex-direction: column; gap: 18px; padding: 18px; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-card); }
.xt-opts h3 { margin: 0; font-size: 17px; font-weight: 700; }
.xt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 500; }
.xt-in { display: flex; flex-direction: column; gap: 8px; }
.xt-in input, .xt-pw { height: 46px; border-radius: 14px; box-shadow: inset 0 0 0 1.5px var(--line-2); background: var(--surface); padding: 0 14px; font: inherit; font-size: 15px; color: var(--text); border: 0; outline: 0; }
.xt-in input:focus, .xt-pw:focus-within { box-shadow: inset 0 0 0 2px var(--sel); }
.xt-pw { display: flex; align-items: center; padding: 0 4px 0 14px; }
.xt-pw input { flex: 1; min-width: 0; height: 44px; box-shadow: none; padding: 0; background: transparent; }
.xt-pw input:focus { box-shadow: none; }
.xt-in input[type=range], .field input[type=range] { width: 100%; accent-color: var(--ink); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips .chip { height: 36px; padding: 0 14px; border-radius: 999px; border: 0; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); font: inherit; font-size: 13.5px; font-weight: 600; color: var(--text); cursor: pointer; }
.chips .chip.on { background: var(--ink); color: var(--on-ink); box-shadow: none; }
.posgrid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: 44px 44px; gap: 6px; width: 168px; padding: 8px; border-radius: 14px; box-shadow: inset 0 0 0 1.5px var(--line-2); background: var(--surface-2); }
.posgrid button { border: 0; background: transparent; border-radius: 8px; display: grid; cursor: pointer; padding: 6px; }
.posgrid button:nth-child(-n+3) { align-items: start; } .posgrid button:nth-child(n+4) { align-items: end; }
.posgrid button:nth-child(3n+1) { justify-items: start; } .posgrid button:nth-child(3n+2) { justify-items: center; } .posgrid button:nth-child(3n) { justify-items: end; }
.posgrid i { width: 18px; height: 6px; border-radius: 3px; background: var(--line-3); }
.posgrid button.on { background: var(--surface); box-shadow: 0 1px 3px rgba(20,23,46,.12); }
.posgrid button.on i { background: var(--ink); }
.xt-prev { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.xt-pg { position: relative; width: min(220px, 44%); background: #fff; border-radius: 4px; box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 8px 22px rgba(20,23,46,.1); overflow: hidden; display: grid; place-items: center; }
.xt-pg canvas { width: 100%; height: 100%; display: block; }
.xt-ov { position: absolute; inset: 0; pointer-events: none; --k: .3; }
.xt-num { position: absolute; color: #262633; font-family: Arial, Helvetica, sans-serif; line-height: 1; white-space: nowrap; }
.xt-wm { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; font-family: Arial, Helvetica, sans-serif; font-weight: 700; white-space: nowrap; }
.xt-wm.tile { grid-template-columns: repeat(2, 1fr); grid-auto-rows: 1fr; place-items: center; }
.xt-wm span { display: block; line-height: 1; }
.xt-res { display: flex; flex-direction: column; gap: 16px; padding: 22px; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-card); animation: pe-in .25s ease-out; }
.xt-ok { display: flex; gap: 14px; align-items: flex-start; color: var(--text); }
.xt-ok > svg, .xt-ok > span:first-child { color: #1F9D55; flex: none; margin-top: 2px; }
.xt-ok > div { display: flex; flex-direction: column; gap: 4px; }
.xt-ok b { font-size: 18px; } .xt-ok .big { font-size: 26px; font-variant-numeric: normal; letter-spacing: -.01em; }
.xt-ok span { color: var(--muted); font-size: 14px; }
.xt-list { display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; }
.xt-list span { display: flex; align-items: center; gap: 8px; } .xt-list small { margin-left: auto; color: var(--muted); }
.xt-acts { display: flex; flex-wrap: wrap; gap: 10px; }
.bp-mobile .xt-acts .btn { flex: 1 1 100%; }
.xt-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.xt-grp { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-card); font-size: 12.5px; font-weight: 600; color: var(--muted-2); }
.xt-gth { display: flex; height: 90px; align-items: center; }
.xt-gth span { width: 52px; height: 72px; display: grid; place-items: center; margin-right: -22px; }
.xt-gth canvas { max-width: 100%; max-height: 100%; background: #fff; border-radius: 3px; box-shadow: 0 1px 4px rgba(20,23,46,.2); }
.xt-more { display: grid; place-items: center; color: var(--muted); font-weight: 600; }
.dl-list { display: flex; flex-direction: column; gap: 12px; }
.dl-it { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-card); border-left: 5px solid var(--line-3); }
.dl-it.deadline { border-left-color: #D63A3A; } .dl-it.appointment { border-left-color: #2F49D1; }
.dl-it:not(.on) { opacity: .6; }
.dl-top { display: flex; align-items: center; gap: 12px; cursor: pointer; }
.dl-top input { width: 20px; height: 20px; accent-color: var(--ink); flex: none; }
.dl-date { display: flex; flex-direction: column; gap: 2px; } .dl-date b { font-size: 16px; } .dl-date span { font-size: 12.5px; color: var(--muted); font-weight: 600; }
.dl-snip { margin: 0; font-size: 13.5px; color: var(--muted-2); line-height: 1.45; }
.dl-from { margin: 0; font-size: 12.5px; color: #8A5A00; background: #FFF6D6; padding: 6px 10px; border-radius: 10px; }
:root[data-theme="dark"] .dl-from { background: #3A3620; color: #F3E3A0; }
.dl-row { display: flex; gap: 8px; }
.dl-row input { flex: 1; min-width: 0; height: 40px; border-radius: 12px; border: 0; box-shadow: inset 0 0 0 1.5px var(--line-2); padding: 0 12px; font: inherit; background: var(--surface); color: var(--text); }
.sc-prev { display: grid; place-items: center; }
.sc-prev img { max-width: 100%; max-height: 52vh; border-radius: 6px; box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 10px 26px rgba(20,23,46,.12); background: #fff; }
.xt-text { display: flex; flex-direction: column; gap: 10px; }
.xt-th2 { display: flex; align-items: center; justify-content: space-between; }
.xt-text textarea { min-height: 280px; resize: vertical; border-radius: 16px; border: 0; box-shadow: inset 0 0 0 1.5px var(--line-2); padding: 14px; font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; background: var(--surface); color: var(--text); }
.big { font-size: 28px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.dz { display: flex; align-items: center; gap: 16px; padding: 20px 24px; border-radius: 28px; border: 1.5px dashed var(--line-3); background: color-mix(in srgb, var(--surface) 55%, transparent); width: 100%; }
.dz.over { border-color: #E0B400; background: #FFFBE6; }
.dz.stack { flex-direction: column; text-align: center; padding: 40px 24px; }
.dz.stack .dzt { align-items: center; }
.dz .dz-err { color: var(--danger); font-weight: 600; }
:root[data-theme="dark"] .dz.over { background: rgba(255,225,77,.08); }
/* files dragged above an area that takes them */
.ap-drop { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 20px 18px; font-weight: 500; color: var(--muted); }
.dropov { position: absolute; inset: 0; z-index: 60; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--bg, #EEF0F6) 70%, transparent); border: 2.5px dashed #E0B400; border-radius: inherit; pointer-events: none; animation: pe-fade .12s; }
.dropov-card { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 28px; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); text-align: center; max-width: 360px; }
.dropov-card b { font-size: 16px; }
.dropov-card > span:last-child { font-size: 13px; color: var(--muted); }
.dropov-i { width: 52px; height: 52px; border-radius: 18px; background: #FFE14D; color: #1E2559; display: grid; place-items: center; margin-bottom: 4px; }
.dz .dzi { width: 52px; height: 52px; flex: none; border-radius: 18px; background: #1E2559; color: #fff; display: grid; place-items: center; }
.dz .dzt { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.dz .dzt b { font-weight: 600; font-size: 16px; }
.types { display: flex; flex-wrap: wrap; gap: 6px; }
.types span { height: 24px; padding: 0 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .03em; display: inline-flex; align-items: center; }
.queue { display: flex; flex-direction: column; background: var(--surface); border-radius: 22px; box-shadow: var(--shadow-card); overflow: hidden; width: 100%; }
.qrow { display: flex; align-items: center; gap: 10px; padding: 12px 14px 12px 6px; background: var(--surface); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: manipulation; }
.qrow + .qrow { border-top: 1px solid var(--line); }
.qrow .qi { width: 40px; height: 40px; flex: none; border-radius: 14px; display: grid; place-items: center; }
.qrow .qt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.qrow .qt b { font-weight: 600; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qrow .qt span { font-size: 12.5px; color: var(--muted); }
.qrow .qt span.ok { color: var(--success); } .qrow .qt span.err { color: var(--danger); }
.qrow .bar { height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; }
.qrow .bar > div { height: 100%; background: var(--ink); border-radius: 2px; transition: width .2s; }

/* form fields */
.ff { position: absolute; border: 0; margin: 0; padding: 0 3px; background: rgba(52,70,201,.08); border-bottom: 1px solid #9AA0B4; color: #1d1d1f; font-family: Helvetica, Arial, sans-serif; outline: none; border-radius: 1px; }
.ff:hover { background: rgba(52,70,201,.13); }
.ff:focus, .ff.active { background: #fff; outline: 2px solid #3446C9; box-shadow: 0 0 0 5px rgba(52,70,201,.14); border-bottom-color: transparent; z-index: 3; }
textarea.ff { resize: none; line-height: 1.2; padding-top: 2px; }
select.ff { appearance: none; -webkit-appearance: none; cursor: pointer; }
.ffbox { position: absolute; border: 1.5px solid #9AA0B4; background: rgba(52,70,201,.08); display: grid; place-items: center; color: #1E2559; padding: 0; cursor: pointer; }
.ffbox.radio { border-radius: 50%; }
.ffbox.on { border-color: #3446C9; }
.ffbox:focus-visible { outline: 2px solid #3446C9; outline-offset: 1px; }
.ffsig { position: absolute; border: 1.5px dashed #3446C9; background: rgba(52,70,201,.05); color: #3446C9; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 600; font-size: 12px; padding: 0; overflow: hidden; }
.fieldlist { display: flex; flex-direction: column; gap: 2px; margin: 0 -10px; }
.fieldlist button { display: flex; align-items: center; gap: 10px; height: 40px; padding: 0 10px; border-radius: 14px; border: 0; background: none; font-size: 14px; text-align: left; color: var(--text); }
.fieldlist button.on { background: var(--marker-100); font-weight: 600; }
.fieldlist button .k { font-size: 12px; color: var(--muted); font-weight: 400; }
.fieldlist button .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.marks { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.marks button { height: 52px; border-radius: 16px; box-shadow: inset 0 0 0 1px var(--line-2); border: 0; background: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 11px; color: var(--muted-2); }
.marks button svg { color: var(--ink); }
.marks button.on { box-shadow: inset 0 0 0 2px var(--ink); background: var(--marker-100); }
.fieldnav { position: absolute; left: 50%; bottom: calc(16px + var(--safe-b)); transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 6px; background: #1E2559; color: #fff; border-radius: 22px; box-shadow: 0 12px 32px rgba(20,23,46,.28); white-space: nowrap; z-index: 9; max-width: calc(100% - 16px); animation: pe-in .2s ease-out; }
.fieldnav button { width: 44px; height: 44px; border-radius: 16px; display: grid; place-items: center; border: 0; background: none; color: #fff; padding: 0; flex: none; }
.fieldnav button:hover { background: rgba(255,255,255,.1); }
.fieldnav .fn { display: flex; flex-direction: column; gap: 1px; padding: 0 10px; min-width: 0; flex: 1; }
.fieldnav .fn b { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; }
.fieldnav .fn span { font-size: 12px; opacity: .75; font-variant-numeric: tabular-nums; }
.fieldnav .done { width: auto; padding: 0 16px; background: #FFE14D; color: #1E2559; font-weight: 700; }
.fieldnav .done:hover { background: #FFE14D; }

/* ---------- breakpoints ---------- */
@media (max-width: 1599px) { .org .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1600px) { .org .grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } .hub .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); } .pgrid .cells { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
@media (max-width: 1099px) {
  .pages { padding: calc(100px + var(--safe-t)) 32px calc(96px + var(--safe-b)) calc(124px + var(--safe-l)); }
  .org { padding: calc(100px + var(--safe-t)) 32px calc(96px + var(--safe-b)) calc(132px + var(--safe-l)); }
  .org .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .hub .cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pgrid .cells { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .tmain { padding: 32px; }
}
@media (max-width: 599px) {
  .topbar { height: 56px; gap: 4px; padding: 0 8px 0 4px; }
  .topbar .ibtn { width: 44px; height: 44px; }
  .topbar.float { left: calc(8px + var(--safe-l)); right: calc(8px + var(--safe-r)); top: calc(8px + var(--safe-t)); height: 60px; gap: 2px; padding: 0 8px 0 4px; border-radius: 20px; }
  .topbar.float .ibtn { width: 42px; }
  .topbar .pdfchip, .topbar .zoompill { display: none; }
  .topbar .fmeta { font-size: 12px; gap: 5px; }
  .pages, .bp-large .pages { padding: calc(80px + var(--safe-t)) 12px calc(120px + var(--safe-b)); gap: 22px; }
  .pagepill { display: none; }
  .org { padding: calc(80px + var(--safe-t)) 16px calc(120px + var(--safe-b)); gap: 16px; }
  .org .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .scrim.sheet { align-items: flex-end; padding: 0; }
  .scrim.sheet .modal { max-width: none; border-radius: 28px 28px 0 0; padding: 10px 16px calc(20px + var(--safe-b)); max-height: 94%; gap: 16px; }
  .scrim.sheet .modal .grab { display: block; width: 40px; height: 5px; border-radius: 3px; background: var(--line); margin: 0 auto; flex: none; }
  .sigpad { height: 180px; }
  .typed .opts button { font-size: 24px; }
  .toast { bottom: calc(96px + var(--safe-b)); }
  .tmain { padding: 20px 16px; }
  .hub h1 { font-size: 26px; }
  .hub .cards { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .hcard { padding: 12px 14px; }
  .pgrid .cells { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 14px; }
  .pcell .gap { right: -21px; }
  .dz { flex-direction: column; text-align: center; padding: 20px; }
  .dz .dzt { align-items: center; }
  .dz .types { justify-content: center; }
  .frow .range-in { width: 84px; }
}
.tscreen > .tbody:last-child .tmain { padding-bottom: calc(24px + var(--safe-b)); }
.ocrbar { position: absolute; z-index: 9; top: calc(88px + var(--safe-t)); left: 50%; transform: translateX(-50%); width: min(620px, calc(100% - 32px)); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 12px 12px 14px; border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-lift); animation: pe-in .26s var(--ease); }
.bp-tablet .ocrbar, .bp-desktop .ocrbar { left: calc(50% + 50px); width: min(620px, calc(100% - 148px)); }
.ocrbar .oi { width: 44px; height: 44px; flex: none; border-radius: 14px; background: var(--tint-change); color: var(--on-tint); display: grid; place-items: center; }
.ocrbar .ot { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-right: 28px; }
.ocrbar .ot b { font-weight: 700; font-size: 15px; }
.ocrbar .ot span { font-size: 13px; color: var(--muted); line-height: 1.4; }
.ocrbar .oa { display: flex; gap: 8px; margin-left: auto; }
.ocrbar .oa .btn { height: 42px; }
.ocrbar .x { position: absolute; top: 6px; right: 6px; width: 36px; height: 36px; }
.bp-mobile .ocrbar { top: calc(76px + var(--safe-t)); }
.bp-mobile .ocrbar .oa { width: 100%; } .bp-mobile .ocrbar .oa .btn { flex: 1; }
.ocrbar .op { position: absolute; left: 18px; right: 18px; bottom: 5px; height: 3px; border-radius: 2px; background: var(--sel-tint); overflow: hidden; }
.ocrbar .op i { display: block; height: 100%; background: var(--sel); border-radius: 2px; transition: width .4s var(--ease); }
/* text of picture pages being read */
.ocr-band { position: absolute; left: 0; right: 0; pointer-events: none; background: linear-gradient(90deg, transparent, var(--sel-tint) 30%, rgba(52,70,201,.18) 50%, var(--sel-tint) 70%, transparent); background-size: 200% 100%; animation: ocr-sweep 1.1s linear infinite; border-radius: 4px; }
@keyframes ocr-sweep { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.ocr-tap { position: absolute; transform: translate(-50%, calc(-100% - 14px)); pointer-events: none; display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-radius: 999px; background: var(--ink); color: var(--on-ink); font-size: 13px; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow-lift); animation: pe-in .18s var(--ease); z-index: 6; }
.ocr-tap .spinner, .ocr-page .spinner { width: 14px; height: 14px; border-width: 2px; }
.ocr-page { position: absolute; top: 10px; right: 10px; pointer-events: none; display: flex; align-items: center; gap: 7px; padding: 5px 10px; border-radius: 999px; background: var(--surface); color: var(--muted); font-size: 12px; font-weight: 600; box-shadow: var(--shadow-lift); z-index: 4; }

/* ---------- lazy screens ---------- */
.lazy-wait { height: var(--app-h, 100%); width: 100%; display: grid; place-items: center; color: var(--muted); background: var(--desk); }

/* ---------- document scanner ---------- */
.spinner { width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid currentColor; border-right-color: transparent; display: inline-block; animation: spin .8s linear infinite; flex: none; opacity: .75; }
.scam { position: fixed; inset: 0; z-index: 40; background: #07080C; color: #fff; display: flex; flex-direction: column; overflow: hidden; user-select: none; -webkit-user-select: none; }
.scam-view { position: absolute; inset: 0; }
.scam-frame { position: absolute; inset: 0; overflow: hidden; }
.scam-frame video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #07080C; }
.scam-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.scam-svg polygon { fill: rgba(255,225,77,.16); stroke-opacity: .98; stroke: #FFE14D; stroke-width: 3; stroke-linejoin: round; transition: fill .2s; }
.scam-svg polygon.go { fill: rgba(91,214,154,.22); stroke: #5BD69A; }
.scam-svg circle { fill: #fff; stroke: #FFE14D; stroke-width: 3; }
.scam-guide { position: absolute; left: 50%; top: calc(50% - 40px); transform: translate(-50%, -50%); border-radius: 20px; box-shadow: 0 0 0 100vmax rgba(7,8,12,.42); border: 1.5px solid rgba(255,255,255,.35); pointer-events: none; transition: border-color .2s, box-shadow .2s; }
.scam-guide i { position: absolute; width: 34px; height: 34px; border: 4px solid #fff; transition: border-color .2s; }
.scam-guide .tl { left: -3px; top: -3px; border-right: 0; border-bottom: 0; border-top-left-radius: 22px; }
.scam-guide .tr { right: -3px; top: -3px; border-left: 0; border-bottom: 0; border-top-right-radius: 22px; }
.scam-guide .bl { left: -3px; bottom: -3px; border-right: 0; border-top: 0; border-bottom-left-radius: 22px; }
.scam-guide .br { right: -3px; bottom: -3px; border-left: 0; border-top: 0; border-bottom-right-radius: 22px; }
.scam-guide.on { border-color: rgba(255,225,77,.7); }
.scam-guide.on i { border-color: #FFE14D; }
.scam-guide.go { border-color: rgba(91,214,154,.8); }
.scam-guide.go i { border-color: #5BD69A; }
.scam-guide b { position: absolute; left: 20%; right: 20%; bottom: 14px; height: 4px; border-radius: 2px; background: #5BD69A; transform-origin: left; }
.scam-flash { position: absolute; inset: 0; background: #fff; pointer-events: none; animation: scam-flash .35s ease-out forwards; }
@keyframes scam-flash { from { opacity: .85; } to { opacity: 0; } }
.scam-top { position: absolute; left: 0; right: 0; top: 0; padding: calc(14px + var(--safe-t)) calc(14px + var(--safe-r)) 14px calc(14px + var(--safe-l)); display: flex; align-items: center; gap: 10px; background: linear-gradient(rgba(0,0,0,.5), transparent); z-index: 2; }
.scam-top .sp { flex: 1; }
.scam-round { width: 46px; height: 46px; border-radius: 50%; border: 0; background: rgba(20,22,32,.72); color: #fff; display: grid; place-items: center; }
.scam-round.on { background: #FFE14D; color: #1E2559; }
.scam-pill { height: 40px; padding: 0 14px; border-radius: 999px; border: 0; background: rgba(20,22,32,.72); color: rgba(255,255,255,.85); font-weight: 600; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
.scam-pill.on { color: #FFE14D; }
.scam-hint { position: absolute; left: 50%; top: calc(80px + var(--safe-t)); transform: translateX(-50%); z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 9px 18px; border-radius: 18px; background: rgba(20,22,32,.78); text-align: center; max-width: calc(100% - 32px); pointer-events: none; }
.scam-hint b { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #FFE14D; }
.scam-hint span { font-size: 14.5px; font-weight: 600; }
.scam-bottom { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 26px calc(16px + var(--safe-r)) calc(22px + var(--safe-b)) calc(16px + var(--safe-l)); background: linear-gradient(transparent, rgba(0,0,0,.66) 30%); display: flex; flex-direction: column; align-items: center; gap: 18px; }
.scam-modes { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(20,22,32,.72); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
.scam-modes::-webkit-scrollbar { display: none; }
.scam-modes button { height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: rgba(255,255,255,.78); font-weight: 600; font-size: 13.5px; white-space: nowrap; }
.scam-modes button.on { background: #FFE14D; color: #1E2559; }
.scam-row { width: 100%; max-width: 460px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
.scam-side { justify-self: center; display: flex; flex-direction: column; align-items: center; gap: 6px; border: 0; background: none; color: #fff; font-size: 12.5px; font-weight: 600; }
.scam-side .ic, .scam-side .stack { width: 52px; height: 52px; border-radius: 16px; background: rgba(255,255,255,.14); display: grid; place-items: center; position: relative; }
.scam-side .stack img { width: 100%; height: 100%; object-fit: cover; border-radius: 14px; border: 2px solid #fff; }
.scam-side .stack em { position: absolute; top: -7px; right: -7px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: #FFE14D; color: #1E2559; font-style: normal; font-size: 12px; font-weight: 800; display: grid; place-items: center; }
.scam-side:disabled { opacity: .45; }
.scam-side.wait .stack img { opacity: .45; }
.scam-side .stack .spinner { position: absolute; inset: 0; margin: auto; width: 24px; height: 24px; color: #fff; opacity: 1; }
.scam-zoom { display: flex; gap: 6px; padding: 4px; border-radius: 999px; background: rgba(20,22,32,.6); margin-bottom: -6px; }
.scam-zoom button { min-width: 38px; height: 38px; padding: 0 8px; border-radius: 999px; border: 0; background: rgba(255,255,255,.12); color: #fff; font-weight: 700; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.scam-zoom button.on { background: #fff; color: #1E2559; font-size: 13.5px; }
.scam-side .lb { opacity: .9; }
.scam-shutter { width: 80px; height: 80px; border: 0; padding: 0; border-radius: 50%; background: none; position: relative; display: grid; place-items: center; }
.scam-shutter svg { position: absolute; inset: 0; transform: rotate(-90deg); }
.scam-shutter .track { fill: none; stroke: rgba(255,255,255,.9); stroke-width: 4; }
.scam-shutter .prog { fill: none; stroke: #5BD69A; stroke-width: 5; stroke-linecap: round; transition: stroke-dashoffset .12s linear; }
.scam-shutter i { width: 62px; height: 62px; border-radius: 50%; background: #fff; transition: transform .12s, background .12s; }
.scam-shutter:active i { transform: scale(.9); }
.scam-shutter.busy i { background: #FFE14D; transform: scale(.86); }
.scam-shutter:disabled { opacity: .5; }
.scam-msg { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; color: #fff; }
.scam-msg.quiet { flex-direction: row; color: rgba(255,255,255,.75); font-weight: 600; }
.scam-msg .tile { width: 64px; height: 64px; border-radius: 22px; background: rgba(255,255,255,.12); display: grid; place-items: center; margin-bottom: 6px; }
.scam-msg b { font-size: 19px; }
.scam-msg > span { color: rgba(255,255,255,.72); max-width: 380px; line-height: 1.5; }
.scam-msg .acts { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; width: min(100%, 300px); }
.btn.on-dark { color: #fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
.btn.on-dark:hover:not(:disabled) { background: rgba(255,255,255,.1); }
.scam-finding { position: fixed; left: 50%; bottom: calc(190px + var(--safe-b)); transform: translateX(-50%); z-index: 45; display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-radius: 999px; background: rgba(20,22,32,.8); color: #fff; font-weight: 600; font-size: 13.5px; pointer-events: none; }

/* corner editor */
.scrop { position: fixed; inset: 0; z-index: 55; background: #0B0C12; color: #fff; display: flex; flex-direction: column; animation: pe-fade .15s; user-select: none; -webkit-user-select: none; }
.scrop-top { display: flex; align-items: center; gap: 12px; padding: calc(10px + var(--safe-t)) calc(14px + var(--safe-r)) 10px calc(14px + var(--safe-l)); }
.scrop-top .t { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; }
.scrop-top .t b { font-size: 16px; }
.scrop-top .t span { font-size: 12.5px; color: rgba(255,255,255,.62); }
.scrop-top .btn.primary { background: #FFE14D; color: #1E2559; }
.scrop-stage { flex: 1; position: relative; overflow: hidden; touch-action: none; }
.scrop-stage canvas { box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.scrop-svg { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.scrop-svg .shade { fill: rgba(5,6,10,.55); }
.scrop-svg .edge { fill: none; stroke: #FFE14D; stroke-width: 2.5; stroke-linejoin: round; }
.scrop-svg .edge.bad { stroke: #FF8A7E; stroke-dasharray: 8 6; }
.scrop-svg .grip { fill: #fff; stroke: #1E2559; stroke-width: 1.5; }
.scrop-svg .corner { fill: rgba(255,225,77,.28); stroke: #FFE14D; stroke-width: 3; transition: r .12s; }
.scrop-svg .corner.on { fill: rgba(255,225,77,.12); }
.scrop-hit { position: absolute; width: 48px; height: 48px; border-radius: 50%; border: 0; background: transparent; padding: 0; touch-action: none; cursor: grab; }
.scrop-hit.mid { width: 40px; height: 40px; }
.scrop-hit:focus-visible { outline: 2px solid #fff; outline-offset: -6px; }
.scrop-loupe { position: absolute; top: 16px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 10px 30px rgba(0,0,0,.6); pointer-events: none; background: #111; }
.scrop-warn { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: #3A1E1E; color: #FFB4AA; font-weight: 600; font-size: 13px; white-space: nowrap; max-width: calc(100% - 24px); overflow: hidden; text-overflow: ellipsis; }
.scrop-wait { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; }
.scrop-bar { display: flex; justify-content: center; gap: 8px; padding: 10px calc(12px + var(--safe-r)) calc(14px + var(--safe-b)) calc(12px + var(--safe-l)); }
.scrop-tool { min-width: 92px; height: 64px; border: 0; border-radius: 16px; background: transparent; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; font-size: 12.5px; font-weight: 600; }
.scrop-tool:hover:not(:disabled) { background: rgba(255,255,255,.08); }
.scrop-tool:disabled { opacity: .4; }
.serase .scrop-stage { cursor: none; }
.serase-pic { position: absolute; transform-origin: 50% 50%; box-shadow: 0 10px 40px rgba(0,0,0,.5); }
.serase-pic img, .serase-pic canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; user-select: none; -webkit-user-drag: none; }
.serase-brush { position: absolute; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.5); transform: translate(-50%, -50%); pointer-events: none; }
.serase-busy { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 999px; background: rgba(20,22,32,.85); font-size: 13px; font-weight: 600; pointer-events: none; }
.serase-zoom { position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: rgba(24,26,36,.9); box-shadow: 0 6px 20px rgba(0,0,0,.35); }
.serase-zoom button { width: 38px; height: 38px; border-radius: 50%; border: 0; background: transparent; color: #fff; display: grid; place-items: center; }
.serase-zoom button.pct { width: auto; min-width: 58px; padding: 0 8px; border-radius: 999px; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.serase-zoom button:hover:not(:disabled) { background: rgba(255,255,255,.1); }
.serase-zoom button:disabled { opacity: .45; }
.serase-zoom button.pct:disabled { opacity: .8; }
.serase.moving .scrop-stage { cursor: grab; }
.serase.grabbing .scrop-stage { cursor: grabbing; }
.serase-bar { align-items: center; flex-wrap: nowrap; }
.serase-modes { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,.08); margin-right: 4px; }
.serase-modes button { height: 48px; padding: 0 14px; border-radius: 999px; border: 0; background: transparent; color: #fff; display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600; }
.serase-modes button:hover:not(.on) { background: rgba(255,255,255,.08); }
.serase-modes button.on { background: #FFE14D; color: #1E2559; }
@media (min-width: 900px) {
  .serase .scrop-top { padding-left: 24px; padding-right: 24px; }
  .serase-bar { gap: 10px; }
}
@media (max-width: 560px) {
  .serase-bar { gap: 4px; padding-left: 8px; padding-right: 8px; }
  .serase-modes button { padding: 0; width: 44px; justify-content: center; }
  .serase-modes button span { display: none; }
  .serase-sizes { margin-right: 0; }
  .serase-modes, .serase-sizes { gap: 2px; padding: 3px; }
  .serase-sizes button { width: 40px; height: 40px; }
  .serase-modes button { height: 40px; width: 40px; }
  .serase .scrop-tool { min-width: 48px; height: 56px; font-size: 11.5px; }
}
.serase-sizes { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(255,255,255,.08); margin-right: 8px; }
.serase-sizes button { width: 48px; height: 48px; border-radius: 50%; border: 0; background: transparent; display: grid; place-items: center; }
.serase-sizes button i { display: block; border-radius: 50%; background: #fff; opacity: .7; }
.serase-sizes button.on { background: #FFE14D; }
.serase-sizes button.on i { background: #1E2559; opacity: 1; }

/* review */
.scr { position: relative; height: var(--app-h, 100%); display: flex; flex-direction: column; overflow: hidden; background: var(--desk-dots), var(--desk); width: 100%; min-width: 0; }
.scr > .topbar { height: calc(60px + var(--safe-t)); padding-top: var(--safe-t); padding-left: calc(12px + var(--safe-l)); padding-right: calc(16px + var(--safe-r)); }
.sc-body { flex: 1; min-height: 0; display: flex; }
.sc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 20px 14px; overflow: hidden; }
.sc-view { flex: 1; min-height: 0; width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-rows: minmax(0, 1fr); align-items: center; gap: 12px; position: relative; }
.sc-pager { position: relative; height: 100%; align-self: stretch; min-height: 0; min-width: 0; overflow: hidden; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
.sc-track { display: flex; height: 100%; will-change: transform; }
.sc-slide { flex: none; height: 100%; display: grid; place-items: center; }
.sc-pic { position: relative; transform-origin: 50% 50%; }
.sc-pager.zoomed { touch-action: none; cursor: grab; }
.sc-pager.zoomed .sc-pic > img { border-radius: 0; }
.sc-pic > img.sc-sharp { box-shadow: none; background: transparent; }
.sc-zoom { position: absolute; right: 10px; bottom: 10px; z-index: 4; display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-lift); }
.sc-zoom button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: var(--text); padding: 0; }
.sc-zoom button:disabled { opacity: .35; }
.sc-zoom button.pct { width: auto; min-width: 48px; padding: 0 6px; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sc-pic > img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: #fff; box-shadow: var(--shadow-page); border-radius: 3px; animation: pe-fade .2s; -webkit-user-drag: none; }
.sc-pic > img.sc-orig { box-shadow: none; animation: none; }
.sc-skel { position: absolute; inset: 0; border-radius: 4px; background: var(--surface); box-shadow: var(--shadow-page); }
.sc-working { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 999px; background: var(--toast); color: #fff; font-weight: 600; font-size: 13.5px; white-space: nowrap; z-index: 3; pointer-events: none; }
.sc-working.sm { top: 12px; transform: translateX(-50%); padding: 7px 12px; font-size: 12.5px; gap: 8px; }
.sc-working.sm .spinner { width: 14px; height: 14px; border-width: 2px; }
.sc-split { position: absolute; top: 0; bottom: 0; width: 44px; margin-left: -22px; cursor: ew-resize; touch-action: none; z-index: 2; display: grid; place-items: center; }
.sc-split::before { content: ''; position: absolute; top: 0; bottom: 0; left: 21px; width: 2.5px; background: #fff; box-shadow: 0 0 0 1px rgba(20,23,46,.25), 0 0 8px rgba(0,0,0,.25); }
.sc-split i { position: relative; width: 34px; height: 34px; border-radius: 50%; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
.sc-split i::before, .sc-split i::after { content: ''; position: absolute; top: 12px; border: 5px solid transparent; }
.sc-split i::before { left: 4px; border-right: 6px solid var(--ink); }
.sc-split i::after { right: 4px; border-left: 6px solid var(--ink); }
.sc-tag { position: absolute; top: 10px; z-index: 1; padding: 4px 9px; border-radius: 999px; background: rgba(20,23,46,.72); color: #fff; font-size: 11.5px; font-weight: 700; pointer-events: none; }
.sc-tag.l { left: 10px; } .sc-tag.r { right: 10px; }
.sc-addslide { border: 2px dashed var(--line-3); border-radius: 10px; background: transparent; color: var(--muted-2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; font-size: 13px; max-width: 100%; max-height: 100%; }
.sc-addslide b { font-size: 15.5px; color: var(--text); }
.sc-under { display: flex; align-items: center; justify-content: center; gap: 10px; flex: none; }
.sc-cmp { height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--surface); color: var(--text); box-shadow: var(--shadow-rest); display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 13px; }
.sc-cmp.on { background: var(--ink); color: var(--on-ink); }
.sc-check { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); height: 38px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--marker); color: #1E2559; font-weight: 700; font-size: 13.5px; display: flex; align-items: center; gap: 7px; box-shadow: var(--shadow-float); white-space: nowrap; }
.sc-nav { width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--surface); color: var(--text); box-shadow: var(--shadow-rest); display: grid; place-items: center; }
.sc-nav:disabled { opacity: .3; }
.sc-count { height: 34px; display: flex; align-items: center; font-size: 13px; font-weight: 600; color: var(--muted-2); background: var(--surface); padding: 0 14px; border-radius: 999px; box-shadow: var(--shadow-rest); }
.sc-empty { flex: 1; display: grid; place-items: center; color: var(--muted); }
.sc-filters { display: flex; gap: 10px; align-items: flex-end; max-width: 100%; overflow-x: auto; padding: 2px 4px 4px; scrollbar-width: none; flex: none; }
.sc-filters::-webkit-scrollbar { display: none; }
.sc-ft { border: 0; background: none; padding: 0; flex: none; }
.sc-ft .im { position: relative; width: 74px; height: 88px; border-radius: 12px; overflow: hidden; background: var(--surface); box-shadow: var(--shadow-rest); display: grid; place-items: center; color: var(--muted); transition: box-shadow .15s; }
.sc-ft .im img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.sc-ft .lb { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 4px 5px; background: linear-gradient(transparent, rgba(20,23,46,.78)); color: #fff; font-size: 12px; font-weight: 700; text-align: center; white-space: nowrap; }
.sc-ft.on .im { box-shadow: 0 0 0 2.5px var(--ink), var(--shadow-rest); }
.sc-ft.on .lb { background: var(--ink); padding-top: 5px; color: var(--on-ink); }
.sc-all { align-self: center; border: 0; background: var(--chip); color: var(--muted-2); font-weight: 600; font-size: 12.5px; height: 32px; padding: 0 12px; border-radius: 999px; white-space: nowrap; flex: none; margin-left: 4px; }
.sc-acts { display: flex; gap: 4px; padding: 4px; border-radius: 18px; background: var(--surface); box-shadow: var(--shadow-rest); flex: none; max-width: 100%; overflow-x: auto; }
.sc-acts button { min-width: 64px; height: 52px; padding: 0 8px; border: 0; border-radius: 14px; background: none; color: var(--text); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font-size: 11.5px; font-weight: 600; }
.sc-acts button:hover { background: var(--surface-2); }
.sc-acts button.danger { color: var(--danger); }
.sc-acts button.add { color: var(--ink); }
.sc-acts button.on { color: var(--sel); background: var(--sel-tint); }
.sc-strip { display: flex; gap: 10px; align-items: center; max-width: 100%; overflow-x: auto; padding: 4px 4px 6px; flex: none; }
.sc-strip > div, .sc-strip { scrollbar-width: thin; }
.sc-thb { border: 0; background: none; padding: 0; flex: none; touch-action: manipulation; }
.sc-th { width: 54px; height: 70px; border-radius: 9px; background: var(--surface); box-shadow: var(--shadow-rest); display: grid; place-items: center; position: relative; overflow: hidden; color: var(--muted); }
.sc-th img { width: 100%; height: 100%; object-fit: cover; object-position: top; }
.sc-th.on { box-shadow: 0 0 0 2.5px var(--ink); }
.sc-th em { position: absolute; left: 4px; bottom: 4px; min-width: 18px; height: 18px; border-radius: 9px; padding: 0 5px; background: rgba(20,23,46,.72); color: #fff; font-style: normal; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
.sc-th .warn { position: absolute; right: 4px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--marker); box-shadow: 0 0 0 2px #fff; }
.sc-addtile { width: 54px; height: 70px; flex: none; border-radius: 9px; border: 1.5px dashed var(--line-3); background: transparent; color: var(--muted-2); display: grid; place-items: center; }
.sc-addtile:hover { background: var(--surface); }
.sc-side { width: 340px; flex: none; background: var(--surface); border-left: 1px solid var(--line); padding: 22px 22px calc(22px + var(--safe-b)); overflow: auto; display: flex; flex-direction: column; gap: 18px; }
.sc-side h3 { margin: 0; font-size: 17px; font-weight: 700; }
.sc-settings { display: flex; flex-direction: column; gap: 16px; }
.sc-field { display: flex; flex-direction: column; gap: 8px; }
.sc-field .kicker small { text-transform: none; letter-spacing: 0; font-weight: 500; }
.sc-name { display: flex; align-items: center; gap: 6px; }
.sc-name em { font-style: normal; color: var(--muted); font-weight: 600; }
.sc-go { display: flex; flex-direction: column; gap: 8px; }
.sc-note { margin: 0; display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; }
.modal.sc-sheet h2 { margin: 6px 0 0; font-size: 19px; font-weight: 700; }
@media (max-width: 719px) {
  .sc-main { padding: 12px 10px 10px; gap: 10px; }
  .sc-view { grid-template-columns: 1fr; }
  .sc-nav { display: none; }
  .sc-ft .im { width: 64px; height: 78px; }
  .sc-acts { width: 100%; justify-content: space-between; }
  .sc-acts button { min-width: 0; flex: 1; }
  .scr > .topbar .btn.dl { height: 42px; padding: 0 14px; }
  .scam-row { max-width: none; }
}
`;
