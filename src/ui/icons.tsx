import React from 'react';
import { PH } from './phosphor';

export type Weight = 'regular' | 'fill' | 'bold' | 'duotone';

// app names → Phosphor icon names (and a preferred weight)
const ALIAS: Record<string, string> = {
  edit: 'cursor-text', fill: 'textbox', text: 'text-t', sign: 'signature', whiteout: 'eraser', highlight: 'highlighter',
  rect: 'square', ellipse: 'circle', line: 'line-segment', draw: 'scribble', pages: 'squares-four',
  undo: 'arrow-u-up-left', redo: 'arrow-u-up-right', download: 'download-simple:bold', close: 'x', back: 'arrow-left',
  rotate: 'arrow-clockwise', restore: 'arrow-counter-clockwise', up: 'caret-up', down: 'caret-down', left: 'caret-left',
  right: 'caret-right', check: 'check:bold', upload: 'upload-simple', open: 'folder-open:bold', move: 'arrows-out-cardinal',
  lock: 'lock-simple:fill', grip: 'dots-six-vertical', more: 'sliders-horizontal', fit: 'arrows-horizontal',
  resize: 'arrows-out-simple:bold', pencil: 'pencil-simple', offline: 'wifi-slash:fill', tools: 'squares-four',
};

/** Phosphor icon (MIT). `name` is an app alias or a Phosphor name, optionally with `:weight`. */
export function Icon({ name, size = 20, weight, className, style }: {
  name: string; size?: number; weight?: Weight; className?: string; style?: React.CSSProperties;
}) {
  let key = ALIAS[name] ?? name;
  if (weight && weight !== 'regular') {
    const base = key.split(':')[0];
    if (PH[`${base}:${weight}`]) key = `${base}:${weight}`;
  } else if (weight === 'regular') key = key.split(':')[0];
  const inner = PH[key] ?? PH[key.split(':')[0]] ?? '';
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false"
      className={className} style={{ flex: 'none', ...style }} dangerouslySetInnerHTML={{ __html: inner }} />
  );
}
