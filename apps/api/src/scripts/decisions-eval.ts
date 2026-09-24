// The decision classes' evals from the command line, against any backend, without Helena's
// database (docs/helena-decisions/decisions.md §8): the numbers in the decision doc come from
// here. Every class's labelled cases are asked exactly as the feature asks them.
//
//   bun apps/api/src/scripts/decisions-eval.ts \
//     --classes router,mail,receipts,general \
//     --backends '[{"name":"laya-typed","protocol":"systemone","url":"http://127.0.0.1:18792",
//                  "keyFile":"~/agent-work/decisions/laya.key","model":"laya-typed-decisions"},
//                 {"name":"qwen3.5-4b-logit","protocol":"openai-logprobs",
//                  "url":"http://127.0.0.1:18793","keyFile":"…","model":"qwen"}]' \
//     --out results.json [--concurrency 2] [--debias]
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { DecisionEvalSet, DecisionQuestion } from '@helena/sdk';
import {
  askByJson,
  askByLogprobs,
  readAnswer,
  runDecisionEval,
  toSystemOne,
  type EvalReport,
  type OpenAiCompatibleServer,
  type SystemOneResult,
} from '@helena/decisions';
import { GENERIC_EVAL } from '../modules/decisions/evals/generic';
import { MAIL_EVAL } from '../modules/decisions/evals/mail';
import { RECEIPT_EVAL } from '../modules/decisions/evals/receipts';
import { ROUTER_EVAL } from '../modules/decisions/evals/router';

interface Backend {
  name: string;
  protocol: 'systemone' | 'openai-logprobs' | 'openai-json';
  url: string;
  keyFile?: string;
  model: string;
  debias?: boolean;
}

const SETS: Record<string, { set: DecisionEvalSet; threshold: number }> = {
  router: { set: ROUTER_EVAL, threshold: 0.6 },
  mail: { set: MAIL_EVAL, threshold: 0.7 },
  receipts: { set: RECEIPT_EVAL, threshold: 0.85 },
  general: { set: GENERIC_EVAL, threshold: 0.7 },
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function keyOf(backend: Backend): Promise<string | null> {
  if (!backend.keyFile) return null;
  return (await readFile(backend.keyFile.replace(/^~/, homedir()), 'utf8')).trim() || null;
}

async function postJson(url: string, key: string | null, body: unknown, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function asker(backend: Backend, debias: boolean) {
  const key = await keyOf(backend);
  const base = backend.url.replace(/\/+$/, '');
  const server: OpenAiCompatibleServer = {
    model: backend.model,
    debias: debias || backend.debias === true,
    post: (path, body, signal) => postJson(`${base}${path}`, key, body, signal),
  };
  return async (context: string, questions: Record<string, DecisionQuestion>) => {
    const started = performance.now();
    let result: SystemOneResult;
    const request = { state: context, questions: toSystemOne(questions) };
    if (backend.protocol === 'systemone') {
      const body = (await postJson(`${base}/v1/systemone`, key, {
        model: backend.model,
        ...request,
      })) as {
        model?: string;
        answers: SystemOneResult['answers'];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      result = {
        model: body.model ?? backend.model,
        answers: body.answers,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
    } else if (backend.protocol === 'openai-logprobs') {
      result = await askByLogprobs(server, request);
    } else {
      result = await askByJson(server, request);
    }
    const latencyMs = Math.round(performance.now() - started);
    const answers = Object.fromEntries(
      Object.entries(questions).map(([id, question]) => [
        id,
        readAnswer(question, result.answers[id]),
      ]),
    );
    return {
      answers,
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      model: result.model,
    };
  };
}

function pct(value: number | null): string {
  return value === null ? '  –  ' : `${(value * 100).toFixed(0).padStart(3)} %`;
}

async function main() {
  const classes = (arg('classes') ?? 'router,mail,receipts,general').split(',');
  const backends = JSON.parse(arg('backends') ?? '[]') as Backend[];
  const concurrency = Number(arg('concurrency') ?? 2);
  const debias = process.argv.includes('--debias');
  const out = arg('out');
  const results: {
    class: string;
    backend: string;
    model: string;
    debias: boolean;
    report: EvalReport;
  }[] = [];
  for (const backend of backends) {
    const ask = await asker(backend, debias);
    for (const name of classes) {
      const entry = SETS[name];
      if (!entry) throw new Error(`unknown class ${name}`);
      const started = Date.now();
      const report = await runDecisionEval(entry.set, entry.threshold, ask, { concurrency });
      results.push({ class: name, backend: backend.name, model: backend.model, debias, report });
      console.log(
        `${name.padEnd(9)} ${backend.name.padEnd(22)} acc ${pct(report.accuracy)}  ` +
          `prec@${entry.threshold} ${pct(report.precision)}  cov ${pct(report.coverage)}  ` +
          `p50 ${String(report.latencyP50Ms ?? '–').padStart(5)} ms  p95 ${String(report.latencyP95Ms ?? '–').padStart(5)} ms  ` +
          `tok ${report.inputTokens}  ${report.passed ? 'PASS' : 'fail'}  errors ${report.errors.length}  ` +
          `(${Math.round((Date.now() - started) / 1000)} s)`,
      );
      for (const [question, score] of Object.entries(report.byQuestion)) {
        console.log(
          `            ${question.padEnd(14)} acc ${pct(score.correct / score.questions)}  ` +
            `answered ${score.answered}/${score.questions}  prec ${pct(score.answered ? score.correctAnswered / score.answered : null)}`,
        );
      }
    }
  }
  if (out) await writeFile(out, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
}

await main();
