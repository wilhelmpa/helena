export interface PronunciationEntry {
  word: string;
  pronunciation: string;
}

const ONES = [
  'null',
  'eins',
  'zwei',
  'drei',
  'vier',
  'fünf',
  'sechs',
  'sieben',
  'acht',
  'neun',
  'zehn',
  'elf',
  'zwölf',
  'dreizehn',
  'vierzehn',
  'fünfzehn',
  'sechzehn',
  'siebzehn',
  'achtzehn',
  'neunzehn',
];
const TENS = [
  '',
  '',
  'zwanzig',
  'dreißig',
  'vierzig',
  'fünfzig',
  'sechzig',
  'siebzig',
  'achtzig',
  'neunzig',
];
const MONTHS = [
  '',
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const ORDINALS = [
  '',
  'erste',
  'zweite',
  'dritte',
  'vierte',
  'fünfte',
  'sechste',
  'siebte',
  'achte',
  'neunte',
  'zehnte',
  'elfte',
  'zwölfte',
  'dreizehnte',
  'vierzehnte',
  'fünfzehnte',
  'sechzehnte',
  'siebzehnte',
  'achtzehnte',
  'neunzehnte',
];

function underThousand(value: number): string {
  if (value < 20) return ONES[value]!;
  if (value < 100) {
    const ones = value % 10;
    return `${ones ? `${ones === 1 ? 'ein' : ONES[ones]}und` : ''}${TENS[Math.floor(value / 10)]}`;
  }
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  return `${hundreds === 1 ? 'ein' : ONES[hundreds]}hundert${rest ? underThousand(rest) : ''}`;
}

export function germanNumber(value: number): string {
  if (!Number.isSafeInteger(value)) return String(value);
  if (value < 0) return `minus ${germanNumber(-value)}`;
  if (value < 1000) return underThousand(value);
  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const rest = value % 1000;
    return `${thousands === 1 ? 'ein' : germanNumber(thousands)}tausend${rest ? underThousand(rest) : ''}`;
  }
  if (value < 1_000_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const rest = value % 1_000_000;
    return `${millions === 1 ? 'eine Million' : `${germanNumber(millions)} Millionen`}${rest ? ` ${germanNumber(rest)}` : ''}`;
  }
  return String(value);
}

function decimal(raw: string): string {
  const [whole, fraction] = raw.replace(/\./g, '').split(',');
  const spoken = germanNumber(Number(whole));
  return fraction
    ? `${spoken} Komma ${[...fraction].map((digit) => ONES[Number(digit)]).join(' ')}`
    : spoken;
}

const UNITS: Record<string, string> = {
  km: 'Kilometer',
  cm: 'Zentimeter',
  mm: 'Millimeter',
  kg: 'Kilogramm',
  mg: 'Milligramm',
  GB: 'Gigabyte',
  MB: 'Megabyte',
  ms: 'Millisekunden',
  kWh: 'Kilowattstunden',
};

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bz\.\s?B\./giu, 'zum Beispiel'],
  [/\bd\.\s?h\./giu, 'das heißt'],
  [/\bca\./giu, 'circa'],
  [/\bbzw\./giu, 'beziehungsweise'],
  [/\busw\./giu, 'und so weiter'],
  [/\bggf\./giu, 'gegebenenfalls'],
  [/\bKI\b/gu, 'künstliche Intelligenz'],
  [/\bAPI\b/gu, 'A P I'],
  [/\bGmbH\b/gu, 'Gesellschaft mit beschränkter Haftung'],
];

// Qwen's German language setting has no documented inline language tags or phoneme input.
// These spellings are editable approximations until a measured bilingual voice is available.
export const DEFAULT_PRONUNCIATIONS: PronunciationEntry[] = [
  ['Claude', 'Klohd'],
  ['Codex', 'Kohdeks'],
  ['Deploy', 'Dihploi'],
  ['Update', 'Apdeit'],
  ['Release', 'Riliis'],
  ['Browser', 'Brauser'],
  ['Dashboard', 'Däschbord'],
  ['Meeting', 'Miiting'],
  ['Feedback', 'Fiidbäck'],
  ['Workflow', 'Wörkflo'],
  ['Pull Request', 'Pull Rikwäst'],
  ['GitHub', 'Gitt Hab'],
  ['OpenAI', 'Open Ey Ei'],
  ['Cloudflare', 'Klaudflär'],
  ['Paperclip', 'Peiperklipp'],
  ['Paper Trading', 'Peiper Treiding'],
  ['Heartbeat', 'Hartbiit'],
].map(([word, pronunciation]) => ({ word: word!, pronunciation: pronunciation! }));

function pronunciation(text: string, entries: PronunciationEntry[]): string {
  const lookup = new Map<string, PronunciationEntry>();
  for (const entry of [...DEFAULT_PRONUNCIATIONS, ...entries]) {
    lookup.set(entry.word.toLocaleLowerCase('de-DE'), entry);
  }
  const terms = [...lookup.keys()].sort((a, b) => b.length - a.length);
  if (!terms.length) return text;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.replace(
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'giu'),
    (term) => lookup.get(term.toLocaleLowerCase('de-DE'))?.pronunciation ?? term,
  );
}

export function ttsText(raw: string, entries: PronunciationEntry[] = []): string {
  let text = raw
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)]+/gi, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, ' ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu, ' ')
    .replace(/\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g, '$1 $2')
    .replace(/\s?(?:→|->|=>)\s?/g, ', ');

  text = text.replace(
    /\b(am\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})\b/gi,
    (match, am, day, month, year) => {
      const name = MONTHS[Number(month)];
      if (!name || Number(day) < 1 || Number(day) > 31) return match;
      const ordinal = ORDINALS[Number(day)] ?? `${germanNumber(Number(day))}ste`;
      return `${am ?? ''}${ordinal}${am ? 'n' : 'r'} ${name} ${germanNumber(Number(year))}`;
    },
  );
  text = text.replace(/\b(\d{1,2}):(\d{2})\b/g, (match, hours, minutes) =>
    Number(hours) < 24 && Number(minutes) < 60
      ? `${germanNumber(Number(hours))} Uhr${Number(minutes) ? ` ${germanNumber(Number(minutes))}` : ''}`
      : match,
  );
  text = text.replace(/\b(\d+(?:\.\d{3})*(?:,\d{1,2})?)\s?€/g, (_match, amount: string) => {
    const [whole, cents = ''] = amount.replace(/\./g, '').split(',');
    return `${germanNumber(Number(whole))} Euro${Number(cents) ? ` und ${germanNumber(Number(cents.padEnd(2, '0')))} Cent` : ''}`;
  });
  for (const [pattern, replacement] of ABBREVIATIONS) text = text.replace(pattern, replacement);
  text = text.replace(
    /\b(\d+(?:\.\d{3})*(?:,\d+)?)\s?%/g,
    (_match, amount: string) => `${decimal(amount)} Prozent`,
  );
  text = text.replace(
    /\b(\d+(?:\.\d{3})*(?:,\d+)?)\s?(km|cm|mm|kg|mg|GB|MB|ms|kWh)\b/g,
    (_match, amount: string, unit: string) => `${decimal(amount)} ${UNITS[unit]}`,
  );
  text = text.replace(/(?<![\p{L}\p{N}])\d+(?:\.\d{3})*(?:,\d+)?(?![\p{L}\p{N}])/gu, decimal);
  text = pronunciation(text, entries);
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}
