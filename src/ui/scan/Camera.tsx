import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { FORMATS, quadArea, type Pt, type Quad } from './geom';
import { liveDetect, stopLive } from './live';
import { MODE_RATIOS, sharpness, type ScanMode } from './engine';

export const MODES: { id: ScanMode; label: string; icon: string }[] = [
  { id: 'doc', label: 'Document', icon: 'file-text' },
  { id: 'id', label: 'ID card', icon: 'identification-card' },
  { id: 'passport', label: 'Passport', icon: 'book-open' },
  { id: 'receipt', label: 'Receipt', icon: 'receipt' },
  { id: 'book', label: 'Book', icon: 'book-open-text' },
];

type Status = 'starting' | 'live' | 'denied' | 'none' | 'error';

const readAuto = () => { try { return localStorage.getItem('pe.scan.auto') !== '0'; } catch { return true; } };
const saveAuto = (v: boolean) => { try { localStorage.setItem('pe.scan.auto', v ? '1' : '0'); } catch { /* private mode */ } };

/**
 * Live camera with document outline, auto-capture when the page is held still and sharp, torch,
 * and photo import. Hands each shot to `onShot` as a JPEG (full camera resolution when possible).
 */
export function Camera({ mode, onMode, count, lastThumb, step, waiting, onShot, onImport, onDone, onClose }: {
  mode: ScanMode; onMode: (m: ScanMode) => void; count: number; lastThumb: string | null;
  /** Done was tapped while the last page is still being read */
  waiting?: boolean;
  /** extra line under the hint, e.g. "Front side" */
  step: string | null;
  onShot: (blob: Blob) => void; onImport: (files: File[]) => void; onDone: () => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** where the whole camera frame fits on screen (nothing cropped, like the phone's camera app) */
  const [fit, setFit] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [torch, setTorch] = useState<{ can: boolean; on: boolean }>({ can: false, on: false });
  const [auto, setAuto] = useState(readAuto);
  const [hint, setHint] = useState('Point the camera at a document');
  const poly = useRef<SVGGElement>(null);
  const [found, setFound] = useState(false);
  const [hold, setHold] = useState(0); // 0…1 progress of holding still
  const [flash, setFlash] = useState(0);
  const [busy, setBusy] = useState(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const autoRef = useRef(auto); autoRef.current = auto;
  const busyRef = useRef(false);
  const shotRef = useRef<() => void>(() => {});
  // Done tapped during a shot: carried out when the photo is in
  const doneAfter = useRef(false);
  const [doneWait, setDoneWait] = useState(false);
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone;
  // lenses and zoom: the back cameras (when the phone lists several) and the zoom steps it allows
  const [dev, setDev] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const [lenses, setLenses] = useState<string[]>([]);
  const [zooms, setZooms] = useState<number[]>([]);
  const [zoom, setZoom] = useState(1);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  // ---- start / stop the camera
  useEffect(() => {
    let alive = true;
    setStatus('starting');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('none'); return; }
      try {
        // The whole sensor (4:3), not a 16:9 video crop that looks zoomed in. A preview-sized stream keeps
        // the camera fast; the photo itself is taken at full resolution (ImageCapture, or a short switch
        // to the largest size when that isn't there).
        const want = (dev?: string): MediaStreamConstraints => ({
          audio: false,
          video: {
            ...(dev ? { deviceId: { exact: dev } } : { facingMode: { ideal: 'environment' } }),
            width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 },
            // the camera's own frame size, never one cut out of a bigger frame (that looks zoomed in)
            resizeMode: { ideal: 'none' },
            advanced: [{ focusMode: 'continuous' } as any],
          } as any,
        });
        let s = dev ? await navigator.mediaDevices.getUserMedia(want(dev)).catch(() => navigator.mediaDevices.getUserMedia(want())) : await navigator.mediaDevices.getUserMedia(want());
        // phones with several back lenses: the main one (Android lists it as "camera2 0" / "camera 0"),
        // not a tele or a cropped lens the browser happened to choose
        try {
          const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && /back|rear|environment|r\u00fcck/i.test(d.label));
          if (alive) setLenses(cams.map((d) => d.deviceId).filter(Boolean));
          const main = cams.find((d) => /\b(camera2? )?0\b/.test(d.label)) ?? null;
          const curId = s.getVideoTracks()[0]?.getSettings?.().deviceId;
          if (!dev && main && curId && main.deviceId !== curId) {
            s.getTracks().forEach((t) => t.stop());
            s = await navigator.mediaDevices.getUserMedia(want(main.deviceId)).catch(() => navigator.mediaDevices.getUserMedia(want()));
          }
        } catch { /* keep the camera we have */ }
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => null);
        const track = s.getVideoTracks()[0];
        const caps: any = track.getCapabilities?.() ?? {};
        setTorch({ can: !!caps.torch, on: false });
        // some phones start the camera zoomed in: back to 1× (wider is offered as a choice: the 0.5×
        // lens bends the page's edges a little)
        try {
          const zc = caps.zoom;
          const z = zc ? Math.max(zc.min ?? 1, Math.min(1, zc.max ?? 1)) : null;
          const cur = (track.getSettings?.() as any)?.zoom;
          if (z != null && cur != null && Math.abs(cur - z) > 0.01) await track.applyConstraints({ advanced: [{ zoom: z } as any] });
          const steps: number[] = [];
          if (zc && (zc.max ?? 1) > (zc.min ?? 1)) {
            if ((zc.min ?? 1) < 0.95) steps.push(Math.round(zc.min * 10) / 10);
            steps.push(z ?? 1);
            if ((zc.max ?? 1) >= 2) steps.push(2);
          }
          if (alive) { setZooms(steps.length > 1 ? steps : []); setZoom(z ?? 1); }
        } catch { /* zoom not adjustable */ }
        try {
          const st: any = track.getSettings?.() ?? {};
          const r = st.width && st.height ? Math.max(st.width, st.height) / Math.min(st.width, st.height) : 4 / 3;
          if (Math.abs(r - 4 / 3) > 0.05) await track.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { exact: 4 / 3 }, resizeMode: { ideal: 'none' } } as any);
        } catch { /* only this shape is offered */ }
        // another app took the camera (the phone's camera app, a call): start again when we're back
        track.addEventListener('ended', () => { if (alive) setGen((g) => g + 1); });
        setStatus('live');
      } catch (e: any) {
        if (!alive) return;
        setStatus(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'none' : 'error');
      }
    })();
    return () => { alive = false; stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
  }, [dev, gen]);
  // back from another app with the camera stopped
  useEffect(() => {
    const on = () => {
      if (document.visibilityState !== 'visible') return;
      const t = stream.current?.getVideoTracks()[0];
      if (!t || t.readyState === 'ended') setGen((g) => g + 1);
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  const setZoomTo = async (z: number) => {
    const t = stream.current?.getVideoTracks()[0];
    if (!t) return;
    try { await t.applyConstraints({ advanced: [{ zoom: z } as any] }); setZoom(z); } catch { /* not adjustable */ }
  };
  const nextLens = () => {
    if (lenses.length < 2) return;
    const cur = stream.current?.getVideoTracks()[0]?.getSettings?.().deviceId ?? dev;
    const i = lenses.indexOf(cur ?? '');
    setDev(lenses[(i + 1) % lenses.length]);
  };

  // ---- fit the whole camera frame into the space between the top bar and the controls
  useEffect(() => {
    if (status !== 'live') return;
    const v = video.current, el = view.current;
    if (!v || !el) return;
    const measure = () => {
      const vw = v.videoWidth, vh = v.videoHeight, cw = el.clientWidth, ch = el.clientHeight;
      if (!vw || !vh || !cw || !ch) return;
      const sc = Math.min(cw / vw, ch / vh);
      const w = Math.round(vw * sc), h = Math.round(vh * sc);
      const next = { x: Math.round((cw - w) / 2), y: Math.round((ch - h) / 2), w, h };
      setFit((o) => (o && o.x === next.x && o.y === next.y && o.w === next.w && o.h === next.h ? o : next));
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    v.addEventListener('loadedmetadata', measure); v.addEventListener('resize', measure);
    return () => { ro.disconnect(); v.removeEventListener('loadedmetadata', measure); v.removeEventListener('resize', measure); };
  }, [status]);

  // ---- live outline + auto-capture
  // The page is found in a worker on a small frame; the outline on screen glides towards the latest
  // result every animation frame (no React re-render per frame).
  useEffect(() => {
    if (status !== 'live') return;
    let stop = false, timer = 0, raf = 0;
    let last: Quad | null = null, stableSince = 0, lostSince = 0, armed = true, shotQuad: Quad | null = null;
    // the outline last shown with confidence (frame pixels) and when: a weaker find close to it is the
    // same sheet (a finger over a corner, a moment of blur), so the outline stays put instead of blinking
    let kept: Quad | null = null, keptAt = 0;
    let target: Pt[] | null = null, shown: Pt[] | null = null;
    const frame = document.createElement('canvas');
    const fctx = frame.getContext('2d', { willReadFrequently: true })!;
    const say = (h: string) => setHint((o) => (o === h ? o : h));
    const holdTo = (v: number) => setHold((o) => (Math.abs(o - v) < 0.04 && !(v === 0 && o !== 0) ? o : v));
    const draw = () => {
      if (stop) return;
      const g = poly.current;
      if (g) {
        if (target) {
          shown = shown ? shown.map((p, i) => ({ x: p.x + (target![i].x - p.x) * 0.6, y: p.y + (target![i].y - p.y) * 0.6 })) : target.map((p) => ({ ...p }));
          const pts = shown.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          g.style.display = '';
          g.querySelector('polygon')!.setAttribute('points', pts);
          g.querySelectorAll('circle').forEach((c, i) => { c.setAttribute('cx', shown![i].x.toFixed(1)); c.setAttribute('cy', shown![i].y.toFixed(1)); });
        } else { g.style.display = 'none'; shown = null; }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const tick = async () => {
      if (stop) return;
      const v = video.current, b = box.current;
      if (!v || !b || !v.videoWidth || busyRef.current) { timer = window.setTimeout(tick, 120); return; }
      const vw = v.videoWidth, vh = v.videoHeight;
      const k0 = Math.min(1, 360 / Math.max(vw, vh));
      const fw = Math.round(vw * k0), fh = Math.round(vh * k0);
      if (frame.width !== fw || frame.height !== fh) { frame.width = fw; frame.height = fh; }
      fctx.drawImage(v, 0, 0, fw, fh);
      const img = { w: fw, h: fh, data: fctx.getImageData(0, 0, fw, fh).data };
      const { det, mean } = await liveDetect(img, { ratios: MODE_RATIOS[modeRef.current] });
      if (stop) return;
      const k = vw / fw;
      const now = performance.now();
      // where the video is drawn (object-fit: cover; the box has the frame's shape once measured)
      const cw = b.clientWidth, ch = b.clientHeight, sc = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2;
      // a clear outline, or an outline that matches the sheet as a whole (a receipt on a white desk)
      const diag = Math.hypot(vw, vh);
      const strong = !!det && (det.score > 0.62 || (det.agree ?? 0) > 0.5);
      const raw = det ? (det.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad) : null;
      const near = (a: Quad, b: Quad, f: number) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) / diag < f;
      const recent = !!kept && now - keptAt < 900;
      const ok = strong || (!!det && recent && det.score > 0.4 && near(raw!, kept!, 0.05));
      setFound(ok);
      if (det && ok) {
        let q = raw!;
        // small steps are noise: settle on the average, so the outline sits still on a still page
        if (recent && near(q, kept!, 0.012)) q = q.map((p, i) => ({ x: (p.x + kept![i].x) / 2, y: (p.y + kept![i].y) / 2 })) as Quad;
        kept = q; keptAt = now;
        const move = last ? Math.max(...q.map((p, i) => Math.hypot(p.x - last![i].x, p.y - last![i].y))) / diag : 1;
        if (move > 0.02 || !stableSince) stableSince = now;
        last = q; lostSince = 0;
        if (!armed && shotQuad && Math.max(...q.map((p, i) => Math.hypot(p.x - shotQuad![i].x, p.y - shotQuad![i].y))) / diag > 0.12) armed = true;
        target = q.map((p) => ({ x: ox + p.x * sc, y: oy + p.y * sc }));
        // big enough: by area, or by length (a long receipt that fills the frame's height)
        const area = quadArea(q) / (vw * vh);
        const span = Math.max(...q.map((p, i) => Math.hypot(q[(i + 1) % 4].x - p.x, q[(i + 1) % 4].y - p.y))) / Math.max(vw, vh);
        const close = area >= 0.12 || span >= 0.6;
        const held = Math.min(1, (now - stableSince) / 900);
        if (mean < 45) say('Too dark: add light or turn on the torch');
        else if (!close) say('Move closer');
        else if (!armed) say('Got it. Next page, or tap Done');
        else say(autoRef.current ? (held < 1 ? 'Hold still…' : 'Scanning…') : 'Tap the button to scan');
        holdTo(autoRef.current && armed && close ? held : 0);
        if (autoRef.current && armed && held >= 1 && close && strong && (det.score > 0.78 || (det.agree ?? 0) > 0.75) && mean >= 45) {
          armed = false; shotQuad = q; stableSince = 0; holdTo(0);
          shotRef.current();
        }
      } else {
        if (!lostSince) lostSince = now;
        // a frame or two without the sheet (blur, a hand passing): keep the outline a moment
        if (now - lostSince > 500) { target = null; last = null; stableSince = 0; holdTo(0); }
        if (now - lostSince > 700) armed = true;
        say(mean < 45 ? 'Too dark: add light or turn on the torch' : 'Point the camera at a document');
      }
      timer = window.setTimeout(tick, 16);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); cancelAnimationFrame(raf); frame.width = 0; stopLive(); };
  }, [status]);

  // ---- taking the picture
  const grabBest = async (v: HTMLVideoElement): Promise<Blob> => {
    // a short burst: keep the sharpest frame
    let best: HTMLCanvasElement | null = null, bestS = -1;
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      const s = sharpness(c);
      if (s > bestS) { if (best) best.width = 0; best = c; bestS = s; } else c.width = 0;
      await new Promise((r) => setTimeout(r, 70));
    }
    const blob = await new Promise<Blob | null>((r) => best!.toBlob(r, 'image/jpeg', 0.95));
    best!.width = 0;
    if (!blob) throw new Error('capture failed');
    return blob;
  };
  const shoot = useCallback(async () => {
    const v = video.current, s = stream.current;
    if (!v || !s || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setFlash((f) => f + 1);
    try { navigator.vibrate?.(20); } catch { /* no vibration */ }
    try {
      let blob: Blob | null = null;
      const track = s.getVideoTracks()[0];
      const IC = (window as any).ImageCapture;
      // the full sensor resolution, when the camera offers it (not while the torch is on: it would
      // switch off for the photo)
      if (IC && !torch.on) {
        try {
          const ic = new IC(track);
          const shot = (async () => {
            // ask for the sensor's largest photo size
            let settings: any;
            try { const c = await ic.getPhotoCapabilities(); if (c?.imageWidth?.max) settings = { imageWidth: c.imageWidth.max, imageHeight: c.imageHeight?.max }; } catch { /* defaults */ }
            return (await ic.takePhoto(settings)) as Blob;
          })();
          blob = await Promise.race([shot, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
          if (blob && blob.size < 20000) blob = null;
        } catch { blob = null; }
      }
      if (!blob) {
        // no full-resolution photo: switch the stream to the camera's largest size for the shot
        const st: any = track.getSettings?.() ?? {};
        const caps: any = track.getCapabilities?.() ?? {};
        const bigW = caps.width?.max ?? 0, bigH = caps.height?.max ?? 0;
        let raised = false;
        if (bigW * bigH > (st.width ?? 0) * (st.height ?? 0) * 1.3) {
          try {
            await track.applyConstraints({ width: { ideal: Math.min(bigW, 4096) }, height: { ideal: Math.min(bigH, 4096) }, aspectRatio: { ideal: 4 / 3 } } as any);
            raised = true;
            // wait for frames of the new size (and focus)
            const t0 = performance.now();
            while (performance.now() - t0 < 1500 && v.videoWidth * v.videoHeight <= (st.width ?? 0) * (st.height ?? 0)) await new Promise((r) => setTimeout(r, 50));
            await new Promise((r) => setTimeout(r, 250));
          } catch { /* stays at the preview size */ }
        }
        try { blob = await grabBest(v); }
        finally {
          if (raised) track.applyConstraints({ width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 }, frameRate: { ideal: 30 } } as any).catch(() => null);
        }
      }
      if (v.paused) v.play().catch(() => null);
      onShot(blob);
    } catch (e) {
      console.warn('capture failed', e);
    } finally {
      busyRef.current = false; setBusy(false);
      if (doneAfter.current) { doneAfter.current = false; setDoneWait(false); onDoneRef.current(); }
    }
  }, [onShot, torch.on]);
  const done = () => {
    if (busyRef.current) { doneAfter.current = true; setDoneWait(true); return; }
    onDone();
  };
  shotRef.current = shoot;

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const on = !torch.on;
    try { await track.applyConstraints({ advanced: [{ torch: on } as any] }); setTorch({ can: true, on }); } catch { setTorch({ can: false, on: false }); }
  };

  const ratio = mode === 'id' ? FORMATS.id1.ratio : mode === 'passport' ? FORMATS.id3.ratio : null;
  const pickFiles = (l: FileList | null) => { const f = l ? Array.from(l) : []; if (f.length) onImport(f); };
  const ring = 2 * Math.PI * 37;

  return (
    <div className="scam" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="scam-view" ref={view}>
        <div className={`scam-frame${fit ? ' fit' : ''}`} ref={box} style={fit ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h } : undefined}>
          <video ref={video} playsInline muted autoPlay aria-label="Camera preview" />
          {status === 'live' && ratio && !found && <div className="scam-guide" style={{ aspectRatio: String(ratio) }}><span>{mode === 'id' ? 'Place the card inside the frame' : 'Open the photo page and fit it in the frame'}</span></div>}
          <svg className="scam-svg" aria-hidden="true">
            <g ref={poly} style={{ display: 'none' }}>
              <polygon className={hold >= 1 ? 'go' : ''} />
              {[0, 1, 2, 3].map((i) => <circle key={i} r="7" />)}
            </g>
          </svg>
          <div key={flash} className={flash ? 'scam-flash' : ''} />
        </div>
        {status !== 'live' && status !== 'starting' && (
          <div className="scam-msg">
            <div className="tile"><Icon name={status === 'denied' ? 'camera-slash' : 'camera:duotone'} size={30} /></div>
            <b>{status === 'denied' ? 'Camera access is blocked' : status === 'none' ? 'No camera found' : 'The camera couldn’t start'}</b>
            <span>{status === 'denied' ? 'Allow the camera for this app in your browser or phone settings, or scan photos you already have.' : 'You can still scan photos of documents you already have.'}</span>
            <div className="acts">
              <button className="btn primary lg" onClick={() => fileIn.current?.click()}><Icon name="image" size={18} />Choose photos</button>
              <button className="btn lg on-dark" onClick={() => camIn.current?.click()}><Icon name="camera" size={18} />Use the camera app</button>
            </div>
          </div>
        )}
        {status === 'starting' && <div className="scam-msg quiet"><span className="spinner" />Starting the camera…</div>}
      </div>

      <div className="scam-top">
        <button className="scam-round" onClick={onClose} aria-label="Close scanner"><Icon name="x:bold" size={20} /></button>
        <span className="sp" />
        {status === 'live' && (
          <button className={`scam-pill${auto ? ' on' : ''}`} onClick={() => { setAuto(!auto); saveAuto(!auto); }} aria-pressed={auto}>
            <Icon name="lightning:fill" size={15} />Auto {auto ? 'on' : 'off'}
          </button>
        )}
        {status === 'live' && coarse && (
          <button className="scam-pill" onClick={() => camIn.current?.click()} title="Take the photo with your phone's camera app: its full quality">
            <Icon name="camera" size={15} />HD photo
          </button>
        )}
        {status === 'live' && zooms.length === 0 && lenses.length > 1 && (
          <button className="scam-round" onClick={nextLens} aria-label="Switch camera lens" title="Switch lens"><Icon name="aperture" size={20} /></button>
        )}
        {torch.can && <button className={`scam-round${torch.on ? ' on' : ''}`} onClick={toggleTorch} aria-label={torch.on ? 'Turn torch off' : 'Turn torch on'} aria-pressed={torch.on}><Icon name={torch.on ? 'flashlight:fill' : 'flashlight'} size={20} /></button>}
      </div>

      {status === 'live' && (
        <div className="scam-hint" role="status" aria-live="polite">
          {step && <b>{step}</b>}
          <span>{hint}</span>
        </div>
      )}

      <div className="scam-bottom">
        {status === 'live' && zooms.length > 1 && (
          <div className="scam-zoom" role="radiogroup" aria-label="Zoom">
            {zooms.map((z) => (
              <button key={z} role="radio" aria-checked={Math.abs(zoom - z) < 0.05} className={Math.abs(zoom - z) < 0.05 ? 'on' : ''} onClick={() => setZoomTo(z)}>
                {String(z).replace(/^0\./, '.')}{Math.abs(zoom - z) < 0.05 ? '×' : ''}
              </button>
            ))}
          </div>
        )}
        <div className="scam-modes" role="radiogroup" aria-label="What are you scanning?">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => onMode(m.id)}>{m.label}</button>
          ))}
        </div>
        <div className="scam-row">
          <button className="scam-side" onClick={() => fileIn.current?.click()} aria-label="Import photos">
            <span className="ic"><Icon name="image" size={22} /></span><span className="lb">Import</span>
          </button>
          <button className={`scam-shutter${busy ? ' busy' : ''}`} onClick={shoot} disabled={status !== 'live' || busy} aria-label="Take photo">
            <svg viewBox="0 0 80 80" aria-hidden="true">
              <circle cx="40" cy="40" r="37" className="track" />
              <circle cx="40" cy="40" r="37" className="prog" style={{ strokeDasharray: ring, strokeDashoffset: ring * (1 - hold) }} />
            </svg>
            <i />
          </button>
          <button className={`scam-side done${waiting || doneWait ? ' wait' : ''}`} onClick={done} disabled={!count && !busy} aria-label={count ? `Review ${count} ${count === 1 ? 'page' : 'pages'}` : 'No pages yet'}>
            <span className="stack">{lastThumb ? <img src={lastThumb} alt="" /> : <Icon name="files:duotone" size={22} />}{count > 0 && <em>{count}</em>}{(waiting || doneWait) && <span className="spinner" />}</span>
            <span className="lb">{count ? 'Done' : 'Pages'}</span>
          </button>
        </div>
      </div>
      <input ref={fileIn} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
      <input ref={camIn} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
        const f = e.target.files ? Array.from(e.target.files) : [];
        e.target.value = '';
        // the phone's camera app: its photo joins the pages; the live camera carries on
        if (status === 'live') f.forEach((x) => onShot(x)); else if (f.length) onImport(f);
      }} />
    </div>
  );
}
