import { useEffect, useRef, useState } from 'react';

export type Bp = 'mobile' | 'tablet' | 'desktop' | 'large';

const bpOf = (): Bp => {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth;
  return w < 600 ? 'mobile' : w < 1100 ? 'tablet' : w < 1600 ? 'desktop' : 'large';
};

/** Layout breakpoint: mobile < 600, tablet < 1100, desktop < 1600, large ≥ 1600 */
export function useBp(): Bp {
  const [bp, setBp] = useState<Bp>(bpOf);
  useEffect(() => {
    const fn = () => setBp(bpOf());
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return bp;
}

export type Theme = 'light' | 'dark';
const THEME_KEY = 'pdfeditor.theme';

/** Light/dark theme: follows the system until the user picks one. */
export function useTheme(): [Theme, () => void] {
  const sys = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') as Theme;
  const stored = (): Theme | null => { try { const v = localStorage.getItem(THEME_KEY); return v === 'dark' || v === 'light' ? v : null; } catch { return null; } };
  const [theme, setTheme] = useState<Theme>(() => stored() ?? sys());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191C27' : '#FFFFFF');
  }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const fn = () => { if (!stored()) setTheme(sys()); };
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const toggle = () => setTheme((t) => {
    const n = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, n); } catch { /* storage unavailable */ }
    return n;
  });
  return [theme, toggle];
}

/** Keep the app as tall as the visible area, so bars sit right above the on-screen keyboard. */
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta && !/interactive-widget/.test(meta.getAttribute('content') ?? '')) {
      meta.setAttribute('content', (meta.getAttribute('content') ?? 'width=device-width, initial-scale=1') + ', interactive-widget=resizes-content');
    }
    if (!vv) return;
    const fn = () => {
      document.documentElement.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
      if (vv.offsetTop > 0 && document.scrollingElement) document.scrollingElement.scrollTop = 0;
    };
    fn();
    vv.addEventListener('resize', fn);
    vv.addEventListener('scroll', fn);
    return () => { vv.removeEventListener('resize', fn); vv.removeEventListener('scroll', fn); };
  }, []);
}

/** True while `setSoftKeyboard` re-focuses a field: that blur is not the user leaving it. */
export const isRefocusing = (el: EventTarget | null) => !!(el as HTMLElement | null)?.dataset?.refocus;

/**
 * Show or hide the phone keyboard for a focused text field without leaving it (caret and editing stay).
 * Android only re-reads `inputmode` on focus, so the field is re-focused quietly.
 */
export function setSoftKeyboard(el: HTMLElement, show: boolean) {
  if (show) el.removeAttribute('inputmode');
  else el.setAttribute('inputmode', 'none');
  if (document.activeElement !== el) return;
  const field = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
  const a = field?.selectionStart ?? null, b = field?.selectionEnd ?? null;
  // an editable element: its selection is a range
  const sel = window.getSelection();
  const range = !field && sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  el.dataset.refocus = '1';
  try {
    el.blur();
    el.focus({ preventScroll: true });
    if (field && a !== null && b !== null) field.setSelectionRange(a, b);
    if (range && sel) { sel.removeAllRanges(); sel.addRange(range); }
  } finally { delete el.dataset.refocus; }
}

// While a dialog that belongs to the text being edited is open (e.g. the colour picker), the text
// field may lose focus without that ending the edit.
let editHolds = 0;
export const editingHeld = () => editHolds > 0;
export function holdEditing(): () => void {
  editHolds++;
  let done = false;
  return () => { if (!done) { done = true; editHolds--; } };
}

export interface ChromeColors { top: string; bottom: string; topDark: boolean; bottomDark: boolean }

/** Parses a computed CSS colour (rgb/rgba, or color(srgb …) from color-mix) into 0–255 rgb + alpha. */
function parseColor(c: string): [number, number, number, number] | null {
  let m = c.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  m = c.match(/^color\(srgb ([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
  }
  return null;
}

/** The colour actually painted at a point: every background stacked there, blended bottom-up. */
function paintedAt(x: number, y: number): [number, number, number] {
  let out: [number, number, number] = [255, 255, 255];
  const stack = (document.elementsFromPoint?.(x, y) ?? []) as HTMLElement[];
  for (let i = stack.length - 1; i >= 0; i--) {
    const col = parseColor(getComputedStyle(stack[i]).backgroundColor);
    if (!col || col[3] <= 0) continue;
    const a = col[3];
    out = [out[0] * (1 - a) + col[0] * a, out[1] * (1 - a) + col[1] * a, out[2] * (1 - a) + col[2] * a];
  }
  return out;
}

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const isDark = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] < 140;

/**
 * Android app: reports the colours at the top and bottom edge of the page so the native status bar
 * and navigation bar areas can match them (theme, screen, open sheets).
 */
export function useEdgeColors(report: ((c: ChromeColors) => void) | undefined, deps: unknown[]) {
  const last = useRef('');
  useEffect(() => {
    if (!report) return;
    let raf = 0, t = 0;
    const measure = () => {
      const x = Math.min(4, innerWidth - 1);
      const top = paintedAt(x, 1), bottom = paintedAt(x, innerHeight - 2);
      const c: ChromeColors = { top: hex(top), bottom: hex(bottom), topDark: isDark(top), bottomDark: isDark(bottom) };
      const key = JSON.stringify(c);
      if (key !== last.current) { last.current = key; try { report(c); } catch { /* host gone */ } }
    };
    const soon = () => { cancelAnimationFrame(raf); clearTimeout(t); raf = requestAnimationFrame(() => { t = window.setTimeout(measure, 60); }); };
    soon();
    // sheets, dialogs and screens come and go: re-measure after DOM changes (debounced) and animations
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-theme'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const late = () => { clearTimeout(t); t = window.setTimeout(measure, 120); };
    document.addEventListener('animationend', late, true);
    window.addEventListener('resize', soon);
    return () => { mo.disconnect(); document.removeEventListener('animationend', late, true); window.removeEventListener('resize', soon); cancelAnimationFrame(raf); clearTimeout(t); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Status-bar height the page draws under (Android app), in CSS px. */
export const safeTop = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0;

/**
 * Android app: the page runs edge to edge. Ask the app for the status / navigation bar sizes and expose
 * them as --safe-t / --safe-b / --safe-l / --safe-r (env(safe-area-inset-*) is not reliable in a WebView).
 */
export function useNativeInsets(get: (() => Promise<{ top: number; bottom: number; left: number; right: number }>) | undefined) {
  useEffect(() => {
    if (!get) return;
    let alive = true, t = 0;
    const apply = () => {
      get().then((i) => {
        if (!alive || !i) return;
        const s = document.documentElement.style;
        s.setProperty('--safe-t', `${Math.round(i.top)}px`);
        s.setProperty('--safe-b', `${Math.round(i.bottom)}px`);
        s.setProperty('--safe-l', `${Math.round(i.left)}px`);
        s.setProperty('--safe-r', `${Math.round(i.right)}px`);
      }).catch(() => null);
    };
    // the keyboard and rotation resize the page; ask again once things settle
    const again = () => { apply(); clearTimeout(t); t = window.setTimeout(apply, 350); };
    again();
    window.addEventListener('resize', again);
    return () => { alive = false; clearTimeout(t); window.removeEventListener('resize', again); };
  }, [get]);
}
