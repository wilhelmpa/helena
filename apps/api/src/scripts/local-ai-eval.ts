import {
  NpuDecisionReadoutError,
  verifyNpuDecisionReadout,
  type NpuDecisionReadoutReport,
} from '../modules/local-ai/npu-eval';
import { retrySocketClosed, type SocketRetry } from './local-ai-eval-retry';
// The local AI task-class evals from the command line (docs/helena-decisions/local-ai-platform.md
// §7): the same cases Administrator → Server → Lokale KI runs, against any OpenAI-compatible
// server. Registered servers persist valid evaluations when DATABASE_URL is configured.
//
//   bun apps/api/src/scripts/local-ai-eval.ts --base http://127.0.0.1:13305/api/v1 \
//     --key-file /etc/helena/local-ai.key --model Qwen3.6-35B-A3B-GGUF \
//     [--embed-model Qwen3-Embedding-0.6B-GGUF] [--classes triage,summaries] \
//     [--thinking off|low|medium|high] [--json out.json | --json -]
//     [--npu --npu-backend fastflowlm --npu-timeout-ms 30000]
// Backend/model defaults: VOLITION_NPU_DECISION_TIMEOUTS_MS='{"fastflowlm":{"gemma4-it:e2b":30000}}'.
//
// Prints one line per class: score, threshold, passed, thinking, median latency, tokens per
// second, and the failed cases. Each class runs with its own `thinking` unless --thinking
// names one for all (to compare). `--json -` writes the JSON to stdout and the lines to
// stderr, so a caller that may write where this user may not (bench.sh as root) redirects it.
// The key is read from the file and never printed.
//
// The judge of Deutsch-Texte: an OpenAI-compatible endpoint (--judge-base, --judge-key-file,
// --judge-model), or the owner's logged-in CLI (--judge-cli claude|codex --judge-model opus):
//   bun apps/api/src/scripts/local-ai-eval.ts --base http://127.0.0.1:8731/v1 \
//     --model halogen-qwen3.8-flash-next --classes deutsch-texte --judge-cli claude --judge-model opus
import { readFileSync, writeFileSync } from 'node:fs';
import { LOCAL_AI_THINKING, type LocalAiEvalResult, type LocalAiThinking } from '@helena/sdk';
import { tmpdir } from 'node:os';
import { openAiEvalContext } from '../modules/local-ai/eval-context';
import { cliJudge } from '../modules/local-ai/judge-cli';
import { DECISIONS_LOCAL_AI_CLASS } from '../modules/decisions/local-ai-class';
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
const thinkingArgument = argument('thinking');
const npuBackend = argument('npu-backend') ?? 'fastflowlm';
const npuTimeoutArgument = argument('npu-timeout-ms');
const npuTimeoutMs = npuTimeoutArgument === null ? undefined : Number(npuTimeoutArgument);
if (npuTimeoutMs !== undefined && (!Number.isSafeInteger(npuTimeoutMs) || npuTimeoutMs <= 0)) {
  console.error('--npu-timeout-ms must be a positive integer');
  process.exit(2);
}
const judgeBase = argument('judge-base') ?? process.env.LOCAL_AI_JUDGE_BASE_URL;
const judgeModel = argument('judge-model') ?? process.env.LOCAL_AI_JUDGE_MODEL ?? 'claude-opus-4-6';
const judgeCli = argument('judge-cli');
if (judgeCli && judgeCli !== 'claude' && judgeCli !== 'codex') {
  console.error('--judge-cli must be claude or codex');
  process.exit(2);
}
const judgeKeyFile = argument('judge-key-file');
const judgeKey = judgeKeyFile
  ? readFileSync(judgeKeyFile, 'utf8').trim()
  : (process.env.LOCAL_AI_JUDGE_API_KEY ?? null);
if (thinkingArgument && !(LOCAL_AI_THINKING as readonly string[]).includes(thinkingArgument)) {
  console.error(`--thinking must be one of ${LOCAL_AI_THINKING.join(', ')}`);
  process.exit(2);
}
const thinkingOverride = thinkingArgument as LocalAiThinking | null;
// The lines go to stderr while the JSON goes to stdout.
const say = jsonOut === '-' ? console.error : console.log;

if (!model && !embedModel) {
  console.error('usage: local-ai-eval.ts --model <chat model> [--embed-model <model>] …');
  process.exit(2);
}

interface Row {
  classId: string;
  model: string;
  threshold: number;
  thinking: LocalAiThinking | null;
  result: LocalAiEvalResult | null;
  score100: number | null;
  error: string | null;
  seconds: number;
  npuReadout: NpuDecisionReadoutReport | null;
  retries: SocketRetry[];
}

const rows: Row[] = [];
for (const entry of [...BUILTIN_TASK_CLASSES, DECISIONS_LOCAL_AI_CLASS]) {
  const evaluate = entry.evaluate;
  if (!evaluate || (only && !only.includes(entry.id))) continue;
  const target = entry.capability === 'embeddings' ? embedModel : model;
  if (!target) continue;
  const thinking =
    entry.capability === 'embeddings' ? null : (thinkingOverride ?? entry.thinking ?? 'off');
  const started = Date.now();
  let result: LocalAiEvalResult | null = null;
  let error: string | null = null;
  let npuReadout: NpuDecisionReadoutReport | null = null;
  const retries: SocketRetry[] = [];
  try {
    result = await retrySocketClosed(
      async () => {
        if (process.argv.includes('--npu'))
          npuReadout = await verifyNpuDecisionReadout({
            baseUrl: base,
            key,
            model: target,
            classId: entry.id,
            backend: npuBackend,
            timeoutMs: npuTimeoutMs,
          });
        let judge: ReturnType<typeof openAiEvalContext>['chat'] | undefined;
        if (judgeCli)
          judge = cliJudge(
            judgeCli as 'claude' | 'codex',
            judgeModel,
            process.env.TMPDIR ?? tmpdir(),
          );
        else if (judgeBase)
          judge = openAiEvalContext({ baseUrl: judgeBase, key: judgeKey, model: judgeModel }).chat;
        return evaluate(
          openAiEvalContext({
            baseUrl: base,
            key,
            model: target,
            thinking: thinking ?? 'off',
            judge,
          }),
        );
      },
      (retry) => {
        retries.push(retry);
        say(`    ${entry.id}: socket closed; retrying once after ${retry.delayMs} ms`);
      },
    );
  } catch (caught) {
    if (caught instanceof NpuDecisionReadoutError) npuReadout = caught.report;
    error = caught instanceof Error ? caught.message : String(caught);
  }
  if (result && !process.env.DATABASE_URL)
    say(`    ${entry.id}: evaluation not saved (DATABASE_URL is not configured)`);
  if (result && process.env.DATABASE_URL) {
    const { storeCliEval } = await import('./local-ai-eval-store');
    const saved = await storeCliEval({
      baseUrl: base,
      model: target,
      entry,
      result,
      ranAt: new Date(started),
    });
    say(
      `    ${entry.id}: ${saved ? 'evaluation saved' : 'server not registered uniquely; evaluation not saved'}`,
    );
  }
  rows.push({
    classId: entry.id,
    model: target,
    threshold: entry.threshold ?? 0.8,
    thinking,
    result,
    score100: entry.id === 'deutsch-texte' && result ? Math.round(result.score * 100) : null,
    error,
    npuReadout,
    retries,
    seconds: (Date.now() - started) / 1000,
  });
  const score = result ? result.score.toFixed(2) : 'error';
  const passed = result && result.score >= (entry.threshold ?? 0.8) ? 'passed' : 'FAILED';
  const p50 = result?.latencyMsP50 != null ? `${Math.round(result.latencyMsP50)} ms` : '-';
  const tps = result?.tokensPerSecond != null ? `${result.tokensPerSecond.toFixed(1)} tok/s` : '-';
  say(
    `${entry.id.padEnd(20)} ${target.padEnd(32)} ${score} / ${entry.threshold ?? 0.8} ${passed}  thinking ${thinking ?? '-'}  p50 ${p50}  ${tps}  (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
  for (const failed of result?.cases.filter((item) => !item.passed) ?? []) {
    say(`    ${failed.id}: ${failed.detail ?? ''}`);
  }
  if (error) say(`    error: ${error}`);
  if (npuReadout)
    say(
      `    NPU readout: timeout ${npuReadout.timeoutMs} ms; ${npuReadout.timeouts.length} timeouts; ${npuReadout.failures.length} decision failures; ${npuReadout.errors.length} backend errors`,
    );
  if (retries.length)
    say(`    socket retry: ${result ? 'completed' : 'failed'} (${retries.length})`);
}

const report = `${JSON.stringify({ base, rows }, null, 2)}\n`;
if (jsonOut === '-') process.stdout.write(report);
else if (jsonOut) writeFileSync(jsonOut, report);
