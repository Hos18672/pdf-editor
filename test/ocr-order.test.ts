import { readingOrder } from '../src/ui/ocr';
import { fixBrackets } from '../src/ui/bidiWords';
const W = (s: string) => s.split(' ').map((text) => ({ text }));   // words as printed, left to right
const j = (ws: { text: string }[], r?: boolean) => readingOrder(ws, r).map((w) => w.text).join(' ');
const cases: [string, string, boolean | undefined][] = [
  ['ورود هر تاریخ از بعد روز ۲۱', '۲۱ روز بعد از تاریخ هر ورود', false],
  ['Applicant Name ( خانوادگی نام و نام )', 'Applicant Name ( نام و نام خانوادگی )', false],
  ['Twice (دوبار)', 'Twice (دوبار)', false],
  ['۱۴۰۵/۱۱/۱۳ تا ۱۴۰۵/۰۸/۱۴ از', 'از ۱۴۰۵/۰۸/۱۴ تا ۱۴۰۵/۱۱/۱۳', false],
  ['Paginka برنامه از', 'از برنامه Paginka', true],
  ['Paginka برنامه از استفاده با', 'با استفاده از برنامه Paginka', false],
  ['Passport Number ( گذرنامه شماره )', 'Passport Number ( شماره گذرنامه )', false],
  ['REZA HOSSAINI', 'REZA HOSSAINI', false],
  ['Visa Issue Date ( روادید صدور تاریخ ) 2026', 'Visa Issue Date ( تاریخ صدور روادید ) 2026', false],
];
let f = 0;
for (const [vis, want, r] of cases) { const got = j(W(vis), r); if (got !== want) { f++; console.log('FAIL', vis, '→', got, '| want', want); } }
console.log(cases.length - f, 'passed', f, 'failed');

// brackets next to Persian words come back from the reader mirrored
{
  const eq = (a: string, b: string) => { if (a !== b) { console.error('FAIL', JSON.stringify(a), '!=', JSON.stringify(b)); process.exit(1); } else console.log('ok', b); };
  eq(fixBrackets('Name ) نام ('), 'Name ( نام )');
  eq(fixBrackets('Name ( نام )'), 'Name ( نام )');
  eq(fixBrackets('a ) b'), 'a ) b');
  eq(fixBrackets('Visa Issue Date ) تاریخ )'), 'Visa Issue Date ( تاریخ )');
  eq(fixBrackets('Track Code ( کد ('), 'Track Code ( کد )');
}
