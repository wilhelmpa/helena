/**
 * Money, IBAN and date primitives shared by every parser. Amounts are integer cents and dates are
 * 'YYYY-MM-DD' strings throughout the package, so nothing here ever returns a float amount.
 */

export type AmountStyle = 'de' | 'en' | 'auto';
export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/**
 * Parses a money amount into integer cents. `style` says which character is the decimal
 * separator ('de' = comma, 'en' = point); 'auto' decides per value. Signs may lead or trail
 * ("9,90-"), parentheses mean negative, currency codes and symbols are ignored. Returns null
 * when the text is not an amount.
 */
export function parseAmountCents(text: string, style: AmountStyle = 'auto'): number | null {
  let s = text.trim();
  if (!s) return null;
  s = s.replace(/euro?|usd|chf|gbp|[€$£]/gi, '');
  s = s.replace(/[\s\u00a0\u202f'\u2019]/g, '');
  // "12,-" is German shorthand for a whole amount, not a trailing minus.
  s = s.replace(/[.,][-\u2013\u2014]$/, '');
  s = s.replace(/[\u2212\u2013]/g, '-');
  let negative = false;
  const parens = /^\((.*)\)$/.exec(s);
  if (parens) {
    negative = true;
    s = parens[1] ?? '';
  }
  const lead = /^[+-]/.exec(s);
  const trail = /[+-]$/.exec(s);
  if (lead && trail) return null;
  if (lead) {
    negative = negative || lead[0] === '-';
    s = s.slice(1);
  } else if (trail) {
    negative = negative || trail[0] === '-';
    s = s.slice(0, -1);
  }
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s) || /[.,]$/.test(s)) return null;

  const decimal = decimalSeparator(s, style);
  if (decimal === undefined) return null;
  let intPart = s;
  let fraction = '';
  if (decimal) {
    const at = s.lastIndexOf(decimal);
    intPart = s.slice(0, at);
    fraction = s.slice(at + 1);
    if (!/^\d+$/.test(fraction)) return null;
  }
  // Whatever separators remain in the integer part are thousands separators in groups of three.
  if (/[.,]/.test(intPart) && !/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null;
  const digits = intPart.replace(/[.,]/g, '');
  if (digits !== '' && !/^\d+$/.test(digits)) return null;
  let cents = Number(digits || '0') * 100 + Number((fraction + '00').slice(0, 2));
  if (Number((fraction + '000')[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** Returns the decimal separator, null for "no decimals", or undefined for an invalid value. */
function decimalSeparator(s: string, style: AmountStyle): ',' | '.' | null | undefined {
  const commas = s.split(',').length - 1;
  const dots = s.split('.').length - 1;
  const digitsAfter = (sep: string) => s.length - s.lastIndexOf(sep) - 1;
  const leadingZero = (sep: string) => /^0?$/.test(s.slice(0, s.indexOf(sep)));
  if (style === 'de') {
    if (commas > 1) return undefined;
    if (commas === 1) return s.lastIndexOf('.') > s.lastIndexOf(',') ? undefined : ',';
    return dots === 1 && digitsAfter('.') !== 3 ? '.' : null;
  }
  if (style === 'en') {
    if (dots > 1) return undefined;
    if (dots === 1) return s.lastIndexOf(',') > s.lastIndexOf('.') ? undefined : '.';
    return commas === 1 && digitsAfter(',') !== 3 ? ',' : null;
  }
  if (commas && dots) return s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
  for (const sep of [',', '.'] as const) {
    const count = sep === ',' ? commas : dots;
    if (!count) continue;
    // One separator followed by exactly three digits reads as thousands ("1.234", "1,234"),
    // unless the integer part is a lone zero ("0,125").
    if (count === 1 && (digitsAfter(sep) !== 3 || leadingZero(sep))) return sep;
    return null;
  }
  return null;
}

/** Formats cents the German way: "1.234,56", "-49,95". */
export function formatAmountDe(cents: number): string {
  const rounded = Math.round(cents);
  const abs = Math.abs(rounded);
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${rounded < 0 ? '-' : ''}${euros},${String(abs % 100).padStart(2, '0')}`;
}

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MR: 27,
  MT: 31,
  MU: 30,
  NL: 18,
  NO: 15,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  SA: 24,
  SC: 31,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
};

function ibanChecksumOk(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const code = char.charCodeAt(0);
    const value = code >= 65 ? String(code - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Strips spaces, upper-cases and validates length and the mod-97 check digits. */
export function normalizeIban(text: string): string | null {
  const iban = text
    .replace(/[\s\u00a0-]/g, '')
    .toUpperCase()
    .replace(/^IBAN:?/, '');
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const expected = IBAN_LENGTHS[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return null;
  return ibanChecksumOk(iban) ? iban : null;
}

/**
 * Finds valid IBANs in free text, also when they are printed in groups of four. Candidates are
 * cut at the country's IBAN length (or tried from 34 down to 15 characters for unknown
 * countries) and only accepted at a group boundary, so a trailing BIC or number is not glued on.
 */
export function findIbans(text: string): string[] {
  const upper = text.toUpperCase();
  const found: string[] = [];
  const start = /(?<![A-Z0-9])[A-Z]{2}\d{2}/g;
  for (let match = start.exec(upper); match; match = start.exec(upper)) {
    const chars: { char: string; spaceBefore: boolean }[] = [];
    let spaceBefore = false;
    for (let i = match.index; i < upper.length && chars.length < 35; i++) {
      const char = upper[i] ?? '';
      if (/[A-Z0-9]/.test(char)) {
        chars.push({ char, spaceBefore });
        spaceBefore = false;
      } else if (char === ' ' && !spaceBefore && chars.length) {
        spaceBefore = true;
      } else break;
    }
    const known = IBAN_LENGTHS[match[0].slice(0, 2)];
    const lengths = known ? [known] : range(Math.min(34, chars.length), 15);
    for (const length of lengths) {
      if (chars.length < length) continue;
      const next = chars[length];
      if (next && !next.spaceBefore) continue;
      const iban = normalizeIban(
        chars
          .slice(0, length)
          .map((c) => c.char)
          .join(''),
      );
      if (iban) {
        if (!found.includes(iban)) found.push(iban);
        break;
      }
    }
  }
  return found;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = from; n >= to; n--) out.push(n);
  return out;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  januar: 1,
  january: 1,
  jaenner: 1,
  feb: 2,
  februar: 2,
  february: 2,
  maer: 3,
  mrz: 3,
  maerz: 3,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dezember: 12,
  dec: 12,
  december: 12,
};

/**
 * Parses the usual date spellings into 'YYYY-MM-DD': dd.mm.yy(yy), d.M.yyyy, yyyy-mm-dd (also
 * with a time), mm/dd/yyyy, YYYYMMDD (UN/CEFACT format 102) and "24. September 2026". `order`
 * decides ambiguous numeric dates; without it dots and dashes read day first and slashes month
 * first. Two-digit years are 20yy. Returns null for anything that is not a real calendar date.
 */
export function parseDateAny(text: string, order?: DateOrder): string | null {
  const s = text.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return makeDate(m[1], m[2], m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return makeDate(m[1], m[2], m[3]);
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?:[ T,].*)?$/.exec(s);
  if (m) {
    const [a, sep, b, y] = [Number(m[1]), m[2], Number(m[3]), m[4] ?? ''];
    const monthFirst = order === 'mdy' || (order !== 'dmy' && sep === '/' && a <= 12);
    const [day, month] = monthFirst ? [b, a] : [a, b];
    return makeDate(y, month, day) ?? makeDate(y, day, month);
  }
  const words = s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  m = /^(\d{1,2})\.?[\s-]*([a-z]+)\.?[\s-]*(\d{4}|\d{2})$/.exec(words);
  if (m && MONTHS[m[2] ?? ''] !== undefined) return makeDate(m[3], MONTHS[m[2] ?? ''], m[1]);
  m = /^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(words);
  if (m && MONTHS[m[1] ?? ''] !== undefined) return makeDate(m[3], MONTHS[m[1] ?? ''], m[2]);
  return null;
}

function makeDate(
  year: string | number | undefined,
  month: string | number | undefined,
  day: string | number | undefined,
): string | null {
  let y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (![y, mo, d].every(Number.isInteger)) return null;
  if (String(year).length === 2) y += 2000;
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;

/** Adds whole days to a 'YYYY-MM-DD' date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** Days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
