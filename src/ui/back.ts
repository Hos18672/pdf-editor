// "Back" for the phone's back button (Android app) and the browser's back button (web):
// screens and dialogs register a handler; the most recent one runs first. With nothing to go back
// to, the Android app closes and the browser leaves the page as usual.
import { useEffect, useRef } from 'react';

type Handler = () => void;
const stack: { run: React.MutableRefObject<Handler> }[] = [];
const listeners = new Set<() => void>();

/** Registers `handler` while `enabled`; later registrations (dialogs) take precedence. */
export function useBack(handler: Handler, enabled = true) {
  const run = useRef(handler);
  run.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const entry = { run };
    stack.push(entry);
    listeners.forEach((f) => f());
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      listeners.forEach((f) => f());
    };
  }, [enabled]);
}

/** Runs the top handler. False when there is nothing to go back to. */
export function goBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.run.current();
  return true;
}

export const canGoBack = () => stack.length > 0;

/**
 * Connects the back buttons. Android: the app shell sends a `pe-back` event; when nothing handles it
 * the app is closed with `exit`. Web: one extra history entry is kept while something can be closed,
 * so the browser's back button closes it instead of leaving the app.
 */
export function useBackButton(native: boolean, exit?: () => void) {
  useEffect(() => {
    if (native) {
      const onBack = () => { if (!goBack()) exit?.(); };
      window.addEventListener('pe-back', onBack);
      return () => window.removeEventListener('pe-back', onBack);
    }
    let armed = false, skip = false, queued = 0;
    const now = () => {
      queued = 0;
      if (stack.length && !armed) { history.pushState({ pe: 1 }, ''); armed = true; }
      else if (!stack.length && armed) { armed = false; skip = true; history.back(); }
    };
    // screens swap their handlers within one update: settle once afterwards
    const sync = () => { if (!queued) queued = window.setTimeout(now, 60); };
    const onPop = () => {
      if (skip) { skip = false; return; }
      armed = false;
      goBack();
      sync();
    };
    listeners.add(sync);
    window.addEventListener('popstate', onPop);
    sync();
    return () => { clearTimeout(queued); listeners.delete(sync); window.removeEventListener('popstate', onPop); };
  }, [native, exit]);
}
