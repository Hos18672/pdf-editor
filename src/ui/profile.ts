// "My details": the user's own data, kept on this device only, that fills in forms by itself.
// Fields are recognised by their names, tooltips and the label printed next to them (German and English).
import { getLang } from './i18n';

export type Key = 'first' | 'last' | 'birth' | 'birthPlace' | 'nationality' | 'street' | 'zip' | 'city' | 'country' | 'phone' | 'email' | 'iban' | 'bic' | 'svnr';
export type Profile = Partial<Record<Key, string>>;
/** what a field asks for: a profile value, or one made from several (and today's date) */
export type Want = Key | 'fullname' | 'zipcity' | 'placedate' | 'date';

/** the form's fields in the order they are shown: key, label, example, input type */
export const PROFILE_FIELDS: [Key, string, string, string][] = [
  ['first', 'First name', 'Maria', 'text'],
  ['last', 'Last name', 'Muster', 'text'],
  ['birth', 'Date of birth', '24.05.1990', 'text'],
  ['birthPlace', 'Place of birth', 'Wien', 'text'],
  ['nationality', 'Nationality', 'Österreich', 'text'],
  ['street', 'Street and number', 'Hauptstraße 1/4', 'text'],
  ['zip', 'Postcode', '1010', 'text'],
  ['city', 'City', 'Wien', 'text'],
  ['country', 'Country', 'Österreich', 'text'],
  ['phone', 'Phone', '+43 660 1234567', 'tel'],
  ['email', 'E-mail', 'maria@example.at', 'email'],
  ['iban', 'IBAN', 'AT61 1904 3002 3457 3201', 'text'],
  ['bic', 'BIC', 'BKAUATWW', 'text'],
  ['svnr', 'Social security number', '1234 240590', 'text'],
];

const STORE = 'pe.profile';
export const loadProfile = (): Profile => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') ?? {}; } catch { return {}; } };
export const saveProfile = (p: Profile) => {
  const clean: Profile = {};
  for (const [k] of PROFILE_FIELDS) { const v = p[k]?.trim(); if (v) clean[k] = v; }
  try { if (Object.keys(clean).length) localStorage.setItem(STORE, JSON.stringify(clean)); else localStorage.removeItem(STORE); } catch { /* storage unavailable */ }
  return clean;
};
export const hasProfile = (p = loadProfile()) => Object.values(p).some((v) => !!v?.trim());

/** a name or label as plain words: lower case, umlauts spelled out, camelCase and separators split */
export function fold(s: string): string {
  return ' ' + s.replace(/([a-zäöü])([A-ZÄÖÜ])/g, '$1 $2').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}

const RULES: [Want, RegExp][] = [
  ['placedate', / ort (und |, )?datum | place (and )?date | ortdatum /],
  ['birth', /geburtsdatum|geb ?datum|geburtstag|date of birth|dateofbirth|birth ?date| geboren am | dob | geb /],
  ['birthPlace', /geburtsort|place of birth|birth ?place/],
  ['nationality', /staatsangehoerigkeit|staatsbuergerschaft|nationalit|citizenship/],
  ['svnr', /svnr|sv nr|sozialversicherungs ?nummer|versicherungs ?nummer|social security/],
  ['iban', / iban /],
  ['bic', / bic | swift/],
  ['email', / e ?mail|email/],
  ['phone', /telefon| tel | phone|mobil|handy/],
  ['zipcity', / plz (und |, )?ort | postleitzahl (und )?ort | zip (code )?(and )?city /],
  ['zip', / plz |postleitzahl| zip |post ?code|postal ?code/],
  ['street', /strasse| str | anschrift|adresse|street|address/],
  ['city', / ort | wohnort|wohnhaft in| stadt | city | town |gemeinde/],
  ['country', / land | staat | country /],
  ['first', /vorname|first ?name|given ?name|forename|prenom/],
  ['last', /nachname|familienname|zuname|last ?name|surname|family ?name/],
  ['fullname', /^ (name|vor ?und ?(zu|nach)name|name vorname|vorname name|vollstaendiger name|full name|your name|ihr name|antragsteller ?in|name des antragstellers) $/],
  ['date', /^ (datum|date|heute|today) $/],
];

/** what a field or printed label asks for (null: nothing from the profile) */
export function wantOf(...texts: (string | undefined | null)[]): Want | null {
  for (const raw of texts) {
    if (!raw) continue;
    const s = fold(raw);
    if (s.length > 48) continue; // a sentence, not a label
    for (const [w, re] of RULES) if (re.test(s)) return w;
  }
  return null;
}

const today = () => new Date().toLocaleDateString(getLang() === 'de' ? 'de-AT' : undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** the value for a field (fitted to a fixed number of letters when the field has one) */
export function valueFor(p: Profile, w: Want, maxLen?: number): string | null {
  let v: string | null | undefined;
  switch (w) {
    case 'fullname': v = [p.first, p.last].filter(Boolean).join(' ') || null; break;
    case 'zipcity': v = [p.zip, p.city].filter(Boolean).join(' ') || null; break;
    case 'placedate': v = p.city ? `${p.city}, ${today()}` : today(); break;
    case 'date': v = today(); break;
    default: v = p[w];
  }
  if (!v) return null;
  if (maxLen && v.length > maxLen) {
    // boxes for each letter: numbers without spaces and dots
    const tight = v.replace(/[\s./-]+/g, '');
    v = tight.length <= maxLen ? tight : v.slice(0, maxLen);
  }
  return v;
}

/** a printed label followed by room to write: "Vorname:", "Geburtsdatum ........", "PLZ/Ort ____" */
export function labelLine(text: string): { want: Want; at: number } | null {
  const m = /^\s*([^:：._…]{2,40}?)\s*([:：]\s*|\s*[._…]{3,}\s*|\s*_{2,}\s*)+$/.exec(text);
  if (!m) return null;
  const want = wantOf(m[1]);
  if (!want) return null;
  // where the writing goes: on the dots / line, else after the label
  const restAt = text.indexOf(m[1]) + m[1].length;
  const dots = text.slice(restAt).search(/[._…]{2,}/);
  return { want, at: dots >= 0 ? restAt + dots : text.length };
}
