// The eval harness of browser_task (docs/helena-decisions/browser-task.md §3.7): runs the task set
// (eval/tasks.ts) against a throwaway Chromium with each backend and records, per task, whether
// the page shows the outcome, the status, the time, the decisions and the tokens. No Helena, no
// project browser, no key needed for the mock; real backends take their key from an environment
// variable named in the config. jev-browser runs unchanged on the same backend for comparison.
//
//   node packages/browser-gateway/eval/run-eval.ts \
//     --chromium /usr/bin/chromium --set local \
//     --backends '[{"name":"mock","kind":"mock"},
//                  {"name":"jev","kind":"systemone","url":"https://api.typesafe.ai","keyEnv":"TYPESAFE_KEY","model":"jev-latest"}]' \
//     --out eval/results/2026-09-24.json
//
// The fixture site (eval/fixture-site.mjs) is started here for the "local" set.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PatchrightGatewaySession } from '../src/session.ts';
import { runTask } from '../src/task/loop.ts';
import { mockAnswers } from '../src/task/mock-backend.ts';
import { jevPolicy } from '../src/task/policy-jev.ts';
import { DirectDecisionClient, replyOf, type DecisionClient } from '../src/task/systemone.ts';
import type { TaskResult } from '../src/task/types.ts';
import { PUBLIC_TASKS, localTasks, type EvalTask, type FinalPage } from './tasks.ts';

interface BackendConfig {
  name: string;
  kind: 'mock' | 'systemone' | 'jev-browser';
  url?: string;
  keyEnv?: string;
  model?: string;
}

interface EvalRow {
  backend: string;
  task: string;
  set: string;
  status: string;
  correct: boolean;
  steps: number;
  decisions: number;
  inputTokens: number;
  durationMs: number;
  decisionMsAvg: number | null;
  model: string | null;
  error?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const here = path.dirname(new URL(import.meta.url).pathname);
const set = arg('set', 'local')!;
const chromium = arg('chromium', '/usr/bin/chromium')!;
const cdpPort = Number(arg('cdp-port', '19650'));
const sitePort = Number(arg('site-port', '18650'));
const only = arg('only')?.split(',');
const backends: BackendConfig[] = JSON.parse(arg('backends', '[{"name":"mock","kind":"mock"}]')!);
const out = arg('out');

const children: ChildProcess[] = [];
async function waitFor(url: string, tries = 80): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`${url} did not come up`);
}

function mockClient(): DecisionClient {
  return {
    async decide(request) {
      const started = performance.now();
      return replyOf(
        mockAnswers({ ...request, model: 'mock-1' } as never),
        Math.round(performance.now() - started),
      );
    },
  };
}

async function finalPage(session: PatchrightGatewaySession): Promise<FinalPage> {
  const status = await session.status().catch(() => null);
  if (status?.dialogOpen) await session.dialogAction(false).catch(() => {});
  const observation = await session.taskPage().observe();
  return {
    url: observation.url,
    title: observation.title,
    text: `${observation.title} ${observation.text} ${observation.elements.map((e) => e.text ?? '').join(' ')}`,
    checked: observation.elements
      .filter((e) => e.checked === true)
      .map((e) => e.label ?? e.text ?? ''),
  };
}

async function runOurs(
  backend: BackendConfig,
  task: EvalTask,
  session: PatchrightGatewaySession,
): Promise<TaskResult> {
  const client =
    backend.kind === 'mock'
      ? mockClient()
      : new DirectDecisionClient({
          baseUrl: backend.url!,
          key: backend.keyEnv ? process.env[backend.keyEnv] : null,
          model: backend.model ?? 'jev-latest',
        });
  const policy = jevPolicy;
  await session.navigate(task.startUrl);
  return runTask(
    {
      goal: task.goal,
      values: task.values ?? {},
      mode: task.mode,
      maxSteps: task.maxSteps,
      allowIrreversible: false,
    },
    {
      page: session.taskPage(),
      client,
      policy,
      authorize: async () => ({ effect: 'allow' }),
      holdsControl: () => true,
    },
  );
}

// jev-browser, unchanged, on its own context of the same throwaway browser; its System One calls
// go to the configured backend (JEV_API_URL/TYPESAFE_API_KEY are read once, at import).
async function runJevBrowser(backend: BackendConfig, task: EvalTask, cdpUrl: string) {
  process.env.JEV_API_URL = `${backend.url!.replace(/\/+$/, '')}/v1/systemone`;
  process.env.TYPESAFE_API_KEY = (backend.keyEnv && process.env[backend.keyEnv]) || 'none';
  process.env.JEV_MODEL = backend.model ?? 'jev-latest';
  interface JevPage {
    url(): string;
    title(): Promise<string>;
    innerText(selector: string): Promise<string>;
    $$eval(selector: string, fn: (nodes: Element[]) => string[]): Promise<string[]>;
  }
  interface JevLike {
    page: JevPage;
    stats?: { calls: number; jev_ms: number; tokens: number };
    open(url: string): Promise<unknown>;
    do(
      goal: string,
      options: object,
    ): Promise<{ status?: unknown; actions?: unknown; jev_calls?: unknown }>;
    close(): Promise<void>;
  }
  const { JevBrowser } = (await import('jev-browser')) as {
    JevBrowser: { launch(options: object): Promise<JevLike> };
  };
  const { chromium: pw } = await import('playwright-core');
  const browser = await pw.connectOverCDP(cdpUrl);
  const started = Date.now();
  const jev = await JevBrowser.launch({ browser });
  try {
    await jev.open(task.startUrl);
    const result = await jev.do(task.goal, {
      values: task.values ?? {},
      maxActions: task.maxSteps,
    });
    const page = jev.page;
    const final: FinalPage = {
      url: page.url(),
      title: await page.title().catch(() => ''),
      text: `${await page.title().catch(() => '')} ${await page.innerText('body').catch(() => '')}`,
      checked: await page
        .$$eval('input[type=checkbox]:checked, input[type=radio]:checked', (nodes: Element[]) =>
          nodes.map(() => 'x'),
        )
        .catch(() => []),
    };
    return {
      status: String(result.status),
      final,
      steps: Array.isArray(result.actions)
        ? result.actions.filter((a: { action?: string }) => a.action).length
        : 0,
      decisions: Number(result.jev_calls ?? 0),
      inputTokens: Number(jev.stats?.tokens ?? 0),
      durationMs: Date.now() - started,
      decisionMsAvg: jev.stats?.calls ? Math.round(jev.stats.jev_ms / jev.stats.calls) : null,
    };
  } finally {
    await jev.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function main() {
  const work = await mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'helena-eval-'));
  const tasks = [
    ...(set === 'public' ? [] : localTasks(`http://127.0.0.1:${sitePort}`)),
    ...(set === 'local' ? [] : PUBLIC_TASKS),
  ].filter((task) => !only || only.includes(task.id));
  const rows: EvalRow[] = [];
  try {
    if (set !== 'public') {
      children.push(
        spawn(process.execPath, [path.join(here, 'fixture-site.mjs'), String(sitePort)], {
          stdio: 'ignore',
        }),
      );
      await waitFor(`http://127.0.0.1:${sitePort}/`);
    }
    children.push(
      spawn(
        chromium,
        [
          '--headless=new',
          `--user-data-dir=${path.join(work, 'profile')}`,
          `--remote-debugging-port=${cdpPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--no-first-run',
          '--no-default-browser-check',
          '--lang=de-DE',
          '--window-size=1280,900',
          'about:blank',
        ],
        { stdio: 'ignore' },
      ),
    );
    const cdpUrl = `http://127.0.0.1:${cdpPort}`;
    await waitFor(`${cdpUrl}/json/version`);
    const session = await PatchrightGatewaySession.connect(cdpUrl, { humanInput: false });
    for (const backend of backends) {
      for (const task of tasks) {
        const label = `${backend.name.padEnd(18)} ${task.id.padEnd(24)}`;
        try {
          if (backend.kind === 'jev-browser') {
            const r = await runJevBrowser(backend, task, cdpUrl);
            const statusOk = task.expectStatus
              ? task.expectStatus.includes(r.status as never) || r.status === 'needs_confirmation'
              : ['done', 'likely_done'].includes(r.status);
            const row: EvalRow = {
              backend: backend.name,
              task: task.id,
              set: task.set,
              status: r.status,
              correct: statusOk && task.check(r.final),
              steps: r.steps,
              decisions: r.decisions,
              inputTokens: r.inputTokens,
              durationMs: r.durationMs,
              decisionMsAvg: r.decisionMsAvg,
              model: backend.model ?? null,
            };
            rows.push(row);
          } else {
            const result = await runOurs(backend, task, session);
            const final = await finalPage(session);
            const statusOk = task.expectStatus
              ? task.expectStatus.includes(result.status)
              : ['done', 'likely_done'].includes(result.status);
            rows.push({
              backend: backend.name,
              task: task.id,
              set: task.set,
              status: result.status,
              correct: statusOk && task.check(final),
              steps: result.steps.length,
              decisions: result.usage.calls,
              inputTokens: result.usage.inputTokens,
              durationMs: result.durationMs,
              decisionMsAvg: result.usage.calls
                ? Math.round(result.usage.decisionMs / result.usage.calls)
                : null,
              model: result.usage.model,
            });
          }
        } catch (error) {
          rows.push({
            backend: backend.name,
            task: task.id,
            set: task.set,
            status: 'exception',
            correct: false,
            steps: 0,
            decisions: 0,
            inputTokens: 0,
            durationMs: 0,
            decisionMsAvg: null,
            model: null,
            error: (error instanceof Error ? error.message : String(error))
              .split('\n')[0]!
              .slice(0, 200),
          });
        }
        const row = rows[rows.length - 1]!;
        console.log(
          `${label} ${row.correct ? 'OK  ' : 'MISS'} ${row.status.padEnd(18)} ${String(row.steps).padStart(2)} steps ${String(row.decisions).padStart(2)} calls ${String(row.inputTokens).padStart(6)} tok ${(row.durationMs / 1000).toFixed(1).padStart(5)} s${row.decisionMsAvg !== null ? ` ${row.decisionMsAvg} ms/call` : ''}${row.error ? ` ${row.error}` : ''}`,
        );
      }
    }
  } finally {
    for (const child of children) child.kill();
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
  const summary = backends.map((backend) => {
    const mine = rows.filter((row) => row.backend === backend.name);
    const correct = mine.filter((row) => row.correct).length;
    const time = mine.reduce((sum, row) => sum + row.durationMs, 0);
    const tokens = mine.reduce((sum, row) => sum + row.inputTokens, 0);
    const calls = mine.reduce((sum, row) => sum + row.decisions, 0);
    const perCall = mine.filter((row) => row.decisionMsAvg !== null);
    return {
      backend: backend.name,
      correct,
      tasks: mine.length,
      seconds: Math.round(time / 100) / 10,
      decisions: calls,
      inputTokens: tokens,
      msPerDecision: perCall.length
        ? Math.round(perCall.reduce((sum, row) => sum + row.decisionMsAvg!, 0) / perCall.length)
        : null,
    };
  });
  console.log('\n| backend | correct | total time | decisions | input tokens | ms/decision |');
  console.log('|---|---|---|---|---|---|');
  for (const s of summary) {
    console.log(
      `| ${s.backend} | ${s.correct}/${s.tasks} | ${s.seconds} s | ${s.decisions} | ${s.inputTokens} | ${s.msPerDecision ?? '–'} |`,
    );
  }
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(
      out,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          set,
          backends: backends.map(({ keyEnv: _k, ...b }) => b),
          summary,
          rows,
        },
        null,
        2,
      ),
    );
  }
}

await main();
