import { isDeepStrictEqual } from 'node:util';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runDecisionEval, type EvalAsk, type EvalAskResult } from '@helena/decisions';
import { type LocalAiEvalResult } from '@helena/sdk';
import {
  MODEL_ROLES,
  MODEL_TEMPLATES,
  CLOUD_AGENT_MODELS,
  type ModelRole,
} from '../modules/model-schemas/templates';
import { BUILTIN_TASK_CLASSES } from '../modules/local-ai/task-classes';
import { openAiEvalContext } from '../modules/local-ai/eval-context';
import { cliJudge } from '../modules/local-ai/judge-cli';
import { evaluateCodingTask, HELENA_AGENT_ENTRY } from './agentic-coding/run';
import { CODING_TASKS } from './agentic-coding/tasks';
import { DECISION_EVAL_SETS, decisionEvalAsker } from './decisions-eval';
import { ROLE_SUITES, type MatrixSuite } from './eval-matrix-suites';
import {
  MATRIX_BACKENDS,
  percentile,
  recommend,
  roleRecommendation,
  schemaRecommendations,
  type MatrixBackend,
  type MatrixResult,
} from './eval-matrix-results';

const work = join(homedir(), 'agent-work');
const root = resolve(import.meta.dir, '../../../..');
const output = join(work, 'eval-matrix');
const raw = join(output, 'raw');
function arg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
const timestamp = () => new Date().toISOString();
function empty(
  backend: string,
  suite: string,
  status: MatrixResult['status'],
  reason: string,
): MatrixResult {
  return {
    backend,
    suite,
    status,
    reason,
    source: '148',
    at: timestamp(),
    score: null,
    passed: false,
    cases: 0,
    p50: null,
    p95: null,
    tokensPerSecond: null,
    toolErrors: null,
    costUsd: null,
  };
}
export function cascadeAsker(first: EvalAsk, second: EvalAsk, threshold: number): EvalAsk {
  return async (context, questions) => {
    const started = Date.now();
    let primary: EvalAskResult | null = null;
    try {
      primary = await first(context, questions);
    } catch {
      /* Fallback is evaluated on the original synthetic context. */
    }
    const missing = Object.fromEntries(
      Object.entries(questions).filter(
        ([id]) =>
          !primary?.answers[id]?.choice || (primary.answers[id]?.confidence ?? 0) < threshold,
      ),
    );
    if (!Object.keys(missing).length) return primary!;
    const fallback = await second(context, missing);
    return {
      ...fallback,
      model: `${primary?.model ?? 'unavailable'}→${fallback.model}`,
      answers: { ...primary?.answers, ...fallback.answers },
      inputTokens: (primary?.inputTokens ?? 0) + fallback.inputTokens,
      outputTokens: (primary?.outputTokens ?? 0) + fallback.outputTokens,
      latencyMs:
        (primary?.latencyMs ?? Date.now() - started - fallback.latencyMs) + fallback.latencyMs,
    };
  };
}
async function ready(backend: MatrixBackend, waitMs: number) {
  if (!backend.marker) return true;
  const need = join(output, `need-${backend.marker}`);
  try {
    await stat(need);
  } catch {
    await writeFile(need, `${timestamp()}\n`);
  }
  const start = Date.now();
  do {
    try {
      const permission = join(output, `ready-${backend.marker}`);
      if ((await stat(permission)).mtimeMs < (await stat(need)).mtimeMs)
        throw new Error('Stale window');
      const config = (await readFile(permission, 'utf8')).trim();
      if (config.startsWith('{')) {
        const value = JSON.parse(config) as { base?: string; model?: string };
        const windowModel =
          MATRIX_BACKENDS.find((item) => item.marker === backend.marker && !item.stages)?.model ??
          backend.model;
        if (value.model && value.model !== windowModel) throw new Error('Wrong model window');
        if (value.base) {
          const url = new URL(value.base);
          if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')
            throw new Error('Window must be local');
          backend.windowBase = value.base;
          if (!backend.stages) backend.base = value.base;
        }
      }
      return true;
    } catch {
      if (Date.now() - start >= waitMs) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000, waitMs)));
    }
  } while (Date.now() - start < waitMs);
  return false;
}
async function processRun(command: string, args: string[], logfile: string) {
  const log = Bun.file(logfile).writer();
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data: Buffer) => log.write(data));
    child.on('error', async (error) => {
      await log.end();
      reject(error);
    });
    child.on('close', async (code) => {
      await log.end();
      resolve(code ?? 1);
    });
  });
}
async function health(backend: MatrixBackend) {
  if (backend.id !== 'flash' && !backend.stages?.includes('flash')) return;
  const response = await fetch('http://127.0.0.1:8741/health', {
    signal: AbortSignal.timeout(5000),
  });
  const status = (await response.json()) as { busy?: boolean; error?: unknown };
  if (!response.ok || status.error || status.busy)
    throw new Error('Priority proxy unavailable or busy; measurement deferred');
}
async function decisionAsk(backend: MatrixBackend): Promise<EvalAsk> {
  const ask = await decisionEvalAsker(
    {
      name: backend.id,
      protocol: backend.id === 'jev' ? 'systemone' : 'openai-json',
      url: backend.base,
      model: backend.model,
      ...(backend.id === 'jev' && { keyEnv: 'TYPESAFE_KEY' }),
    },
    false,
    1,
  );
  return async (...args) => {
    await health(backend);
    return ask(...args);
  };
}
export function chatResult(
  backend: string,
  suite: MatrixSuite,
  result: LocalAiEvalResult,
  toolErrors: number,
): MatrixResult {
  return {
    ...empty(backend, suite.id, 'measured', ''),
    reason: undefined,
    score: result.score,
    passed: result.cases.length > 0 && result.score >= suite.threshold && toolErrors === 0,
    cases: result.cases.length,
    p50: result.latencyMsP50 ?? null,
    p95: percentile(
      result.cases.map((item) => item.latencyMs ?? NaN),
      0.95,
    ),
    tokensPerSecond: result.tokensPerSecond ?? null,
    toolErrors,
    costUsd: 0,
  };
}
async function measure(backend: MatrixBackend, suite: MatrixSuite) {
  if ((backend.id === 'jev' && suite.kind === 'chat') || (backend.stages && suite.kind === 'chat'))
    return {
      row: empty(backend.id, suite.id, 'unsupported', 'Decision backend has no chat/tools runtime'),
    };
  if (
    (backend.id === 'jev' || backend.stages?.includes('jev') || suite.jevControl) &&
    !process.env.TYPESAFE_KEY
  )
    return { row: empty(backend.id, suite.id, 'open', 'Jev key wrapper unavailable') };
  if (suite.kind === 'browser') {
    if (backend.stages || (backend.id === 'jev' && suite.jevControl))
      return {
        row: empty(
          backend.id,
          suite.id,
          'unsupported',
          'Duplicate Jev control or decision-only cascade',
        ),
      };
    const local = { name: backend.id, kind: 'local-json', url: backend.base, model: backend.model };
    const config =
      backend.id === 'jev'
        ? {
            name: 'jev',
            kind: 'systemone',
            url: backend.base,
            model: backend.model,
            keyEnv: 'TYPESAFE_KEY',
          }
        : suite.jevControl
          ? {
              name: backend.id,
              kind: 'cascade',
              url: 'https://api.typesafe.ai',
              model: 'jev-1.13.0',
              keyEnv: 'TYPESAFE_KEY',
              below: 0.95,
              local,
            }
          : local;
    const path = join(raw, `${safe(backend.id)}-${suite.id}-browser.json`);
    const code = await processRun(
      'bun',
      [
        join(work, 'combo-eval/bg/eval/run-eval.ts'),
        '--set',
        'local',
        '--chromium',
        '/usr/bin/chromium',
        '--backends',
        JSON.stringify([config]),
        '--out',
        path,
      ],
      `${path}.log`,
    );
    if (code) throw new Error(`Browser harness exited ${code}`);
    const data = JSON.parse(await readFile(path, 'utf8')) as {
      rows: {
        correct: boolean;
        falseDone: boolean;
        durationMs: number;
        status: string;
        inputTokens: number;
        error?: string;
      }[];
    };
    const cases = data.rows;
    const errors = cases.filter(
      (item) => item.falseDone || item.error || item.status === 'exception',
    ).length;
    const score = cases.filter((item) => item.correct).length / Math.max(1, cases.length);
    return {
      row: {
        ...empty(backend.id, suite.id, 'measured', ''),
        reason: undefined,
        score,
        cases: cases.length,
        passed: cases.length === 20 && score === 1 && errors === 0,
        p50: percentile(
          cases.map((item) => item.durationMs),
          0.5,
        ),
        p95: percentile(
          cases.map((item) => item.durationMs),
          0.95,
        ),
        toolErrors: errors,
        costUsd:
          backend.id === 'jev'
            ? (cases.reduce((sum, item) => sum + item.inputTokens, 0) * 0.042) / 1e6
            : suite.jevControl
              ? null
              : 0,
      },
      detail: data,
    };
  }
  if (suite.kind === 'decision') {
    const entry = DECISION_EVAL_SETS[suite.source]!;
    const calls: EvalAskResult[] = [];
    let jevInput = 0;
    const make = async (item: MatrixBackend) => {
      const ask = await decisionAsk(item);
      return async (...args: Parameters<EvalAsk>) => {
        const result = await ask(...args);
        if (item.id === 'jev') jevInput += result.inputTokens;
        return result;
      };
    };
    const stages = backend.stages?.map((id) => {
      const item = MATRIX_BACKENDS.find((candidate) => candidate.id === id)!;
      return {
        ...item,
        ...(item.marker === backend.marker && { base: backend.windowBase ?? item.base }),
      };
    });
    const ask = stages
      ? cascadeAsker(await make(stages[0]!), await make(stages[1]!), entry.threshold)
      : await make(backend);
    const report = await runDecisionEval(
      entry.set,
      entry.threshold,
      async (...args) => {
        const result = await ask(...args);
        calls.push(result);
        return result;
      },
      { concurrency: 1 },
    );
    const seconds = calls.reduce((sum, item) => sum + item.latencyMs, 0) / 1000;
    return {
      row: {
        ...empty(backend.id, suite.id, 'measured', ''),
        reason: undefined,
        score: report.precision,
        passed: report.passed && report.errors.length === 0,
        cases: entry.set.cases.length,
        p50: report.latencyP50Ms,
        p95: report.latencyP95Ms,
        tokensPerSecond: seconds > 0 ? report.outputTokens / seconds : null,
        toolErrors: report.errors.length,
        costUsd: (jevInput * 0.042) / 1e6,
      },
      detail: { report, calls },
    };
  }
  const entry = BUILTIN_TASK_CLASSES.find((item) => item.id === suite.source)!;
  let toolErrors = 0;
  const judge = arg('judge-cli');
  if (suite.source === 'deutsch-texte' && !judge)
    return {
      row: empty(
        backend.id,
        suite.id,
        'open',
        'Independent judge required (--judge-cli codex|claude)',
      ),
    };
  const context = openAiEvalContext({
    baseUrl: backend.base,
    model: backend.model,
    key: null,
    thinking: entry.thinking ?? 'off',
    ...(judge && {
      judge: cliJudge(
        judge as 'codex' | 'claude',
        CLOUD_AGENT_MODELS[judge as 'codex' | 'claude'],
        '/tmp',
      ),
    }),
    runCodingTask: async (id) => {
      const task = CODING_TASKS.find((item) => item.id === id)!;
      const result = await evaluateCodingTask(task, backend.model, 'volition-eval', {
        kind: 'helena',
        entry: HELENA_AGENT_ENTRY,
        baseUrl: backend.base,
      });
      toolErrors += result.toolCalls - result.validToolCalls;
      return result;
    },
  });
  const baseChat = context.chat;
  context.chat = async (request) => {
    await health(backend);
    return baseChat(request);
  };
  const result = await entry.evaluate!(context);
  return { row: chatResult(backend.id, suite, result, toolErrors), detail: result };
}
function safe(id: string) {
  return id.replace(/[^a-zA-Z0-9.-]/g, '-');
}
async function worker(backend: MatrixBackend, suites: MatrixSuite[]) {
  for (const suite of suites) {
    let result;
    try {
      await health(backend);
      result = await measure(backend, suite);
    } catch (error) {
      result = {
        row: empty(
          backend.id,
          suite.id,
          'open',
          error instanceof Error ? error.message.split('\n')[0]!.slice(0, 160) : 'Harness failed',
        ),
      };
    }
    await writeFile(
      join(raw, `${safe(backend.id)}--${suite.id}.json`),
      JSON.stringify({ backend, suite, ...result }, null, 2),
    );
    console.log(`${backend.id} ${suite.id}: ${result.row.status} ${result.row.score ?? '–'}`);
  }
}
async function readResults() {
  const rows: MatrixResult[] = [];
  for (const path of (await readdir(raw)).filter(
    (name) => name.includes('--') && name.endsWith('.json'),
  )) {
    const value = JSON.parse(await readFile(join(raw, path), 'utf8')) as { row?: MatrixResult };
    if (value.row) rows.push(value.row);
  }
  return rows;
}
type ComboRow = {
  class: string;
  case: string;
  question: string;
  expected: string[];
  choice: string | null;
  confidence: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
};
async function importCombo() {
  const directory = join(work, 'combo-eval/raw');
  const all = [
    ...new Map(
      Object.values(ROLE_SUITES)
        .flat()
        .map((suite) => [suite.id, suite]),
    ).values(),
  ].filter((suite) => suite.kind === 'decision');
  for (const filename of [
    'dec-flash-json.json',
    'dec-npu2b-json.json',
    'dec-npu2b-json-trading.json',
    'dec-jev.json',
    'dec-jev-trading.json',
  ]) {
    const data = JSON.parse(await readFile(join(directory, filename), 'utf8')) as {
      at: string;
      backend: { name: string; model: string };
      rows: ComboRow[];
    };
    const backend =
      data.backend.name === 'flash-json'
        ? 'flash'
        : data.backend.name.includes('npu2b')
          ? 'qwen3.5:2b'
          : 'jev';
    for (const suite of all) {
      const source = data.rows.filter((item) => item.class === suite.source);
      if (!source.length) continue;
      const entry = DECISION_EVAL_SETS[suite.source]!;
      let index = 0;
      const latencies: number[] = [];
      const replay: EvalAsk = async (_context, questions) => {
        const item = entry.set.cases[index++]!;
        const rows = source.filter((row) => row.case === item.id);
        if (
          Object.keys(item.expected).some(
            (id) =>
              !rows.some(
                (row) =>
                  row.question === id &&
                  isDeepStrictEqual([...row.expected].sort(), [item.expected[id]!].flat().sort()),
              ),
          )
        )
          throw new Error('Historical fixture missing or labels changed');
        if (rows.some((row) => row.error)) throw new Error('Historical backend error');
        const first = rows[0]!;
        latencies.push(first.latencyMs);
        return {
          model: data.backend.model,
          latencyMs: first.latencyMs,
          inputTokens: first.inputTokens,
          outputTokens: first.outputTokens,
          answers: Object.fromEntries(
            Object.keys(questions).map((id) => {
              const row = rows.find((row) => row.question === id)!;
              return [
                id,
                { choice: row.choice ?? '', confidence: row.confidence, probabilities: {} },
              ];
            }),
          ),
        };
      };
      const report = await runDecisionEval(entry.set, entry.threshold, replay, { concurrency: 1 });
      const seconds = latencies.reduce((sum, value) => sum + value, 0) / 1000;
      const row: MatrixResult = {
        ...empty(backend, suite.id, 'measured', ''),
        source: `combo-eval/${filename} (historical replay)`,
        at: data.at,
        reason: undefined,
        score: report.precision,
        passed: report.passed && report.errors.length === 0,
        cases: entry.set.cases.length,
        p50: report.latencyP50Ms,
        p95: report.latencyP95Ms,
        tokensPerSecond: seconds > 0 ? report.outputTokens / seconds : null,
        toolErrors: report.errors.length,
        costUsd: backend === 'jev' ? (report.inputTokens * 0.042) / 1e6 : 0,
      };
      const path = join(raw, `${safe(backend)}--${suite.id}.json`);
      try {
        const existing = JSON.parse(await readFile(path, 'utf8')) as { row: MatrixResult };
        if (existing.row.source === '148' && existing.row.status === 'measured') continue;
      } catch {
        /* First import. */
      }
      await writeFile(
        path,
        JSON.stringify({ row, detail: { report, provenance: filename } }, null, 2),
      );
    }
  }
}
export function markdown(results: MatrixResult[], suites: MatrixSuite[]) {
  const show = (value: number | null) =>
    value === null ? '–' : Number(value.toFixed(3)).toString();
  const lines = [
    '# Eval-Matrix 2026-09-30',
    '',
    'Dry-run: no schema writes. Scores for decisions are precision at the class threshold; coverage must also pass the source eval. Browser: all 20 fixtures, strict page/status checks and no false done. Costs are USD API token costs; local energy costs and subscription judges are not included. Unknown metrics remain blank.',
    '',
    'Run: `bun apps/api/src/scripts/eval-matrix.ts --run --backends flash --roles home --judge-cli codex`; 27B requires `--profile local-27b-npu`. `--import-combo` replays existing synthetic decision rows against current labels. The default reads stored results and writes the report plus `~/agent-work/eval-matrix/schema-dry-run.json`; only `--apply-schema` writes database placements through the existing matrix validator.',
    '',
    'Window markers: `need-qwen3.5-2b`, `need-qwen3.5-4b`, `need-gemma4-it-e2b`, `need-gemma4-it-e4b`, `need-27b` under `~/agent-work/eval-matrix/`. Claude provides a newer matching `ready-*` file, optionally with JSON `{"base":"http://127.0.0.1:52625/v1","model":"qwen3.5:2b"}`; the runner writes `done-*` after the window. Missing windows remain open. A ready marker must match the loaded model. Jev runs use only `combo-eval/with-jev-key.ts`; the browser variants use the existing `combo-eval/bg` harness. NPU schema writes retain the existing requirement for a passed FLM database eval; raw files alone do not bypass that gate.',
    '',
    '| Role | Suite | Backend | Status | Score | p50 ms | p95 ms | tok/s | Tool errors | USD | Source / open reason |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const role of MODEL_ROLES)
    for (const suite of ROLE_SUITES[role].filter((entry) =>
      suites.some((selected) => selected.id === entry.id),
    ))
      for (const backend of MATRIX_BACKENDS) {
        const row =
          results.find((item) => item.backend === backend.id && item.suite === suite.id) ??
          empty(backend.id, suite.id, 'open', 'Not measured');
        lines.push(
          `| ${role} | ${suite.id} | ${backend.id} | ${row.status}${row.status === 'measured' ? (row.passed ? '/passed' : '/failed') : ''} | ${show(row.score)} | ${show(row.p50)} | ${show(row.p95)} | ${show(row.tokensPerSecond)} | ${show(row.toolErrors)} | ${show(row.costUsd)} | ${row.source} ${row.reason ?? ''} |`,
        );
      }
  lines.push(
    '',
    '| Profile | Role | Recommended backend | Model | Reasoning |',
    '|---|---|---|---|---|',
  );
  for (const profile of ['local-halogen', 'local-27b-npu'] as const)
    for (const role of MODEL_ROLES) {
      const runtime =
        MODEL_TEMPLATES.gemischt!.roles[role]!.runtime === 'claude' ? 'claude' : 'codex';
      const recommendation = roleRecommendation(role, results, profile, runtime);
      lines.push(
        `| ${profile} | ${role} | ${recommendation.backend} | ${recommendation.model} | ${recommendation.reasoning} |`,
      );
    }
  lines.push('', '| Profile | Class | Recommended backend | Cloud fallback |', '|---|---|---|---|');
  for (const profile of ['local-halogen', 'local-27b-npu'] as const)
    for (const suite of suites) {
      const winner = recommend(suite, results, profile);
      lines.push(
        `| ${profile} | ${suite.placement} | ${winner?.backend ?? 'cloud'} | ${CLOUD_AGENT_MODELS.codex} / ${CLOUD_AGENT_MODELS.claude} |`,
      );
    }
  return `${lines.join('\n')}\n`;
}
async function main() {
  await mkdir(raw, { recursive: true });
  const profile = arg('profile', 'local-halogen');
  if (!['local-halogen', 'local-27b-npu'].includes(profile!)) throw new Error('Unknown profile');
  const waitMs = Number(arg('wait-ms', '1000'));
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 60000)
    throw new Error('wait-ms must be between 0 and 60000');
  const roles = arg('roles', MODEL_ROLES.join(','))!.split(',') as ModelRole[];
  if (roles.some((role) => !MODEL_ROLES.includes(role))) throw new Error('Unknown role');
  if (arg('judge-cli') && !['claude', 'codex'].includes(arg('judge-cli')!))
    throw new Error('Unknown judge CLI');
  const suites = [
    ...new Map(
      roles.flatMap((role) => ROLE_SUITES[role]).map((suite) => [suite.id, suite]),
    ).values(),
  ].filter((suite) => !arg('suites') || arg('suites')!.split(',').includes(suite.id));
  const ids = arg('backends', MATRIX_BACKENDS.map((item) => item.id).join(','))!.split(',');
  if (ids.some((id) => !MATRIX_BACKENDS.some((backend) => backend.id === id)))
    throw new Error('Unknown backend');
  const backends = MATRIX_BACKENDS.filter((backend) => ids.includes(backend.id)).map((backend) => ({
    ...backend,
  }));
  if (arg('worker')) {
    const backend = backends.find((item) => item.id === arg('worker'))!;
    if (!(await ready(backend, 0))) throw new Error('Worker window unavailable');
    process.env.VOLITION_HALOGEN_PRIORITY = 'background';
    await worker(backend, suites);
    return;
  }
  if (process.argv.includes('--import-combo')) await importCombo();
  if (process.argv.includes('--run')) {
    for (const backend of backends) {
      const active = suites;
      if (backend.profile && backend.profile !== profile) continue;
      if (!(await ready(backend, waitMs))) {
        for (const suite of active)
          await writeFile(
            join(raw, `${safe(backend.id)}--${suite.id}.json`),
            JSON.stringify({
              row: empty(backend.id, suite.id, 'open', `Window missing: ready-${backend.marker}`),
            }),
          );
        continue;
      }
      let code = 0;
      const needsJev = (suite: MatrixSuite) =>
        backend.id === 'jev' ||
        Boolean(backend.stages?.includes('jev')) ||
        Boolean(suite.jevControl);
      for (const jev of [false, true]) {
        const group = active.filter((suite) => needsJev(suite) === jev);
        if (!group.length) continue;
        const args = [
          import.meta.path,
          '--worker',
          backend.id,
          '--backends',
          backend.id,
          '--profile',
          profile!,
          '--roles',
          roles.join(','),
          '--suites',
          group.map((suite) => suite.id).join(','),
          ...(arg('judge-cli') ? ['--judge-cli', arg('judge-cli')!] : []),
        ];
        const command = ['bun', ...args];
        const wrapped = jev
          ? ['bun', join(work, 'combo-eval/with-jev-key.ts'), '46', '--', ...command]
          : command;
        const gpu = backend.device === 'gpu' && backend.id !== '27b';
        const invocation = gpu
          ? [
              'flock',
              '-w',
              '1',
              join(work, 'halogen-bench.lock'),
              join(work, 'heavy.sh'),
              ...wrapped,
            ]
          : [join(work, 'heavy.sh'), ...wrapped];
        const status = await processRun(
          invocation[0]!,
          invocation.slice(1),
          join(raw, `${safe(backend.id)}-${jev ? 'jev' : 'local'}-run.log`),
        );
        code ||= status;
        if (status)
          for (const suite of group)
            await writeFile(
              join(raw, `${safe(backend.id)}--${suite.id}.json`),
              JSON.stringify({
                row: empty(
                  backend.id,
                  suite.id,
                  'open',
                  `Backend worker exited ${status}; see private local run log`,
                ),
              }),
            );
      }
      if (backend.marker)
        await writeFile(join(output, `done-${backend.marker}`), `${timestamp()} exit=${code}\n`);
    }
  }
  const results = await readResults();
  await writeFile(
    join(root, 'docs/eval-matrix-2026-09-30.md'),
    markdown(results, [
      ...new Map(
        Object.values(ROLE_SUITES)
          .flat()
          .map((suite) => [suite.id, suite]),
      ).values(),
    ]),
  );
  const preview = Object.values(MODEL_TEMPLATES).map((schema) => ({
    id: schema.id,
    ...schemaRecommendations(schema, results),
  }));
  await writeFile(join(output, 'schema-dry-run.json'), JSON.stringify(preview, null, 2));
  if (process.argv.includes('--apply-schema')) {
    const { readModelState, applyMatrix } = await import('../modules/model-schemas/service');
    const { closeDatabase } = await import('@repo/db');
    try {
      const state = await readModelState();
      const schemas = Object.values(state.schemas)
        .map((schema) => schemaRecommendations(schema, results))
        .filter((item) => item.changes.length)
        .map((item) => item.schema);
      if (schemas.length) await applyMatrix({ expectedRevision: state.revision, schemas });
    } finally {
      await closeDatabase();
    }
  }
  console.log(`Matrix: ${results.length} results, ${join(root, 'docs/eval-matrix-2026-09-30.md')}`);
}
if (import.meta.main) await main();
