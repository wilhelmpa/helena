import { afterAll, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const directory = await mkdtemp(resolve(tmpdir(), 'volition-jev-calibration-'));
afterAll(() => rm(directory, { recursive: true, force: true }));
const file = (name: string) => resolve(directory, name);
const cases = ['a', 'b', 'c'].map((id) => ({ id, expected: { work: 'yes' } }));
await writeFile(
  file('definitions.json'),
  JSON.stringify({
    definitions: [
      {
        name: 'test',
        definition: {
          id: 'test',
          defaults: { threshold: 0.8 },
          input: { cloud: 'allowed' },
          eval: { cases },
        },
      },
    ],
  }),
);
await writeFile(file('split.json'), JSON.stringify({ test: { tuning: ['a', 'c'], check: ['b'] } }));
const rows = cases.flatMap(({ id }) =>
  [0, 1].map((repeat) => ({
    class: 'test',
    case: id,
    question: 'work',
    expected: ['yes'],
    choice: id === 'a' ? 'yes' : 'no',
    confidence: id === 'a' ? 0.9 : id === 'b' ? 0.95 : 0.3,
    mode: 'bounded',
    repeat,
  })),
);
const measured = [
  ...rows,
  ...rows.map((row) => ({
    ...row,
    mode: 'first-stage',
    readiness: {
      choice: row.case === 'b' ? 'uncertain' : 'ready',
      confidence: row.case === 'a' ? 0.2 : 1,
    },
  })),
];
await writeFile(file('raw.json'), JSON.stringify({ rows: measured }));
const run = (...args: string[]) =>
  spawnSync(
    process.execPath,
    [
      resolve(import.meta.dir, 'jev-precision-score.ts'),
      '--definitions',
      file('definitions.json'),
      '--split',
      file('split.json'),
      '--out-dir',
      directory,
      ...args,
    ],
    { encoding: 'utf8' },
  );

it('freezes thresholds before reporting an incorrect holdout without retuning', async () => {
  expect(run('--raw', file('raw.json'), '--select').status).toBe(0);
  const thresholds = JSON.parse(await readFile(file('thresholds.json'), 'utf8'));
  expect(thresholds.test).toBe(0.301);
  const tuning = JSON.parse(await readFile(file('tuning.json'), 'utf8'));
  expect([...new Set(tuning.map((entry: { part: string }) => entry.part))]).toEqual(['tuning']);
  expect(tuning.find((entry: { mode: string }) => entry.mode === 'first-stage').accepted).toBe(0);
  expect(run('--raw', file('raw.json'), '--thresholds', file('thresholds.json')).status).toBe(0);
  const scores = JSON.parse(await readFile(file('scores.json'), 'utf8'));
  expect(scores.find((entry: { part: string }) => entry.part === 'check').precision).toBe(0);
  expect(JSON.parse(await readFile(file('thresholds.json'), 'utf8'))).toEqual(thresholds);
});

it('refuses missing or duplicate answers instead of reporting flattering partial data', async () => {
  for (const incomplete of [measured.slice(1), [...measured, measured[0]]]) {
    await writeFile(file('incomplete.json'), JSON.stringify({ rows: incomplete }));
    const result = run('--raw', file('incomplete.json'), '--select');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Incomplete, duplicated or relabeled');
  }
});
