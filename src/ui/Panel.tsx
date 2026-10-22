import React, { useState } from 'react';
import type { EditorObject, FontFamily } from '../engine/types';
import type { FontInfo, TextRun } from '../engine/pdfText';
import type { RunEdit, Tool, ToolStyle } from './store';
import { Icon } from './icons';
import { ColorPicker } from './ColorPicker';

export const COLORS = ['#000000', '#1E2559', '#3446C9', '#B83227', '#1E7A4C'];
export const INKS = ['#14161F', '#1E2559', '#2F5BD3', '#B83227'];
export const HIGHLIGHTS = ['#FFE14D', '#8FE39A', '#FFADC4', '#94CCFF'];

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const rgbOf = (h: string) => { const v = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };
const near = (a: string, b: string) => { const x = rgbOf(a), y = rgbOf(b); return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 48; };

export function Swatches({ value, onPick, list = COLORS, allowNone, original, custom = true, title }: {
  value: string | null; onPick: (c: string | null) => void; list?: string[]; allowNone?: boolean;
  /** first swatch = keep the original colour (value null) */ original?: string; custom?: boolean; title?: string;
}) {
  const [picking, setPicking] = useState(false);
  const isCustom = !!value && !list.some((c) => same(c, value));
  return (
    // pressing a swatch must not end the text edit (that would move the panel under the pointer)
    <div className="swatches" onMouseDown={(e) => e.preventDefault()}>
      {original !== undefined && (
        <button className={`swatch${value === null ? ' on' : ''}`} onClick={() => onPick(null)} aria-label="Original colour" title="Original">
          <i style={{ background: original }} />
        </button>
      )}
      {allowNone && <button className={`swatch none${value === null ? ' on' : ''}`} onClick={() => onPick(null)} aria-label="No fill" title="None"><i /></button>}
      {list.filter((c) => !(original && near(c, original))).map((c) => (
        <button key={c} className={`swatch${same(value, c) ? ' on' : ''}`} onClick={() => onPick(c)} aria-label={`Colour ${c}`}><i style={{ background: c }} /></button>
      ))}
      {custom && (
        <button type="button" className={`swatch custom${isCustom ? ' on' : ''}`} onClick={() => setPicking(true)} aria-label="More colours" title="More colours" aria-haspopup="dialog">
          <i style={isCustom ? { background: value!, border: 0 } : undefined}>{!isCustom && <Icon name="plus" size={14} />}</i>
        </button>
      )}
      {picking && <ColorPicker value={value ?? original ?? '#000000'} title={title} onApply={(c) => onPick(c)} onClose={() => setPicking(false)} />}
    </div>
  );
}

export const Stepper = ({ value, onChange, min, max, label, unit, soft, step = 1 }: {
  value: number; onChange: (v: number) => void; min: number; max: number; label: string; unit?: string; soft?: boolean; step?: number;
}) => {
  const r = (v: number) => Math.round(v / step) * step;
  return (
    <div className={`stepper${soft ? ' soft' : ''}`} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, r(value) - step))} aria-label={`Decrease ${label}`}><Icon name="minus" size={16} /></button>
      <span className="v">{Math.round(value * 10) / 10}{unit && <small> {unit}</small>}</span>
      <button type="button" onClick={() => onChange(Math.min(max, r(value) + step))} aria-label={`Increase ${label}`}><Icon name="plus" size={16} /></button>
    </div>
  );
};

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="t"><b>{label}</b>{hint && <span>{hint}</span>}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, lg }: { value: T; options: [T, React.ReactNode][]; onChange: (v: T) => void; lg?: boolean }) {
  return (
    <div className={`seg${lg ? ' lg' : ''}`} role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

const FAMILIES: [FontFamily, string, string][] = [
  ['Helvetica', 'Sans', 'Arial, Helvetica, sans-serif'], ['Times', 'Serif', '"Times New Roman", serif'], ['Courier', 'Mono', '"Courier New", monospace'],
];
const Family = ({ value, onChange }: { value: FontFamily; onChange: (f: FontFamily) => void }) => (
  <Seg value={value} onChange={onChange} options={FAMILIES.map(([f, label, css]) => [f, <span style={{ fontFamily: css }}>{label}</span>])} />
);

function Head({ kicker, title, onClose }: { kicker: string; title: string; onClose?: () => void }) {
  return (
    <div className="head">
      <div className="t"><div className="kicker">{kicker}</div><h3>{title}</h3></div>
      {onClose && <button className="ibtn" onClick={onClose} aria-label="Close panel"><Icon name="close" size={18} /></button>}
    </div>
  );
}

export const fontLabel = (font?: FontInfo) => {
  const n = (font?.name || '').replace(/^[A-Z]{6}\+/, '').replace(/[-,](Regular|Roman)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return n || 'Embedded font';
};

/** Properties of an existing line of text */
export function RunProps({ run, font, known, edit, line, origColor, onEdit, onReset, onClose, compact }: {
  run: TextRun; font?: FontInfo; known?: (c: string) => boolean; edit?: RunEdit; line: string; origColor: string;
  onEdit: (e: RunEdit) => void; onReset: () => void; onClose?: () => void; compact?: boolean;
}) {
  const cur: RunEdit = edit ?? { text: run.str, sizeScale: 1, color: null };
  const missing = [...new Set([...cur.text].filter((c) => !/\s/.test(c) && font && !(known ? known(c) : font.charMap[c] !== undefined)))];
  const size = run.region.height * cur.sizeScale;
  const setSize = (v: number) => onEdit({ ...cur, sizeScale: v / run.region.height });
  return (
    <div className="props">
      {!compact && <Head kicker="Existing text" title={line} onClose={onClose} />}
      <div className="field">
        <div className="label">Font</div>
        <div className="fontbox" title={font?.name}>
          <span className="aa" style={{ fontFamily: font?.editFamily ? `"${font.editFamily}", ${font.cssFallback}` : font?.cssFallback }}>Aa</span>
          <span className="fn">{fontLabel(font)}</span><span className="badge">Original</span>
        </div>
      </div>
      {missing.length > 0 && (
        <div className="note warn"><Icon name="info" size={16} />
          <span>The embedded font has no {missing.slice(0, 10).join(' ')}{missing.length > 10 ? '…' : ''}. Those characters use a similar standard font.</span>
        </div>
      )}
      <div className="field"><div className="label">Size</div>
        <Stepper value={size} min={2} max={300} onChange={setSize} label="size" unit="pt" />
      </div>
      <div className="field"><div className="label">Colour</div>
        <Swatches value={cur.color} original={origColor} title="Text colour" onPick={(c) => onEdit({ ...cur, color: c })} />
      </div>
      <div className="acts">
        {edit && <button className="btn outline" onClick={onReset}><Icon name="restore" size={17} />Restore original</button>}
        <button className="btn danger" onClick={() => onEdit({ ...cur, text: '' })}><Icon name="trash" size={17} />Delete line</button>
      </div>
      {!compact && <div className="keys"><span><b>Enter</b> confirm</span><span><b>Esc</b> cancel</span><span><b>Tab</b> next line</span></div>}
    </div>
  );
}

export const OBJ_TITLE: Record<EditorObject['type'], string> = {
  text: 'Text', image: 'Image', signature: 'Signature', rect: 'Box', ellipse: 'Circle',
  whiteout: 'Whiteout', redact: 'Redaction', highlight: 'Highlight', line: 'Line', draw: 'Drawing', mark: 'Mark', link: 'Link',
};
/** the name of an object as shown (an underline is a "highlight" with a style) */
export const objTitle = (o: EditorObject) => o.type === 'highlight' && o.style ? (o.style === 'underline' ? 'Underline' : 'Strike-through')
  : o.type === 'line' && o.arrow ? 'Arrow' : OBJ_TITLE[o.type];
export const MARK_INKS = ['#D93025', '#1E2559', '#2F5BD3', '#14161F', '#1E7A4C'];

export function ObjProps({ o, onChange, onDelete, onDuplicate, onClose, compact, order }: {
  o: EditorObject; onChange: (p: Partial<EditorObject>) => void; onDelete: () => void; onDuplicate: () => void; onClose?: () => void; compact?: boolean;
  /** the document's pages in order (original indices), for links to a page */
  order?: number[];
}) {
  const set = (p: any) => onChange(p);
  return (
    <div className="props">
      {!compact && <Head kicker="Added object" title={objTitle(o)} onClose={onClose} />}
      {o.type === 'link' && <LinkProps o={o} order={order ?? []} onChange={set} />}
      {o.type === 'text' && (
        <>
          <div className="field"><div className="label">Font</div><Family value={o.family} onChange={(family) => set({ family })} /></div>
          <div className="grid2">
            <div className="field"><div className="label">Size</div><Stepper value={o.size} min={4} max={200} onChange={(size) => set({ size })} label="size" /></div>
            <div className="field"><div className="label">Style</div>
              <div className="bstyle">
                <button className={o.bold ? 'on' : ''} onClick={() => set({ bold: !o.bold })} style={{ fontWeight: 700 }} aria-label="Bold" aria-pressed={o.bold}>B</button>
                <button className={o.italic ? 'on' : ''} onClick={() => set({ italic: !o.italic })} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }} aria-label="Italic" aria-pressed={o.italic}>I</button>
              </div>
            </div>
          </div>
          <div className="field"><div className="label">Colour</div><Swatches value={o.color} onPick={(color) => set({ color: color ?? '#000000' })} /></div>
        </>
      )}
      {(o.type === 'rect' || o.type === 'ellipse') && (
        <>
          <div className="field"><div className="label">Outline</div><Swatches value={o.stroke} onPick={(stroke) => set({ stroke: stroke ?? '#000000' })} /></div>
          <div className="field"><div className="label">Fill</div><Swatches value={o.fill} allowNone onPick={(fill) => set({ fill })} /></div>
          <div className="field"><div className="label">Outline width</div><Stepper value={o.strokeWidth} min={0} max={30} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} label="outline width" unit="pt" /></div>
        </>
      )}
      {(o.type === 'line' || o.type === 'draw') && (
        <>
          <div className="field"><div className="label">Colour</div><Swatches value={o.stroke} onPick={(stroke) => set({ stroke: stroke ?? '#000000' })} /></div>
          <div className="field"><div className="label">Width</div><Stepper value={o.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => set({ strokeWidth })} label="width" unit="pt" /></div>
          {o.type === 'line' && <Toggle label="Arrow head" checked={!!o.arrow} onChange={(arrow) => set({ arrow })} />}
        </>
      )}
      {o.type === 'mark' && (
        <>
          <div className="field"><div className="label">Colour</div><Swatches value={o.color} onPick={(color) => set({ color: color ?? '#000000' })} /></div>
          <div className="field"><div className="label">Size</div><Stepper value={o.w} min={4} max={60} onChange={(w) => set({ w, h: w })} label="size" unit="pt" /></div>
        </>
      )}
      {o.type === 'whiteout' && (
        <div className="field"><div className="label">Colour</div><Swatches value={o.fill} list={['#ffffff', '#f4f4f4', '#000000']} onPick={(fill) => set({ fill: fill ?? '#ffffff' })} /></div>
      )}
      {o.type === 'redact' && (
        <div className="note"><Icon name="eye-slash" size={16} /><span>When you download, the text and picture parts under this box are deleted from the file, not just covered. They can’t be copied or found any more.</span></div>
      )}
      {o.type === 'highlight' && (
        <>
          <div className="field"><div className="label">Style</div>
            <Seg value={o.style ?? 'highlight'} options={[['highlight', 'Highlight'], ['underline', 'Underline'], ['strike', 'Strike']]}
              onChange={(v) => set(v === 'highlight'
                ? { style: undefined, fill: HIGHLIGHTS.includes(o.fill) ? o.fill : HIGHLIGHTS[0], opacity: 0.4 }
                : { style: v, fill: HIGHLIGHTS.includes(o.fill) ? MARK_INKS[0] : o.fill, opacity: 1 })} />
          </div>
          <div className="field"><div className="label">Colour</div>
            {o.style
              ? <Swatches value={o.fill} list={MARK_INKS} onPick={(fill) => set({ fill: fill ?? MARK_INKS[0] })} />
              : <Swatches value={o.fill} list={HIGHLIGHTS} custom={false} onPick={(fill) => set({ fill: fill ?? HIGHLIGHTS[0] })} />}
          </div>
        </>
      )}
      {(o.type === 'image' || o.type === 'signature') && (
        <div className="field"><div className="label">Opacity</div>
          <Stepper value={Math.round((o.opacity ?? 1) * 100)} min={10} max={100} step={10} unit="%" onChange={(v) => set({ opacity: v / 100 })} label="opacity" />
        </div>
      )}
      <div className="acts2">
        <button className="btn outline" onClick={onDuplicate}><Icon name="copy" size={17} />Duplicate</button>
        <button className="btn outline danger" onClick={onDelete}><Icon name="trash" size={17} />Delete</button>
      </div>
      {!compact && <div className="hint">Drag to move. Drag the corner to resize{o.type === 'image' || o.type === 'signature' ? ' (Alt frees the proportions)' : ''}. Arrow keys nudge 1 pt, Shift+arrow 10 pt.</div>}
    </div>
  );
}

/** Where a link goes: a web address (or e-mail), or a page of this document. */
function LinkProps({ o, order, onChange }: { o: Extract<EditorObject, { type: 'link' }>; order: number[]; onChange: (p: any) => void }) {
  const kind = o.target !== undefined ? 'page' : 'web';
  const pageNo = o.target !== undefined ? Math.max(1, order.indexOf(o.target) + 1) : 1;
  return (
    <>
      <div className="field"><div className="label">Opens</div>
        <Seg value={kind} options={[['web', 'Web address'], ['page', 'A page']]}
          onChange={(v) => onChange(v === 'page' ? { target: order[0] ?? 0 } : { target: undefined })} />
      </div>
      {kind === 'web' ? (
        <div className="field"><div className="label">Address</div>
          <input className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://example.com or name@mail.com"
            value={o.url} onChange={(e) => onChange({ url: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Web address" />
        </div>
      ) : (
        <div className="field"><div className="label">Page</div>
          <Stepper value={pageNo} min={1} max={Math.max(1, order.length)} onChange={(n) => onChange({ target: order[Math.max(0, Math.min(order.length - 1, n - 1))] })} label="page" />
        </div>
      )}
      <div className="hint">The box is invisible in the saved PDF; tapping it there opens the {kind === 'web' ? 'address' : 'page'}.</div>
    </>
  );
}

const TOOL_NAMES: Partial<Record<Tool, string>> = { text: 'Add text', rect: 'Box', ellipse: 'Circle', line: 'Line', arrow: 'Arrow', draw: 'Draw', highlight: 'Highlight', underline: 'Underline', strike: 'Strike-through', whiteout: 'Whiteout', redact: 'Redact', link: 'Link' };
const TOOL_HINTS: Partial<Record<Tool, string>> = {
  text: 'Click anywhere on a page to start typing.', rect: 'Drag on the page to draw a box.', ellipse: 'Drag on the page to draw a circle.',
  line: 'Drag on the page to draw a line.', arrow: 'Drag from where the arrow starts to where it points.', draw: 'Draw freely with mouse, finger or pen.',
  highlight: 'Drag across the text to highlight it, or tap a word.', underline: 'Drag across the text to underline it, or tap a word.', strike: 'Drag across the text to strike it through, or tap a word.',
  link: 'Drag a box over text or a picture, then type the web address or pick a page.',
  whiteout: 'Drag over anything you want to hide. To change a line of text, use Edit and click it instead.',
  redact: 'Drag over what must go: names, numbers, signatures. On download it is deleted from the file, not only covered. Use the privacy check to find personal data.',
};
export const toolHasProps = (t: Tool) => !!TOOL_NAMES[t];

export function ToolProps({ tool, style, onChange, compact }: { tool: Tool; style: ToolStyle; onChange: (s: Partial<ToolStyle>) => void; compact?: boolean }) {
  return (
    <div className={`props${compact ? ' compact' : ''}`}>
      {!compact && <div className="head"><div className="t"><div className="kicker">Tool</div><h3>{TOOL_NAMES[tool]}</h3>
        <div className="hint" style={{ marginTop: 2 }}>{TOOL_HINTS[tool]}</div></div></div>}
      {tool === 'text' && (
        <>
          <div className="field"><div className="label">Font</div><Family value={style.family} onChange={(family) => onChange({ family })} /></div>
          <div className="field"><div className="label">Size</div><Stepper value={style.fontSize} min={4} max={200} onChange={(fontSize) => onChange({ fontSize })} label="size" unit="pt" /></div>
          <div className="field"><div className="label">Colour</div><Swatches value={style.color} onPick={(color) => onChange({ color: color ?? '#000000' })} /></div>
        </>
      )}
      {(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'draw') && (
        <>
          <div className="field"><div className="label">Colour</div><Swatches value={style.stroke} onPick={(stroke) => onChange({ stroke: stroke ?? '#000000' })} /></div>
          {(tool === 'rect' || tool === 'ellipse') && <div className="field"><div className="label">Fill</div><Swatches value={style.fill} allowNone onPick={(fill) => onChange({ fill })} /></div>}
          <div className="field"><div className="label">Width</div><Stepper value={style.strokeWidth} min={0.5} max={30} step={0.5} onChange={(strokeWidth) => onChange({ strokeWidth })} label="width" unit="pt" /></div>
        </>
      )}
      {tool === 'highlight' && <div className="field"><div className="label">Colour</div><Swatches value={style.highlight} list={HIGHLIGHTS} custom={false} onPick={(highlight) => onChange({ highlight: highlight ?? HIGHLIGHTS[0] })} /></div>}
      {(tool === 'underline' || tool === 'strike') && <div className="field"><div className="label">Colour</div><Swatches value={style.ink} list={MARK_INKS} onPick={(ink) => onChange({ ink: ink ?? MARK_INKS[0] })} /></div>}
    </div>
  );
}

export interface ChangeItem { id: string; icon: string; label: string; page: number }

export function IdleProps({ changes, onPick }: { changes: ChangeItem[]; onPick: (id: string) => void }) {
  return (
    <div className="props">
      <div className="head"><div className="t"><div className="kicker">Edit tool</div><h3 style={{ whiteSpace: 'normal' }}>Click any line to retype it</h3>
        <div className="hint" style={{ fontSize: 13.5, marginTop: 2 }}>The new text keeps the original font, size, colour and position.</div></div></div>
      <div className="field">
        <div className="label">Changes</div>
        {changes.length ? (
          <div className="changes">
            {changes.map((c) => (
              <button key={c.id} onClick={() => onPick(c.id)}><Icon name={c.icon} size={18} /><span className="l">{c.label}</span><span className="p">p. {c.page}</span></button>
            ))}
          </div>
        ) : <div className="empty-changes">No changes yet.</div>}
      </div>
    </div>
  );
}
