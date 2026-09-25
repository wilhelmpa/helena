/**
 * Company name comparison for matching receipts to payments. Bank statements truncate, upper-case
 * and reorder names ("MUSTERMANN SOFTWARE ENTWICKL"), so names are compared as token sets after
 * dropping legal forms and punctuation, with typo and truncation tolerance per token.
 */

/** Legal forms that never carry identity and may appear anywhere in a name. */
const LEGAL_ANYWHERE = new Set([
  'gmbh',
  'mbh',
  'kgaa',
  'ohg',
  'gbr',
  'ltd',
  'llc',
  'inc',
  'bv',
  'nv',
  'plc',
  'sarl',
  'srl',
  'spa',
  'sas',
  'limited',
  'corp',
  'haftungsbeschraenkt',
  'partg',
  'eg',
]);
/** Short legal forms that could also be words, so they are only dropped at the end of a name. */
const LEGAL_TRAILING = new Set([
  'ag',
  'se',
  'kg',
  'ug',
  'sa',
  'as',
  'ab',
  'oy',
  'co',
  'ek',
  'ev',
  'cie',
  'sca',
]);
const STOP_WORDS = new Set(['und', 'and', 'the', 'of', 'der', 'die', 'das', 'et']);

export function transliterate(text: string): string {
  return text
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Lower-case name tokens without legal forms, punctuation and filler words. */
export function nameTokens(name: string): string[] {
  const cleaned = transliterate(name.toLowerCase())
    .replace(/\bs\.?\s?a\.?\s?r\.?\s?l\.?(?=\s|$|,)/g, ' sarl ')
    .replace(/&\s*co\.?(\s*kg(aa)?)?/g, ' ')
    .replace(/\be\.\s?(k|v)\.?(?=\s|$|,)/g, ' ')
    .replace(/gesellschaft mit beschraenkter haftung/g, ' ')
    .replace(/['.\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
  const tokens = cleaned
    .split(' ')
    .filter((t) => t && !LEGAL_ANYWHERE.has(t) && !STOP_WORDS.has(t));
  while (tokens.length > 1 && LEGAL_TRAILING.has(tokens[tokens.length - 1] ?? '')) tokens.pop();
  return tokens;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a.slice(0, 120), b.slice(0, 120)) / Math.min(max, 120);
}

/** Token similarity: exact 1, a truncated prefix of at least 4 letters 0.95, a near typo its ratio. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.95;
  const r = ratio(a, b);
  // Unrelated tokens get no partial credit, or "Stadtwerke A" would look like "Stadtwerke B".
  return r >= 0.8 ? r : 0;
}

/**
 * Token-set similarity of two company names, 0..1. The score weighs how well the shorter name is
 * covered (0.7) and how much of the longer name is explained (0.3), and falls back to the ratio of
 * the concatenated tokens for names written together ("TELEKOMDEUTSCHLAND").
 */
export function nameSimilarity(a: string, b: string): number {
  const ta = [...new Set(nameTokens(a))];
  const tb = [...new Set(nameTokens(b))];
  if (!ta.length || !tb.length) return 0;
  const [small, large] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const best = (from: string[], to: string[]) =>
    from.reduce((sum, t) => sum + Math.max(...to.map((u) => tokenSimilarity(t, u))), 0) /
    from.length;
  const tokenScore = 0.7 * best(small, large) + 0.3 * best(large, small);
  const joinedScore = ratio(ta.join(''), tb.join(''));
  return Math.round(Math.max(tokenScore, joinedScore) * 1000) / 1000;
}

/**
 * How well a name appears inside free text such as a purpose line: 'full' when every name token
 * is present, 'partial' when at least half of them (and one long token) are, otherwise null.
 */
export function nameInText(name: string, text: string): 'full' | 'partial' | null {
  const tokens = [...new Set(nameTokens(name))];
  if (!tokens.length) return null;
  const textTokens = new Set(nameTokens(text));
  const joinedText = [...textTokens].join('');
  const joinedName = tokens.join('');
  if (joinedName.length >= 5 && joinedText.includes(joinedName) && tokens.length > 1) return 'full';
  const hits = tokens.filter(
    (t) => textTokens.has(t) || [...textTokens].some((u) => tokenSimilarity(t, u) >= 0.9),
  );
  if (hits.length === tokens.length && hits.some((t) => t.length >= 3)) return 'full';
  if (hits.length * 2 >= tokens.length && hits.some((t) => t.length >= 4)) return 'partial';
  return null;
}

const INTERMEDIARIES = [
  'paypal',
  'klarna',
  'sofort',
  'stripe',
  'adyen',
  'mollie',
  'sumup',
  'amazon payments',
  'amazon pay',
  'unzer',
  'heidelpay',
  'payone',
  'concardis',
  'nexi',
  'worldline',
  'computop',
  'ratepay',
  'afterpay',
  'riverty',
  'checkout com',
  'braintree',
  'gocardless',
  'paddle',
  'fastspring',
  '2checkout',
  'lemon squeezy',
  'mangopay',
  'trustly',
  'ppro',
  'wirecard',
  'secupay',
  'billie',
  'mondu',
  'zettle',
  'shopify payments',
  'paysafe',
  'skrill',
  'vr payment',
  'apple pay',
  'google pay',
  'square',
];
const INTERMEDIARY_PATTERN = new RegExp(`\\b(${INTERMEDIARIES.join('|')})\\b`);

/** True for payment service providers that stand between the payer and the real merchant. */
export function isPaymentIntermediary(name: string): boolean {
  const normalized = transliterate(name.toLowerCase())
    .replace(/['.\u2019]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ');
  return INTERMEDIARY_PATTERN.test(normalized);
}
