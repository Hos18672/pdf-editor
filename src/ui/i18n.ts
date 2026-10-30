// Interface language: English (the source text) or German. The English text is the key, so a
// string without a German entry simply stays English. German follows the device or browser
// language until the user picks one.
import React, { useEffect, useState } from 'react';
import { DE } from './i18n.de';

export type Lang = 'en' | 'de';
const KEY = 'pe.lang';
const listeners = new Set<(l: Lang) => void>();

const stored = (): Lang | null => { try { const v = localStorage.getItem(KEY); return v === 'de' || v === 'en' ? v : null; } catch { return null; } };
const fromDevice = (): Lang => {
  const l = (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'en';
  return l.toLowerCase().startsWith('de') ? 'de' : 'en';
};

let lang: Lang = stored() ?? fromDevice();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  listeners.forEach((f) => f(l));
}

/** Translate: `t('Saved {name}', { name })`. Unknown strings stay English. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = lang === 'de' ? (DE[en] ?? en) : en;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

/** A sentence with elements inside: `tj('Tap {plus} to add', { plus: <b>+</b> })`. */
export function tj(en: string, parts: Record<string, React.ReactNode>): React.ReactNode {
  const s = lang === 'de' ? (DE[en] ?? en) : en;
  return s.split(/(\{\w+\})/).map((seg, i) => {
    const m = seg.match(/^\{(\w+)\}$/);
    return React.createElement(React.Fragment, { key: i }, m && m[1] in parts ? parts[m[1]] : seg);
  });
}

/** Singular / plural with the count: `tn(n, '{n} page', '{n} pages')`. */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

/** Re-render on language change (used once, at the root: the whole tree re-renders). */
export function useLang(): [Lang, (l: Lang) => void] {
  const [l, set] = useState<Lang>(lang);
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set); }; }, []);
  return [l, setLang];
}

/** Dates and numbers in the interface language. */
export const locale = () => (lang === 'de' ? 'de-AT' : 'en-GB');
