import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import {
  readAnswer,
  splitDecisionCases,
  toSystemOne,
  type CalibrationRow,
} from '@helena/decisions';
import { MEASUREMENT_CLASSES } from '#modules/decisions/measurement-classes';
import {
  stageContext,
  stageQuestions,
  FIRST_STAGE_READINESS,
} from '#modules/decisions/stage-questions';

function required(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const out = resolve(required('out-dir'));
const manifest = JSON.parse(await readFile(required('split'), 'utf8')) as Record<
  string,
  ReturnType<typeof splitDecisionCases>
>;
await mkdir(out, { recursive: true });
const definitions = MEASUREMENT_CLASSES.map(({ name, definition }) => {
  const split = splitDecisionCases(definition.eval!.cases.map((entry) => entry.id));
  if (JSON.stringify(split) !== JSON.stringify(manifest[name]))
    throw new Error(`Frozen split differs for ${name}`);
  return { name, definition, split };
});
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dir })
  .toString()
  .trim();
await writeFile(resolve(out, 'definitions.json'), JSON.stringify({ commit, definitions }, null, 2));
const dry = process.argv.includes('--dry');
if (dry) {
  console.log(`Validated ${definitions.length} production classes and frozen splits.`);
  process.exit(0);
}
// Only Claude's wrapper supplies this value; this driver never loads credentials or a database.
if (!process.env.TYPESAFE_KEY) throw new Error('Run through with-jev-key.ts');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const client = new TypeSafeClient({
  apiKey: process.env.TYPESAFE_KEY,
  baseURL: 'https://api.typesafe.ai',
  defaultModel: 'jev-latest',
  timeout: 20_000,
  retry: { maxRetries: 0 },
  logger: quiet,
  logLevel: 'error',
});
interface Row extends CalibrationRow {
  repeat: number;
  mode: 'bounded' | 'first-stage';
  latencyMs: number;
  probabilities?: Record<string, number>;
  readiness?: { choice: string; confidence: number };
}
const rows: Row[] = [];
const requests: unknown[] = [];
for (const { name, definition } of definitions) {
  const cases = definition.eval!.cases;
  let next = 0;
  const jobs = cases.flatMap((item) =>
    [0, 1].flatMap((repeat) =>
      (definition.input.cloud === 'allowed'
        ? (['bounded', 'first-stage'] as const)
        : (['bounded'] as const)
      ).map((mode) => ({ item, repeat, mode })),
    ),
  );
  const worker = async () => {
    while (next < jobs.length) {
      const { item, repeat, mode } = jobs[next++]!;
      const questions = mode === 'first-stage' ? stageQuestions(item.questions) : item.questions;
      const context =
        mode === 'first-stage' ? stageContext(item.context, item.questions) : item.context;
      const started = performance.now();
      let captured = false;
      try {
        const response = await client.systemOne({
          state: context as never,
          questions: toSystemOne(questions) as never,
          model: 'jev-latest',
        });
        requests.push({ class: name, case: item.id, repeat, mode, response });
        captured = true;
        const answers = Object.fromEntries(
          Object.entries(questions).map(([id, question]) => [
            id,
            readAnswer(question, response.answers[id]),
          ]),
        );
        const readiness = answers[FIRST_STAGE_READINESS];
        for (const [question, expected] of Object.entries(item.expected)) {
          const answer = answers[question]!;
          rows.push({
            class: name,
            case: item.id,
            question,
            expected: [expected].flat(),
            choice: answer.choice,
            confidence: answer.confidence,
            probabilities: answer.probabilities,
            repeat,
            mode,
            latencyMs: Math.round(performance.now() - started),
            ...(readiness && {
              readiness: { choice: readiness.choice, confidence: readiness.confidence },
            }),
          });
        }
      } catch {
        // Provider errors can contain request headers. Only a fixed error marker is persisted.
        if (!captured)
          requests.push({
            class: name,
            case: item.id,
            repeat,
            mode,
            error: 'request_or_answer_failed',
          });
        for (const [question, expected] of Object.entries(item.expected))
          rows.push({
            class: name,
            case: item.id,
            question,
            expected: [expected].flat(),
            choice: null,
            confidence: 0,
            repeat,
            mode,
            latencyMs: Math.round(performance.now() - started),
            error: 'request_or_answer_failed',
          });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  await writeFile(
    resolve(out, 'raw.json'),
    JSON.stringify({ commit, at: new Date().toISOString(), rows, requests }, null, 2),
  );
  console.log(
    `${name}: ${jobs.length} requests, ${rows.filter((row) => row.class === name && row.error).length} failed answers`,
  );
}
