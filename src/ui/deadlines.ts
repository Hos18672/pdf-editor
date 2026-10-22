// Dates in a letter: deadlines ("bis 15.11.2026", "innerhalb von 14 Tagen"), appointments
// ("Termin am 3. Dezember 2026 um 9:30 Uhr") and other future dates. German and English.

export type DateKind = 'deadline' | 'appointment' | 'date';
export interface Found {
  date: Date; // local midnight, or the time of an appointment
  time: string | null; // "09:30"
  kind: DateKind;
  snippet: string;
  page: number;
  /** "14 days after the letter date" when worked out from a period */
  from: string | null;
}

const MONTHS: [RegExp, number][] = [
  [/^(jänner|jaenner|januar|january|jan)/, 0], [/^(februar|feber|february|feb)/, 1], [/^(märz|maerz|march|mär|mar)/, 2],
  [/^(april|apr)/, 3], [/^(mai|may)/, 4], [/^(juni|june|jun)/, 5], [/^(juli|july|jul)/, 6], [/^(august|aug)/, 7],
  [/^(september|sept|sep)/, 8], [/^(oktober|october|okt|oct)/, 9], [/^(november|nov)/, 10], [/^(dezember|december|dez|dec)/, 11],
];
const monthOf = (s: string) => { const t = s.toLowerCase(); for (const [re, m] of MONTHS) if (re.test(t)) return m; return -1; };
const MONTH_RE = '(?:jänner|jaenner|januar|january|jan|februar|feber|february|feb|märz|maerz|march|mär|mar|april|apr|mai|may|juni|june|jun|juli|july|jul|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|dezember|december|dez|dec)\\.?';
const NUMS: Record<string, number> = {
  ein: 1, eine: 1, einer: 1, eines: 1, einem: 1, one: 1, a: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, fuenf: 5, five: 5,
  sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8, neun: 9, nine: 9, zehn: 10, ten: 10, vierzehn: 14, fourteen: 14, dreißig: 30, dreissig: 30, thirty: 30,
};

const DATE_PATTERNS: { re: RegExp; get: (m: RegExpExecArray) => [number, number, number] | null }[] = [
  // 15.11.2026, 15. 11. 2026, 15.11.26
  { re: /\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})\b/g, get: (m) => [+m[1], +m[2] - 1, year(m[3])] },
  // 2026-11-15
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, get: (m) => [+m[3], +m[2] - 1, +m[1]] },
  // 15/11/2026
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, get: (m) => [+m[1], +m[2] - 1, +m[3]] },
  // 15. November 2026, 15 Nov 2026
  { re: new RegExp(`\\b(\\d{1,2})\\.?\\s+(${MONTH_RE})\\s+(\\d{4})\\b`, 'gi'), get: (m) => [+m[1], monthOf(m[2]), +m[3]] },
  // November 15, 2026
  { re: new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'gi'), get: (m) => [+m[2], monthOf(m[1]), +m[3]] },
];
function year(s: string) { const y = +s; return s.length === 2 ? 2000 + y : y; }

const DEADLINE = /(bis\s+(?:zum\s+|spätestens\s+)?|spätestens|spaetestens|frist|fällig|faellig|zahlbar|einzuzahlen|einzureichen|vorzulegen|nachzureichen|einlangen|until|by|due|deadline|no later than|before|not later than)[^.\n]{0,30}$/i;
const APPT = /(termin|vorsprache|vorzusprechen|erscheinen|vorladung|einladung|appointment|interview|meeting|hearing|untersuchung|ordination)[^\n]{0,60}$/i;
const TIME_AFTER = /^[^\n]{0,24}?(?:um|at|,)?\s*(\d{1,2})[:.](\d{2})\s*(?:uhr|h|am|pm)?|^[^\n]{0,24}?\bum\s+(\d{1,2})\s*uhr/i;
const PERIOD = /\b(innerhalb|binnen|within)\s+(?:von\s+|der\s+nächsten\s+|of\s+)?(\d{1,3}|[a-zäöüß]+)\s+(werktag(?:en|e)?|tag(?:en|e)?|woche(?:n)?|monat(?:en|e)?|business days?|days?|weeks?|months?)/gi;
const FROM_RECEIPT = /(ab|nach|from|after|of)\s+(erhalt|zustellung|empfang|receipt|receiving|delivery)/i;

function snippetAt(text: string, s: number, e: number) {
  const a = Math.max(0, text.lastIndexOf('\n', s - 1) + 1, s - 110), b = Math.min(text.length, (text.indexOf('\n', e) + 1 || text.length + 1) - 1, e + 90);
  return (a > 0 && text[a - 1] !== '\n' ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ').trim() + (b < text.length && text[b] !== '\n' ? '…' : '');
}

function addPeriod(base: Date, n: number, unit: string) {
  const d = new Date(base);
  const u = unit.toLowerCase();
  if (u.startsWith('woche') || u.startsWith('week')) d.setDate(d.getDate() + n * 7);
  else if (u.startsWith('monat') || u.startsWith('month')) d.setMonth(d.getMonth() + n);
  else if (u.startsWith('werktag') || u.startsWith('business')) { let k = n; while (k > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) k--; } }
  else d.setDate(d.getDate() + n);
  return d;
}

/** All dates worth putting in a calendar, earliest first. `pages`: the text of each page. */
export function findDates(pages: string[], today = new Date()): Found[] {
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const out: Found[] = [];
  let letterDate: Date | null = null;
  pages.forEach((text, page) => {
    for (const p of DATE_PATTERNS) {
      p.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = p.re.exec(text))) {
        const v = p.get(m);
        if (!v) continue;
        const [d, mo, y] = v;
        if (mo < 0 || mo > 11 || d < 1 || d > 31 || y < 1990 || y > 2100) continue;
        const date = new Date(y, mo, d);
        if (date.getDate() !== d) continue;
        const before = text.slice(Math.max(0, m.index - 90), m.index);
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
        // the letter's own date: early on the first page, after a place name or "am"/"Datum"/"Date"
        if (!letterDate && page === 0 && m.index < text.length * 0.35 && /(wien|graz|linz|salzburg|innsbruck|[a-zäöü]+,\s*(am\s*)?|datum:?|date:?|vom)\s*$/i.test(before.slice(-30))) { letterDate = date; continue; }
        if (/(geb(oren|\.)|geburtsdatum|date of birth|born|ausgestellt|issued|seit|since)[^\n]{0,20}$/i.test(before)) continue;
        const tm = TIME_AFTER.exec(after);
        const hh = tm ? +(tm[1] ?? tm[3]) : NaN, mm = tm ? +(tm[2] ?? 0) : NaN;
        const time = tm && hh < 24 && mm < 60 ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : null;
        const kind: DateKind = DEADLINE.test(before) ? 'deadline' : APPT.test(before) || time ? 'appointment' : 'date';
        if (kind === 'date' && date < t0) continue;
        const at = new Date(date);
        if (time) at.setHours(hh, mm);
        out.push({ date: at, time, kind, snippet: snippetAt(text, m.index, m.index + m[0].length), page, from: null });
      }
    }
  });
  // periods ("innerhalb von 14 Tagen"): from the letter date, or from today when counted from receipt
  pages.forEach((text, page) => {
    PERIOD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PERIOD.exec(text))) {
      const n = /^\d+$/.test(m[2]) ? +m[2] : NUMS[m[2].toLowerCase()];
      if (!n || n > 400) continue;
      const near = text.slice(m.index, m.index + m[0].length + 60);
      const fromReceipt = FROM_RECEIPT.test(near) || !letterDate;
      const base = fromReceipt ? t0 : letterDate!;
      const date = addPeriod(base, n, m[3]);
      const baseText = fromReceipt ? 'today (when you received it)' : `the letter date (${letterDate!.toLocaleDateString()})`;
      const u = m[3].toLowerCase();
      const unit = u.startsWith('werktag') || u.startsWith('business') ? 'working days' : u.startsWith('woche') || u.startsWith('week') ? 'weeks' : u.startsWith('monat') || u.startsWith('month') ? 'months' : 'days';
      out.push({ date, time: null, kind: 'deadline', snippet: snippetAt(text, m.index, m.index + m[0].length), page, from: `${n} ${n === 1 ? unit.replace(/s$/, '') : unit} after ${baseText}` });
    }
  });
  // one entry per day and kind (a deadline beats a plain date)
  const rank = { deadline: 0, appointment: 1, date: 2 };
  out.sort((a, b) => a.date.getTime() - b.date.getTime() || rank[a.kind] - rank[b.kind]);
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = f.date.toDateString() + (f.kind === 'appointment' ? 'a' : '');
    const kd = f.date.toDateString();
    if (seen.has(k) || (f.kind === 'date' && seen.has(kd))) return false;
    seen.add(k); seen.add(kd);
    return true;
  });
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** a calendar file (.ics) with a reminder before each date */
export function toIcs(events: { title: string; date: Date; time: string | null; note: string; remindDays: number }[]): string {
  const now = new Date();
  const stamp = `${ymd(now)}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PDF Editor//Deadline finder//EN', 'CALSCALE:GREGORIAN'];
  events.forEach((e, i) => {
    const next = new Date(e.date); next.setDate(next.getDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:${stamp}-${i}@pdf-editor`, `DTSTAMP:${stamp}`);
    if (e.time) {
      const [h, m] = e.time.split(':');
      lines.push(`DTSTART:${ymd(e.date)}T${h}${m}00`, `DURATION:PT1H`);
    } else lines.push(`DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(next)}`);
    lines.push(`SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.note)}`);
    if (e.remindDays > 0) lines.push('BEGIN:VALARM', `TRIGGER:-P${e.remindDays}D`, 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, 'END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
