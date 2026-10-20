import React from 'react';
import type { M } from '../engine/types';
import { Icon } from './icons';

export interface FormField {
  id: string; name: string; page: number; type: 'text' | 'check' | 'radio' | 'choice' | 'sig';
  /** viewport box at scale 1 */ x: number; y: number; w: number; h: number;
  multiline?: boolean; options?: { v: string; label: string }[]; exportValue?: string;
  initial: string | boolean; readOnly?: boolean; fontSize?: number; maxLen?: number; align?: number; label: string;
}

const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Read the fillable fields of every page (pdf.js widget annotations). */
export async function readFields(pdf: any, vms: M[]): Promise<FormField[]> {
  const out: FormField[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    let anns: any[] = [];
    try { anns = await (await pdf.getPage(i + 1)).getAnnotations({ intent: 'display' }); } catch { continue; }
    for (const a of anns) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.pushButton || a.hidden) continue;
      const [x1, y1, x2, y2] = a.rect;
      const pts = [apply(vms[i], x1, y1), apply(vms[i], x2, y2), apply(vms[i], x1, y2), apply(vms[i], x2, y1)];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      if (box.w < 2 || box.h < 2) continue;
      const base = { id: `${i}:${a.id}`, name: a.fieldName as string, page: i, ...box, readOnly: !!a.readOnly,
        label: (a.alternativeText || a.fieldName || '').toString().trim(), fontSize: a.defaultAppearanceData?.fontSize || 0 };
      if (a.fieldType === 'Tx') {
        out.push({ ...base, type: 'text', multiline: !!a.multiLine, initial: (a.fieldValue ?? '').toString(), maxLen: a.maxLen || undefined, align: a.textAlignment ?? 0 });
      } else if (a.fieldType === 'Btn' && a.checkBox) {
        const on = a.exportValue ?? 'Yes';
        out.push({ ...base, type: 'check', exportValue: on, initial: !!a.fieldValue && a.fieldValue !== 'Off' });
      } else if (a.fieldType === 'Btn' && a.radioButton) {
        out.push({ ...base, type: 'radio', exportValue: String(a.buttonValue ?? ''), initial: a.fieldValue && a.fieldValue !== 'Off' ? String(a.fieldValue) : '' });
      } else if (a.fieldType === 'Ch') {
        const options = (a.options ?? []).map((o: any) => ({ v: String(o.exportValue ?? o.displayValue), label: String(o.displayValue ?? o.exportValue) }));
        const fv = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
        out.push({ ...base, type: 'choice', options, initial: fv ? String(fv) : '' });
      } else if (a.fieldType === 'Sig') {
        out.push({ ...base, type: 'sig', initial: '' });
      }
    }
  }
  return out;
}

export const fieldValue = (f: FormField, values: Record<string, string | boolean>) =>
  values[f.name] !== undefined ? values[f.name] : f.initial;

export const isFilled = (f: FormField, values: Record<string, string | boolean>) => {
  const v = fieldValue(f, values);
  return f.type === 'check' ? v === true : !!v;
};

export function FormLayer({ fields, values, zoom, interactive, active, onValue, onFocus, onSign }: {
  fields: FormField[]; values: Record<string, string | boolean>; zoom: number; interactive: boolean; active: string | null;
  onValue: (name: string, v: string | boolean) => void; onFocus: (id: string) => void; onSign: (f: FormField) => void;
}) {
  return (
    <>
      {fields.map((f) => {
        const v = fieldValue(f, values);
        const st: React.CSSProperties = { left: f.x * zoom, top: f.y * zoom, width: f.w * zoom, height: f.h * zoom };
        const passive = !interactive || f.readOnly;
        const tint = passive ? { background: 'transparent', borderBottomColor: 'transparent', pointerEvents: 'none' as const } : undefined;
        const fs = (f.fontSize || Math.max(6, Math.min(f.multiline ? 11 : f.h * 0.62, 13))) * zoom;
        const common = { 'data-field': f.id, onFocus: () => onFocus(f.id), className: `ff${active === f.id ? ' active' : ''}` };
        if (f.type === 'text') {
          const props = {
            ...common, value: String(v ?? ''), readOnly: f.readOnly, maxLength: f.maxLen, spellCheck: false, 'aria-label': f.label,
            onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onValue(f.name, e.target.value),
            onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
            onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
            style: { ...st, fontSize: fs, textAlign: (['left', 'center', 'right'] as const)[f.align ?? 0], ...tint },
          };
          return f.multiline ? <textarea key={f.id} {...props} /> : <input key={f.id} {...props} />;
        }
        if (f.type === 'choice') {
          return (
            <select key={f.id} {...common} value={String(v ?? '')} aria-label={f.label} disabled={f.readOnly}
              onPointerDown={(e) => e.stopPropagation()} onChange={(e) => onValue(f.name, e.target.value)}
              style={{ ...st, fontSize: fs, ...tint }}>
              <option value="">{''}</option>
              {f.options?.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          );
        }
        if (f.type === 'check' || f.type === 'radio') {
          const on = f.type === 'check' ? v === true : v === f.exportValue && !!v;
          const s = Math.min(f.w, f.h) * zoom;
          return (
            <button key={f.id} type="button" {...common} className={`ffbox${f.type === 'radio' ? ' radio' : ''}${on ? ' on' : ''}`}
              role={f.type === 'radio' ? 'radio' : 'checkbox'} aria-checked={on} aria-label={f.label}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onValue(f.name, f.type === 'check' ? !on : (on ? '' : f.exportValue!))}
              style={{ ...st, ...(passive ? { background: 'transparent', borderColor: 'transparent', pointerEvents: 'none' } : null) }}>
              {on && (f.type === 'check'
                ? <Icon name="check" size={s * 0.8} />
                : <span style={{ width: s * 0.5, height: s * 0.5, borderRadius: '50%', background: '#1E2559' }} />)}
            </button>
          );
        }
        if (passive) return null;
        return (
          <button key={f.id} type="button" {...common} className="ffsig" style={st} onPointerDown={(e) => e.stopPropagation()} onClick={() => onSign(f)}>
            <Icon name="signature" size={Math.min(16 * zoom, f.h * zoom * 0.6)} /><span>Tap to sign</span>
          </button>
        );
      })}
    </>
  );
}
