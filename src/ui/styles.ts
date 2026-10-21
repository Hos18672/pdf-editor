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
.s2-glow { position: absolute; width: 720px; height: 720px; right: -12%; top: -18%; border-radius: 50%; background: #FFE14D; opacity: .35; filter: blur(90px); pointer-events: none; z-index: -1; }
:root[data-theme="dark"] .s2-glow { opacity: .10; }
.s2-nav { position: relative; flex: none; display: flex; align-items: center; gap: 12px; padding: calc(24px + var(--safe-t)) calc(40px + var(--safe-r)) 24px calc(40px + var(--safe-l)); }
.s2-nav .sp { flex: 1; }
.s2-brand { font-weight: 800; font-size: 18px; letter-spacing: -.02em; white-space: nowrap; }
.logo2 { position: relative; flex: none; border-radius: 12px; background: #1E2559; display: grid; place-items: center; box-shadow: 0 6px 16px rgba(30,37,89,.3); }
.logo2 i { width: 40%; height: 50%; background: #fff; border-radius: 2px 6px 2px 2px; }
.logo2 b { position: absolute; right: 17.5%; bottom: 17.5%; width: 25%; height: 25%; border-radius: 50%; background: #FFE14D; border: 2px solid #1E2559; }
.s2-navbtn { height: 40px; padding: 0 14px; border-radius: 999px; border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 14px; color: var(--text); text-decoration: none; white-space: nowrap; transition: background .18s; }
.s2-navbtn:hover { background: color-mix(in srgb, var(--surface) 70%, transparent); }
.s2-round { width: 44px; height: 44px; flex: none; border-radius: 999px; border: 0; background: color-mix(in srgb, var(--surface) 80%, transparent); box-shadow: 0 1px 2px rgba(20,23,46,.08); display: grid; place-items: center; color: var(--text); padding: 0; transition: background .18s; }
.s2-round:hover { background: var(--surface); }
.s2-hero { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 64px; align-items: center; align-content: center; padding: 0 72px 40px; max-width: 1560px; width: 100%; margin: 0 auto; }
.s2-copy { display: flex; flex-direction: column; gap: 26px; min-width: 0; animation: s2-up .6s var(--ease) both; }
.s2-pill { display: inline-flex; align-self: flex-start; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 6px; border-radius: 999px; background: var(--surface); box-shadow: var(--shadow-rest); font-size: 13px; font-weight: 600; }
.s2-pill .lk { width: 24px; height: 24px; border-radius: 50%; background: var(--success-bg); color: var(--success); display: grid; place-items: center; }
.start h1 { margin: 0; font-size: 88px; font-weight: 800; letter-spacing: -.045em; line-height: .95; white-space: nowrap; }
.start h1 .mk { background-image: linear-gradient(var(--marker), var(--marker)); background-repeat: no-repeat; background-position: 0 88%; background-size: 100% 42%; padding: 0 .06em; margin: 0 -.06em; animation: s2-mark 1.4s .3s cubic-bezier(.6,0,.2,1) both; }
:root[data-theme="dark"] .start h1 .mk { background-image: linear-gradient(rgba(255,225,77,.5), rgba(255,225,77,.5)); }
.s2-lead { margin: 0; font-size: 19px; line-height: 1.5; color: var(--muted-2); max-width: 30em; text-wrap: pretty; }
/* the card slot: drop target / opening / password / error */
.s2-card { position: relative; border-radius: 28px; padding: 28px; background: var(--surface); box-shadow: 0 1px 2px rgba(20,23,46,.06), 0 24px 60px rgba(20,23,46,.12); display: flex; align-items: center; gap: 18px; animation: pe-in .26s var(--ease); }
:root[data-theme="dark"] .s2-card { box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgba(0,0,0,.45); }
.s2-card.drop { cursor: pointer; }
.s2-card.drop .dash { position: absolute; inset: 8px; border-radius: 22px; pointer-events: none;
  background-image: linear-gradient(90deg, var(--line-3) 50%, transparent 50%), linear-gradient(90deg, var(--line-3) 50%, transparent 50%), linear-gradient(0deg, var(--line-3) 50%, transparent 50%), linear-gradient(0deg, var(--line-3) 50%, transparent 50%);
  background-repeat: repeat-x, repeat-x, repeat-y, repeat-y; background-size: 14px 1.5px, 14px 1.5px, 1.5px 14px, 1.5px 14px; background-position: 0 0, 0 100%, 0 0, 100% 0; animation: s2-dash 2.4s linear infinite; }
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
.s2-art { position: relative; height: 600px; animation: s2-up .7s .15s var(--ease) both; }
.s2-art .sheet { position: absolute; background: #fff; border-radius: 14px; box-shadow: 0 20px 50px rgba(20,23,46,.12); }
.s2-art .back { aspect-ratio: 1 / 1.3; max-height: 92%; }
.s2-art .back.l { --r: -7deg; left: 4%; top: 12%; width: 58%; animation: s2-float 7s ease-in-out infinite; }
.s2-art .back.r { --r: 5deg; right: 2%; top: 4%; width: 52%; animation: s2-float 8s .8s ease-in-out infinite; }
.s2-art .front { --r: -1.5deg; left: 50%; top: 8%; width: 470px; margin-left: -235px; aspect-ratio: 1 / 1.25; border-radius: 16px; box-shadow: 0 2px 4px rgba(20,23,46,.06), var(--shadow-hero); animation: s2-float 6s .3s ease-in-out infinite; padding: 9%; display: flex; flex-direction: column; gap: 3.4%; container-type: inline-size; color: #2A2E45; }
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
.front .sig .bar { position: absolute; bottom: calc(100% + 3cqw); left: 50%; display: flex; gap: 1cqw; padding: 1.2cqw; background: #1E2559; border-radius: 3cqw; color: #fff; animation: s2-pop 4s ease-in-out infinite; white-space: nowrap; }
.front .sig .bar span { width: 8cqw; height: 7cqw; display: grid; place-items: center; } .front .sig .bar .del { color: #FF9C8F; }
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
@keyframes s2-dash { to { background-position: 40px 0, -40px 100%, 0 -40px, 100% 40px; } }
@keyframes s2-scan { 0% { top: 6%; } 100% { top: 90%; } }
@keyframes s2-shim { to { background-position: -200% 0; } }
@keyframes s2-up { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes s2-glowpulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,225,77,.55), 0 30px 60px rgba(30,37,89,.35); } 50% { box-shadow: 0 0 0 14px rgba(255,225,77,0), 0 30px 60px rgba(30,37,89,.35); } }
@container (min-width: 1600px) {
  .s2-hero { padding: 0 120px 48px; }
  .start h1 { font-size: 112px; } .s2-lead { font-size: 21px; }
  .s2-art { height: 720px; } .s2-art .front { width: 600px; margin-left: -300px; }
}
@container (max-width: 1099px) {
  .s2-hero { grid-template-columns: minmax(0, 1fr); align-content: start; gap: 24px; padding: 24px 56px 48px; }
  .start h1 { font-size: 84px; }
  .s2-art { height: 440px; } .s2-art .front { width: 400px; margin-left: -200px; }
}
@container (max-width: 379px) { .s2-navbtn .lbl { display: none; } .s2-navbtn { padding: 0 11px; } .s2-nav { gap: 8px; } }
@container (max-width: 599px) {
  .s2-nav { padding: calc(16px + var(--safe-t)) calc(20px + var(--safe-r)) 0 calc(20px + var(--safe-l)); }
  .s2-hero { gap: 0; padding: 16px calc(20px + var(--safe-r)) var(--safe-b) calc(20px + var(--safe-l)); }
  .s2-copy { gap: 16px; }
  .start h1 { font-size: 46px; } .s2-lead { font-size: 16px; }
  .s2-card { padding: 20px; flex-direction: column; align-items: stretch; }
  .s2-card.row { flex-direction: row; align-items: center; }
  .s2-cta { width: 100%; }
  .s2-chips { flex-wrap: nowrap; overflow-x: auto; margin: 0 -20px; padding: 2px 20px 8px; scrollbar-width: none; }
  .s2-chips::-webkit-scrollbar { display: none; }
  .s2-art { height: 250px; } .s2-art .front { width: 180px; margin-left: -90px; }
  .s2-badge { display: none; }
  .s2-glow { width: 360px; height: 360px; }
}
@media (prefers-reduced-motion: reduce) {
  .s2-art *, .s2-card .dash, .s2-mini .scan, .s2-bar > div, .s2-card.over { animation: none !important; }
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
.flyout2.m { left: 12px; right: 12px; width: auto; top: auto; bottom: calc(96px + var(--safe-b)); }

.thumbcol { width: 168px; flex: none; margin: calc(92px + var(--safe-t)) 0 calc(16px + var(--safe-b)) calc(116px + var(--safe-l)); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-rest); overflow-y: auto; padding: 18px 0; display: flex; flex-direction: column; align-items: center; gap: 18px; z-index: 4; }
.thumbcol .kicker { align-self: flex-start; padding: 0 22px; }
.thumbcol button { border: 0; background: none; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.thumbcol .tc { width: 116px; display: grid; place-items: center; border-radius: 3px; outline: 1px solid var(--line); background: #fff; }
.thumbcol button.on .tc { outline: 2px solid var(--ink); outline-offset: 2px; }
.thumbcol button.on { color: var(--text); font-weight: 600; }
.thumbcol canvas { display: block; max-width: 116px; height: auto; }

.canvasWrap { flex: 1; min-width: 0; position: relative; overflow: auto; touch-action: pan-x pan-y; overscroll-behavior: contain; background: var(--desk-dots); background-attachment: local; scroll-padding: calc(92px + var(--safe-t)) 0 24px; }
.bp-mobile .canvasWrap { scroll-padding: calc(76px + var(--safe-t)) 0 calc(110px + var(--safe-b)); }
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
.page.tool-whiteout, .page.tool-highlight, .page.tool-rect, .page.tool-ellipse, .page.tool-line, .page.tool-draw { cursor: crosshair; touch-action: none; }

.run { position: absolute; white-space: pre; transform-origin: 0 0; border-radius: 2px; cursor: text; }
.tool-edit .run:hover, .tool-text .run:hover { outline: 1px dashed rgba(30,37,89,.6); outline-offset: 1px; }
.run .cover { position: absolute; inset: -2px -3px; border-radius: 1px; }
.run .txt { position: absolute; left: 0; white-space: pre; }
.run textarea { position: absolute; left: 0; margin: 0; padding: 0; border: 0; border-radius: 3px; resize: none; overflow: hidden; white-space: pre; outline: none; box-shadow: 0 0 0 3px var(--paper), 0 0 0 5px #1E2559, 0 0 0 10px rgba(30,37,89,.10); font-kerning: normal; }
.run.selected:not(.editing) { outline: 2px solid #1E2559; outline-offset: 3px; }
.run.changed, .run.edited { z-index: 1; }
.layer.passive .run { pointer-events: none; }

.obj { position: absolute; touch-action: none; }
.obj.selected { outline: 1.5px solid var(--sel); outline-offset: 0; }
:root[data-theme="dark"] .obj.selected { outline-color: #3446C9; }
.obj .dotc { position: absolute; width: 9px; height: 9px; background: #fff; border: 1.5px solid #3446C9; border-radius: 50%; pointer-events: none; }
.obj .handle { position: absolute; width: 18px; height: 18px; right: -9px; bottom: -9px; background: #3446C9; border: 2px solid #fff; border-radius: 50%; cursor: nwse-resize; touch-action: none; box-shadow: 0 1px 4px rgba(20,23,46,.3); display: grid; place-items: center; color: #fff; }
.obj .handle::after { content: ""; position: absolute; inset: -13px; }
.obj textarea, .obj .tview { position: absolute; inset: 0; margin: 0; padding: 0; border: 0; background: transparent; resize: none; overflow: hidden; white-space: pre; line-height: 1.2; outline: none; }
.obj.dragging { cursor: grabbing; }
.obj.editing { cursor: text; }
.tool-edit .obj { cursor: grab; }
.obj img { width: 100%; height: 100%; display: block; pointer-events: none; }
.obj > svg { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.draft { position: absolute; border: 1.5px dashed var(--sel); pointer-events: none; }
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
.range { width: 100%; accent-color: var(--ink); height: 44px; }

/* ---------- mobile ---------- */
.dock2 { position: absolute; left: 12px; right: 12px; bottom: calc(12px + var(--safe-b)); height: 72px; z-index: 12; border-radius: 26px; background: #1E2559; box-shadow: 0 18px 44px rgba(30,37,89,.38); display: flex; align-items: center; justify-content: space-between; padding: 0 8px; animation: pe-in .3s var(--ease) both; }
:root[data-theme="dark"] .dock2 { background: #262D6E; box-shadow: 0 18px 44px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06); }
.dk { height: 56px; min-width: 56px; padding: 0; border: 0; border-radius: 20px; background: transparent; color: rgba(255,255,255,.82); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all .25s var(--ease); white-space: nowrap; }
.dk.on { padding: 0 18px 0 14px; background: #FFE14D; color: #1E2559; }
.dk span { font-size: 13.5px; font-weight: 700; }
.dk:active { transform: scale(.94); }
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
.newslot { width: 100%; aspect-ratio: 1 / 1.414; border-radius: 4px; border: 2px dashed #3446C9; background: #F3F5FF; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #3446C9; font-weight: 600; font-size: 12.5px; }
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
.big { font-size: 28px; font-weight: 700; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.dz { display: flex; align-items: center; gap: 16px; padding: 20px 24px; border-radius: 28px; border: 1.5px dashed var(--line-3); background: color-mix(in srgb, var(--surface) 55%, transparent); width: 100%; }
.dz.over { border-color: #E0B400; background: #FFFBE6; }
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
`;
