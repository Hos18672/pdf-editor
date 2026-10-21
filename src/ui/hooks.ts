import { useEffect, useState } from 'react';

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
export function setSoftKeyboard(el: HTMLTextAreaElement | HTMLInputElement, show: boolean) {
  if (show) el.removeAttribute('inputmode');
  else el.setAttribute('inputmode', 'none');
  if (document.activeElement !== el) return;
  const { selectionStart: a, selectionEnd: b } = el;
  el.dataset.refocus = '1';
  try {
    el.blur();
    el.focus({ preventScroll: true });
    if (a !== null && b !== null) el.setSelectionRange(a, b);
  } finally { delete el.dataset.refocus; }
}
