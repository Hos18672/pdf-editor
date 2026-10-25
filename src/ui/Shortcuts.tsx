// The keyboard and mouse shortcuts of the editor, as a sheet (opened with ? or the keyboard button).
import React from 'react';
import { Icon } from './icons';
import { useBack } from './back';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const C = mac ? '⌘' : 'Ctrl';

const GROUPS: { name: string; rows: [string[], string][] }[] = [
  { name: 'Move around', rows: [
    [['Space', 'drag'], 'Move the page'],
    [[C, 'drag'], 'Move the page'],
    [['Middle button', 'drag'], 'Move the page'],
    [[C, 'wheel'], 'Zoom at the pointer'],
    [[C, '+'], 'Zoom in'], [[C, '−'], 'Zoom out'], [[C, '0'], 'Fit the width'],
    [['Page Down'], 'Next page'], [['Page Up'], 'Previous page'], [['Home'], 'First page'], [['End'], 'Last page'],
  ] },
  { name: 'Tools', rows: [
    [['E'], 'Edit text'], [['T'], 'Add text'], [['S'], 'Sign'], [['I'], 'Image'], [['K'], 'Link'],
    [['W'], 'Whiteout'], [['X'], 'Redact'], [['M'], 'Remove'], [['H'], 'Highlight'], [['R'], 'Shapes'], [['D'], 'Draw'],
    [['F'], 'Fill a form'], [['P'], 'Pages'], [['[ ]'], 'Remove brush size'], [['?'], 'This list'], [['Esc'], 'Back to Edit, deselect'],
  ] },
  { name: 'Edit', rows: [
    [[C, 'Z'], 'Undo'], [[C, 'Y'], 'Redo'], [[C, 'C'], 'Copy a line or object'], [[C, 'X'], 'Cut'], [[C, 'V'], 'Paste on the page in view'],
    [[C, 'D'], 'Duplicate'], [['Delete'], 'Delete the selection'], [['Arrows'], 'Nudge 1 pt'], [['Shift', 'Arrows'], 'Nudge 10 pt'],
    [[C, 'B'], 'Bold (while typing)'], [[C, 'I'], 'Italic (while typing)'], [[C, 'U'], 'Underline (while typing)'],
  ] },
  { name: 'File', rows: [
    [[C, 'S'], 'Download'], [[C, 'P'], 'Print'], [[C, 'F'], 'Find'],
  ] },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  useBack(onClose);
  return (
    <>
      <div className="sheet-scrim keys-scrim" onClick={onClose} />
      <div className="bsheet center keys" role="dialog" aria-label="Keyboard shortcuts">
        <div className="keys-h">
          <h3><Icon name="keyboard" size={20} />Keyboard and mouse</h3>
          <button className="ibtn muted" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="keys-grid">
          {GROUPS.map((g) => (
            <section key={g.name}>
              <h4>{g.name}</h4>
              {g.rows.map(([keys, what], i) => (
                <div className="keys-row" key={i}>
                  <span className="keys-k">{keys.map((k, j) => <React.Fragment key={j}>{j > 0 && <i>+</i>}<kbd>{k}</kbd></React.Fragment>)}</span>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
