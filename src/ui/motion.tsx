// Small moments of feedback: a short buzz on phones and a "saved" burst when a file is saved.
import React, { useEffect, useState } from 'react';
import { Icon } from './icons';

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** a light tap felt on phones (Android; ignored elsewhere) */
export function haptic(ms = 8) {
  try { if (!still()) navigator.vibrate?.(ms); } catch { /* not allowed */ }
}

/** tell the app a file was saved (shows the burst) */
export function celebrate() {
  try { window.dispatchEvent(new CustomEvent('pe-saved')); } catch { /* no window */ }
}

/** a check that draws itself, with a ring and a few sparks flying out */
export function SavedBurst() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let tm = 0;
    const on = () => { haptic(14); setN((x) => x + 1); clearTimeout(tm); tm = window.setTimeout(() => setN(0), 1300); };
    window.addEventListener('pe-saved', on);
    return () => { window.removeEventListener('pe-saved', on); clearTimeout(tm); };
  }, []);
  if (!n) return null;
  return (
    <div key={n} className="burst" aria-hidden="true">
      <span className="burst-ring" />
      {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ ['--a' as any]: `${i * 36 + 8}deg`, ['--d' as any]: `${52 + (i % 3) * 14}px` }} />)}
      <span className="burst-core"><Icon name="check:bold" size={34} /></span>
    </div>
  );
}

/**
 * Phones and tablets: a bottom sheet follows the finger when pulled down by its handle or header, and
 * closes past a threshold (the same way a tap on its backdrop does); otherwise it springs back.
 */
export function useSheetPull() {
  useEffect(() => {
    const start = (e: PointerEvent) => {
      if (window.innerWidth >= 1200 || e.button > 0) return;
      const t = e.target as HTMLElement;
      const grip = t.closest?.('.grab, .mhead, .tsh');
      if (!grip || t.closest('button, input, select, textarea, a, label')) return;
      const sheet = grip.closest<HTMLElement>('.scrim.sheet > .modal, .toolsheet');
      if (!sheet) return;
      const y0 = e.clientY, t0 = performance.now();
      let dy = 0, on = false;
      const move = (ev: PointerEvent) => {
        dy = Math.max(0, ev.clientY - y0);
        if (!on && dy > 6) { on = true; sheet.classList.add('pulling'); }
        if (on) { sheet.style.transform = `translateY(${dy}px)`; ev.preventDefault(); }
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        if (!on) return;
        sheet.classList.remove('pulling');
        sheet.classList.add('letgo');
        const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
        const done = () => { sheet.classList.remove('letgo'); };
        if (dy > Math.min(140, sheet.offsetHeight * 0.3) || (fast && dy > 40)) {
          sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
          sheet.style.opacity = '0';
          setTimeout(() => {
            // close it the way a tap on the backdrop does
            const scrim = sheet.classList.contains('toolsheet') ? sheet.previousElementSibling as HTMLElement | null : sheet.parentElement;
            if (scrim) {
              const o = { bubbles: true, cancelable: true, clientX: 2, clientY: 2 };
              scrim.dispatchEvent(new PointerEvent('pointerdown', o));
              scrim.dispatchEvent(new MouseEvent('mousedown', o));
              scrim.dispatchEvent(new MouseEvent('mouseup', o));
              scrim.dispatchEvent(new MouseEvent('click', o));
            }
            // still open (this sheet doesn't close on a backdrop tap): back where it was
            setTimeout(() => { if (sheet.isConnected) { sheet.style.transform = ''; sheet.style.opacity = ''; setTimeout(done, 280); } }, 60);
          }, 200);
        } else {
          sheet.style.transform = '';
          setTimeout(done, 280);
        }
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    };
    window.addEventListener('pointerdown', start, true);
    return () => window.removeEventListener('pointerdown', start, true);
  }, []);
}
