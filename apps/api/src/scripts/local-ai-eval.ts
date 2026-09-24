// The local AI task-class evals from the command line (docs/helena-decisions/local-ai-platform.md
// §7): the same cases Administrator → Server → Lokale KI runs, against any OpenAI-compatible
// server, without Helena's database. For measuring models before they are registered.
//
//   bun apps/api/src/scripts/local-ai-eval.ts --base http://127.0.0.1:13305/api/v1 \
//     --key-file /etc/helena-ai/api-key --model Qwen3.6-35B-A3B-GGUF \
//     [--embed-model Qwen3-Embedding-0.6B-GGUF] [--classes triage,summaries] [--json out.json]
//
// Prints one line per class: score, threshold, passed, median latency, tokens per second, and
// the failed cases. The key is read from the file and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import type { LocalAiEvalResult } from '@helena/sdk';
import { openAiEvalContext } from '../modules/local-ai/eval-context';
import { BUILTIN_TASK_CLASSES } from '../modules/local-ai/task-classes';

function argument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? (process.argv[index + 1] ?? null) : null;
}

const base = argument('base') ?? 'http://127.0.0.1:13305/api/v1';
const keyFile = argument('key-file');
const key = keyFile ? readFileSync(keyFile, 'utf8').trim() : (process.env.LOCAL_AI_KEY ?? null);
const model = argument('model');
const embedModel = argument('embed-model');
const only = argument('classes')?.split(',').filter(Boolean) ?? null;
const jsonOut = argument('json');

if (!model && !embedModel) {
  console.error('usage: local-ai-eval.ts --model <chat model> [--embed-model <model>] …');
  process.exit(2);
}

interface Row {
  classId: string;
  model: string;
  threshold: number;
  result: LocalAiEvalResult | null;
  error: string | null;
  seconds: number;
}

const rows: Row[] = [];
for (const entry of BUILTIN_TASK_CLASSES) {
  if (!entry.evaluate || (only && !only.includes(entry.id))) continue;
  const target = entry.capability === 'embeddings' ? embedModel : model;
  if (!target) continue;
  const started = Date.now();
  let result: LocalAiEvalResult | null = null;
  let error: string | null = null;
  try {
    result = await entry.evaluate(openAiEvalContext({ baseUrl: base, key, model: target }));
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  rows.push({
    classId: entry.id,
    model: target,
    threshold: entry.threshold ?? 0.8,
    result,
    error,
    seconds: (Date.now() - started) / 1000,
  });
  const score = result ? result.score.toFixed(2) : 'error';
  const passed = result && result.score >= (entry.threshold ?? 0.8) ? 'passed' : 'FAILED';
  const p50 = result?.latencyMsP50 != null ? `${Math.round(result.latencyMsP50)} ms` : '-';
  const tps = result?.tokensPerSecond != null ? `${result.tokensPerSecond.toFixed(1)} tok/s` : '-';
  console.log(
    `${entry.id.padEnd(20)} ${target.padEnd(32)} ${score} / ${entry.threshold ?? 0.8} ${passed}  p50 ${p50}  ${tps}  (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  for (const failed of result?.cases.filter((item) => !item.passed) ?? []) {
    console.log(`    ${failed.id}: ${failed.detail ?? ''}`);
  }
  if (error) console.log(`    error: ${error}`);
}

if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ base, rows }, null, 2)}\n`);
