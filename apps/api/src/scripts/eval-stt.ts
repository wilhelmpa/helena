import { join } from 'node:path';
import { readWav, whisperWav } from '../modules/voice/wav';

interface Case {
  id: string;
  text: string;
  terms: string[];
}

type Setting = 'baseline' | 'locale' | 'context';
const SETTINGS: Setting[] = ['baseline', 'locale', 'context'];

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
  const expected = words(reference);
  const actual = words(hypothesis);
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
      'bun apps/api/src/scripts/eval-stt.ts --model all|ID [--model ID] [--setting baseline|locale|context] [--fixtures DIR] [--base-url URL] [--api-key-env NAME]',
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
  if (!requested.length) throw new Error('Pass --model all or one or more --model IDs');
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
  const base = (option(args, '--base-url')[0] ?? 'http://127.0.0.1:13305/api/v1').replace(
    /\/$/,
    '',
  );
  const keyName = option(args, '--api-key-env')[0];
  const key = keyName ? process.env[keyName] : undefined;
  if (keyName && !key) throw new Error(`Environment variable ${keyName} is empty`);
  const selected = requested.includes('all') ? await models(base, key) : requested;
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
