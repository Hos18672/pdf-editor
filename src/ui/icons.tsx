import React from 'react';

const P: Record<string, React.ReactNode> = {
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  text: <><path d="M5 6V4h14v2" /><path d="M12 4v16" /><path d="M9 20h6" /></>,
  sign: <><path d="M3 17c3-1 4-9 6-9s-1 9 2 9 3-5 5-5 1 4 3 4" /><path d="M3 21h18" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></>,
  whiteout: <><path d="M14 4l6 6-9 9H5v-6l9-9z" /><path d="M5 21h14" /></>,
  highlight: <><path d="M9 11l-4 4v3h3l4-4" /><path d="M9 11l6-6 4 4-6 6z" /><path d="M3 21h8" /></>,
  shapes: <><rect x="3" y="3" width="9" height="9" rx="1" /><circle cx="16" cy="16" r="5" /></>,
  rect: <rect x="4" y="5" width="16" height="14" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="7" />,
  line: <path d="M5 19L19 5" />,
  draw: <path d="M3 17c2-4 4-6 6-4s1 5 4 4 3-8 8-9" />,
  pages: <><rect x="7" y="3" width="12" height="15" rx="1.5" /><path d="M5 7v12a2 2 0 002 2h9" /></>,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></>,
  download: <><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  close: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  rotate: <><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  left: <path d="M14 6l-6 6 6 6" />,
  right: <path d="M10 6l6 6-6 6" />,
  check: <path d="M5 12l5 5 9-10" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>,
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M5 20h14" /></>,
  file: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5" /></>,
  move: <><path d="M12 3v18M3 12h18" /><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>,
};

export function Icon({ name, size = 22, stroke = 1.8 }: { name: keyof typeof P | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
