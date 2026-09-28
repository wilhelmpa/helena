import { join } from 'node:path';
import { readWav, whisperWav } from '../modules/voice/wav';

interface Case {
  id: string;
  text: string;
  terms: string[];
}

type Setting = 'baseline' | 'locale' | 'context';
const SETTINGS: Setting[] = ['baseline', 'locale', 'context'];

const units = [
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
const tens = [
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

function numberWord(number: number): string {
  if (number < 20) return units[number]!;
  if (number < 100) {
    const remainder = number % 10;
    return remainder
      ? `${remainder === 1 ? 'ein' : units[remainder]}und${tens[Math.floor(number / 10)]}`
      : tens[number / 10]!;
  }
  if (number < 1000) {
    const hundreds = Math.floor(number / 100);
    return `${hundreds === 1 ? 'ein' : units[hundreds]}hundert${number % 100 ? numberWord(number % 100) : ''}`;
  }
  const thousands = Math.floor(number / 1000);
  return `${thousands === 1 ? 'ein' : numberWord(thousands)}tausend${number % 1000 ? numberWord(number % 1000) : ''}`;
}

const numberWords = new Map<string, string>();
for (let number = 0; number < 1000; number += 1) {
  numberWords.set(numberWord(number), String(number));
}
numberWords.set('hundert', '100');
numberWords.set('tausend', '1000');
numberWords.set('ein', '1');
numberWords.set('eine', '1');
numberWords.set('einen', '1');
numberWords.set('einem', '1');
numberWords.set('einer', '1');
const ordinalStems = [
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
for (let number = 1; number <= 31; number += 1) {
  const stem = ordinalStems[number] ?? `${numberWord(number)}ste`;
  for (const ending of ['', 'n', 'r', 's', 'm'])
    numberWords.set(`${stem}${ending}`, String(number));
}

function numericWord(token: string): string | undefined {
  const direct = numberWords.get(token);
  if (direct) return direct;
  const split = token.indexOf('tausend');
  if (split < 0) return undefined;
  const thousands = numberWords.get(token.slice(0, split));
  const remainder = token.slice(split + 'tausend'.length);
  const units = remainder ? numberWords.get(remainder) : '0';
  return thousands && units ? String(Number(thousands) * 1000 + Number(units)) : undefined;
}

export function scoreWords(text: string): string[] {
  const normalized = text
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE')
    .replace(/\b(\d{1,2})[.:](\d{2})(?:\s*uhr)?\b/g, (whole, hour: string, minute: string) =>
      Number(hour) <= 23 && Number(minute) <= 59 ? `${Number(hour)} uhr ${Number(minute)}` : whole,
    )
    .replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (number) => number.replaceAll('.', ''))
    .replace(/(\d),([0-9]+)/g, '$1 komma $2')
    .replace(/(\d)\s*%/g, '$1 prozent');
  return (normalized.match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => {
    if (/^\d+$/.test(token)) return String(Number(token));
    return numericWord(token) ?? token;
  });
}

export function words(text: string): string[] {
  return (
    text
      .normalize('NFKC')
      .toLocaleLowerCase('de-DE')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function wordErrors(
  reference: string,
  hypothesis: string,
): {
  errors: number;
  count: number;
} {
  const expected = scoreWords(reference);
  const actual = scoreWords(hypothesis);
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  for (let row = 1; row <= expected.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= actual.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + Number(expected[row - 1] !== actual[column - 1]),
      );
    }
    previous = current;
  }
  return { errors: previous[actual.length]!, count: expected.length };
}

export function termHits(terms: string[], hypothesis: string): number {
  const heard = words(hypothesis);
  return terms.filter((term) => {
    const needle = words(term);
    return heard.some((_, index) => needle.every((part, offset) => heard[index + offset] === part));
  }).length;
}

function option(args: string[], name: string): string[] {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]!] : []));
}

async function models(base: string, key: string | undefined): Promise<string[]> {
  const response = await fetch(`${base}/models?show_all=true`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });
  if (!response.ok) throw new Error(`Model list: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { id?: string; downloaded?: boolean }[] };
  return (body.data ?? [])
    .filter((item) => /whisper/i.test(item.id ?? '') && item.downloaded !== false)
    .map((item) => item.id!);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.includes('--help')) {
    console.log(
      'bun apps/api/src/scripts/eval-stt.ts --model all|ID [--route lemonade|whisper-cpp] [--setting baseline|locale|context] [--fixtures DIR] [--base-url URL] [--api-key-env NAME]',
    );
    console.log('Use --list-fixtures to print the 30 reference sentences without calling a model.');
    return;
  }
  const directory = option(args, '--fixtures')[0] ?? join(import.meta.dir, 'fixtures/stt');
  const cases = (await Bun.file(join(directory, 'cases.json')).json()) as Case[];
  if (cases.length !== 30 || new Set(cases.map((item) => item.id)).size !== 30)
    throw new Error('Exactly 30 distinct reference sentences are required');
  if (args.includes('--list-fixtures')) {
    for (const item of cases) console.log(`${item.id}.wav\t${item.text}`);
    return;
  }
  const requested = option(args, '--model');
  const route = option(args, '--route')[0] ?? 'lemonade';
  if (!['lemonade', 'whisper-cpp'].includes(route)) throw new Error('Unknown route');
  if (!requested.length && route !== 'whisper-cpp')
    throw new Error('Pass --model all or one or more --model IDs');
  const requestedSettings = option(args, '--setting');
  const settings = requestedSettings.length ? requestedSettings : SETTINGS;
  if (settings.some((setting) => !SETTINGS.includes(setting as Setting)))
    throw new Error(`Unknown setting; use ${SETTINGS.join(', ')}`);
  const recordings = await Promise.all(
    cases.map(async (item) => {
      const path = join(directory, `${item.id}.wav`);
      const file = Bun.file(path);
      if (!(await file.exists())) throw new Error(`Missing WAV fixture: ${path}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = readWav(bytes);
      if (!info || info.durationMs < 300 || info.durationMs > 120_000)
        throw new Error(`Invalid WAV fixture: ${path}`);
      return whisperWav(bytes, info);
    }),
  );
  const base = (
    option(args, '--base-url')[0] ??
    (route === 'whisper-cpp' ? 'http://127.0.0.1:13306/v1' : 'http://127.0.0.1:13305/api/v1')
  ).replace(/\/$/, '');
  const keyName = option(args, '--api-key-env')[0];
  const key = keyName ? process.env[keyName] : undefined;
  if (keyName && !key) throw new Error(`Environment variable ${keyName} is empty`);
  if (route === 'whisper-cpp' && requested.includes('all'))
    throw new Error('Pass a single --model ID for whisper.cpp');
  const selected = requested.includes('all')
    ? await models(base, key)
    : requested.length
      ? requested
      : ['whisper'];
  if (!selected.length) throw new Error('No installed Whisper models were returned');
  const prompt = [...new Set(cases.flatMap((item) => item.terms))].join(', ') + '.';
  const results: {
    model: string;
    setting: string;
    errors: number;
    count: number;
    hits: number;
    terms: number;
    milliseconds: number;
  }[] = [];
  for (const model of selected) {
    for (const setting of settings) {
      const result = { model, setting, errors: 0, count: 0, hits: 0, terms: 0, milliseconds: 0 };
      try {
        for (const [index, item] of cases.entries()) {
          const form = new FormData();
          form.append(
            'file',
            new Blob([Uint8Array.from(recordings[index]!)], { type: 'audio/wav' }),
            `${item.id}.wav`,
          );
          form.append('model', model);
          form.append('response_format', 'json');
          if (route === 'whisper-cpp') form.append('temperature', '0');
          if (setting !== 'baseline') form.append('language', 'de');
          if (setting === 'context') form.append('prompt', prompt);
          const started = performance.now();
          const response = await fetch(`${base}/audio/transcriptions`, {
            method: 'POST',
            headers: key ? { authorization: `Bearer ${key}` } : {},
            body: form,
            signal: AbortSignal.timeout(90_000),
          });
          result.milliseconds += performance.now() - started;
          if (!response.ok) throw new Error(`${item.id}.wav: HTTP ${response.status}`);
          const answer = (await response.json()) as { text?: unknown };
          if (typeof answer.text !== 'string') throw new Error(`${item.id}.wav: no transcript`);
          const score = wordErrors(item.text, answer.text);
          result.errors += score.errors;
          result.count += score.count;
          result.hits += termHits(item.terms, answer.text);
          result.terms += item.terms.length;
        }
        results.push(result);
      } catch (error) {
        console.error(`${model} / ${setting}: ${String(error)}`);
      }
    }
  }
  console.log('Modell\tEinstellung\tWER\tFachbegriffe\tZeit');
  for (const result of results) {
    console.log(
      `${result.model}\t${result.setting}\t${((result.errors / result.count) * 100).toFixed(1)} %\t${result.hits}/${result.terms}\t${(result.milliseconds / 1000).toFixed(1)} s`,
    );
  }
  const candidates = results.filter((result) => result.setting !== 'baseline');
  const best = (candidates.length ? candidates : results).sort(
    (a, b) => a.errors / a.count - b.errors / b.count || b.hits / b.terms - a.hits / a.terms,
  )[0];
  if (!best) throw new Error('No model completed all 30 recordings');
  console.log(
    `Empfehlung: ${best.model} / ${best.setting} (niedrigste WER, danach Fachbegriff-Treffer).`,
  );
}

if (import.meta.main) await main();
