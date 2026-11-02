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
