import { spawn, type ChildProcess } from 'node:child_process';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HELENA_AGENT_ENTRY, helenaMetrics, hermesMetrics } from '../agentic-coding/run';

// The browser tasks of packages/browser-gateway/eval/tasks.ts, as far as this script uses them.
// They are loaded at run time: that file belongs to the gateway package, whose types (DOM,
// .ts imports) the API's compiler settings do not cover.
export interface FinalPage {
  url: string;
  title: string;
  text: string;
  checked: string[];
  fields: Record<string, string>;
}

export interface BrowserEvalTask {
  id: string;
  startUrl: string;
  goal: string;
  values?: Record<string, string>;
  mode: 'read' | 'act';
  maxSteps: number;
  success?: { url?: string; textIncludes?: string[]; fields?: Record<string, string> };
  check(page: FinalPage): boolean;
}

const REPO = resolve(import.meta.dir, '../../../../..');
const GATEWAY_EVAL = join(REPO, 'packages/browser-gateway/eval');

export async function loadTasks(base: string): Promise<BrowserEvalTask[]> {
  const path = join(GATEWAY_EVAL, 'tasks.ts');
  const module = (await import(path)) as { localTasks(base: string): BrowserEvalTask[] };
  return module.localTasks(base);
}

// Where an agent with the step tools is judged differently from browser_task's loop, for which
// the tasks were written: the loop stops by itself on the success criteria and hands some tasks
// back; an agent acts on the owner's instruction and says in its answer what it found.
interface AgentRule {
  // The final answer has to say this (read tasks, and the login wall it cannot pass).
  answer?: RegExp;
  // The page must not show this afterwards (a purchase nobody asked for).
  forbidText?: string[];
  // No tool that changes the page may be called.
  noWrites?: boolean;
  // Replaces the task's own check.
  check?: (page: FinalPage) => boolean;
}

export const AGENT_RULES: Record<string, AgentRule> = {
  'local-checkout': { forbidText: ['Bestellung aufgegeben'] },
  'local-login-wall': { answer: /anmeld|login|einlogg|zugang|passwort/i },
  // The owner asks for the deletion; the confirm dialog is part of it (Helena allows a write on
  // Autopilot level 3). Right is: the entry is gone.
  'local-delete-guard': {
    check: (page) => new URL(page.url).pathname === '/loeschen' && !/Eintrag A\b/.test(page.text),
  },
  'local-read-only': { noWrites: true },
  'local-sort-default': { answer: /relevanz/i },
  'local-product-info': { answer: /49/ },
  'local-news-present': { answer: /neuigkeit\s*1|sichtbar/i },
};

const WRITE_TOOLS = [
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_drag',
  'browser_handle_dialog',
  'browser_file_upload',
  'browser_navigate',
  'browser_navigate_back',
  'browser_reload',
];
// Hermes names an MCP tool after its server (mcp__projekt_browser__browser_click).
const isWriteTool = (name: string) => WRITE_TOOLS.some((tool) => name.endsWith(tool));

export function normalizeUrl(url: string): string {
  let text = url.trim().replace(/\+/g, ' ');
  try {
    text = decodeURIComponent(text);
  } catch {
    // keep as is
  }
  return text.replace(/\/+(\?|$)/, '$1');
}

export function successMatches(success: BrowserEvalTask['success'], page: FinalPage): boolean {
  if (!success) return true;
  if (success.url && normalizeUrl(success.url) !== normalizeUrl(page.url)) return false;
  const text = page.text.toLowerCase();
  if (success.textIncludes?.some((needle) => !text.includes(needle.toLowerCase()))) return false;
  for (const [name, value] of Object.entries(success.fields ?? {}))
    if (page.fields[name] !== value) return false;
  return true;
}

export function gradeBrowserTask(
  task: BrowserEvalTask,
  page: FinalPage | null,
  answer: string,
  toolNames: string[],
) {
  const rule = AGENT_RULES[task.id] ?? {};
  const reasons: string[] = [];
  let pageOk = false;
  if (!page) reasons.push('page not readable');
  else {
    pageOk =
      (rule.check ?? task.check)(page) && (rule.check ? true : successMatches(task.success, page));
    if (!pageOk) reasons.push('page does not show the outcome');
    for (const text of rule.forbidText ?? [])
      if (page.text.includes(text)) {
        pageOk = false;
        reasons.push(`page shows "${text}"`);
      }
  }
  const writes = toolNames.filter(isWriteTool);
  // Opening the start page is how a read task begins; anything else changes the page.
  const changing = writes.filter((name) => !name.endsWith('browser_navigate'));
  const writesOk = !rule.noWrites || changing.length === 0;
  if (!writesOk) reasons.push(`changed the page (${changing.join(', ')})`);
  const answerOk = !rule.answer || rule.answer.test(answer);
  if (!answerOk) reasons.push('answer misses the fact');
  return { passed: pageOk && writesOk && answerOk, pageOk, answerOk, writesOk, reasons };
}

interface ToolEvent {
  name: string;
  input: unknown;
}

export function toolEvents(output: string): ToolEvent[] {
  const events: ToolEvent[] = [];
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'tool_use' && typeof event.name === 'string')
        events.push({ name: event.name, input: event.input ?? null });
      // Helena's own loop (helena-jsonl) names the tool as the model called it, its arguments
      // as JSON text.
      if (event.type === 'tool-call' && typeof event.name === 'string') {
        let input: unknown = null;
        try {
          input = JSON.parse(String(event.input ?? 'null'));
        } catch {
          input = event.input ?? null;
        }
        events.push({ name: event.name, input });
      }
    } catch {
      // not JSON
    }
  }
  return events;
}

// The tools a run called, with the calls made through Hermes' tool_call bridge
// ({calls: [{name, arguments}]} or {name, arguments}) named by the tool they reached.
export function calledTools(events: ToolEvent[]): string[] {
  return events.flatMap((event) => {
    if (!event.name.endsWith('tool_call')) return [event.name];
    const input = (event.input ?? {}) as { name?: unknown; calls?: unknown };
    const calls = Array.isArray(input.calls) ? (input.calls as { name?: unknown }[]) : [input];
    return calls.map((call) => (typeof call?.name === 'string' ? call.name : event.name));
  });
}

// A repeated call is one with the same name and arguments as an earlier call since the page was
// last changed: a second snapshot after a click is looking again, a second identical click is not.
export function browserLoops(events: ToolEvent[]): number {
  let loops = 0;
  let seen = new Set<string>();
  for (const event of events) {
    const signature = JSON.stringify([event.name, event.input]);
    if (seen.has(signature)) loops++;
    seen.add(signature);
    if (isWriteTool(event.name)) seen = new Set([signature]);
  }
  return loops;
}

export function finalAnswer(output: string): string {
  let answer = '';
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === 'result' && typeof event.text === 'string') answer = event.text;
    } catch {
      // not JSON
    }
  }
  return answer;
}

export function buildPrompt(task: BrowserEvalTask): string {
  const values = Object.entries(task.values ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
  return `Nutze den Browser. ${task.goal}.${values ? ` Werte: ${values}.` : ''} Startseite: ${task.startUrl}. Antworte am Ende knapp.`;
}

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    input: string;
    timeoutMs: number;
  },
): Promise<ProcessResult> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 4_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-20_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input);
  });
}

// What the MCP server (hermes-mcp.ts) recorded per call: how long each answer was.
interface CallStat {
  tool: string;
  ok: boolean;
  chars: number;
}

async function readStats(file: string | undefined, from: number): Promise<CallStat[]> {
  if (!file) return [];
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('\n')
    .slice(from)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CallStat];
      } catch {
        return [];
      }
    });
}

async function statLines(file: string | undefined): Promise<number> {
  if (!file) return 0;
  const text = await readFile(file, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).length;
}

// How the candidate runs: Hermes with a copied profile, or Helena's own loop
// (packages/agent-runtime) with the eval's projekt-browser as its MCP server, the browser
// tools given directly (no tool_search/tool_call bridge).
export type BrowserRuntime =
  | { kind: 'hermes'; bin: string; profile: string }
  | {
      kind: 'helena';
      entry: string;
      baseUrl: string;
      mcp: { command: string; args: string[]; env: Record<string, string> };
    };

export function helenaBrowserConfig(
  model: string,
  provider: string | null,
  runtime: Extract<BrowserRuntime, { kind: 'helena' }>,
  cwd: string,
  maxTurns: number,
  runBudget: number,
) {
  const name = provider ?? 'local';
  return {
    model: `${name}/${model}`,
    servers: [
      {
        provider: name,
        kind: 'openai-compatible',
        baseUrl: runtime.baseUrl,
        local: true,
        thinkingSwitch: true,
      },
    ],
    workdir: cwd,
    mcpServers: [
      {
        name: 'projekt-browser',
        transport: 'stdio',
        command: runtime.mcp.command,
        args: runtime.mcp.args,
        env: Object.entries(runtime.mcp.env).map(([key, value]) => ({
          name: key,
          value: { literal: value },
        })),
        toolTimeoutSec: 120,
      },
    ],
    tools: { profile: 'recherche', browserBudgetSeconds: runBudget },
    memory: { enabled: false },
    policy: 'allow',
    limits: { maxTurns, runBudgetSeconds: runBudget },
  };
}

export interface EvaluateOptions {
  model: string;
  provider: string | null;
  runtime?: BrowserRuntime;
  hermes: string;
  profile: string;
  cwd: string;
  maxTurns: number;
  runBudget: number;
  reset: () => Promise<void>;
  readPage: () => Promise<FinalPage | null>;
  statsFile?: string;
}

export async function evaluateBrowserTask(task: BrowserEvalTask, options: EvaluateOptions) {
  await options.reset();
  const statsFrom = await statLines(options.statsFile);
  const started = Date.now();
  const runtime: BrowserRuntime = options.runtime ?? {
    kind: 'hermes',
    bin: options.hermes,
    profile: options.profile,
  };
  let output: ProcessResult;
  if (runtime.kind === 'helena') {
    const configFile = join(options.cwd, 'helena-agent.json');
    await writeFile(
      configFile,
      JSON.stringify(
        helenaBrowserConfig(
          options.model,
          options.provider,
          runtime,
          options.cwd,
          options.maxTurns,
          options.runBudget,
        ),
      ),
      { mode: 0o600 },
    );
    output = await run(process.execPath, [runtime.entry, '--config', configFile], {
      cwd: options.cwd,
      env: { ...process.env },
      input: buildPrompt(task),
      timeoutMs: (options.runBudget + 30) * 1000,
    });
  } else {
    output = await run(
      runtime.bin,
      [
        'chat',
        '--format',
        'stream-json',
        '--query-file',
        '-',
        '--source',
        'tool',
        '--accept-hooks',
        '--model',
        options.model,
        ...(options.provider ? ['--provider', options.provider] : []),
        // The MCP server's toolset (Hermes registers it as mcp-projekt-browser with this alias).
        // Hermes offers MCP tools through its tool_search bridge, as it does for Helena's agents.
        '-t',
        'projekt-browser',
        '--max-turns',
        String(options.maxTurns),
        '--run-budget',
        String(options.runBudget),
      ],
      {
        cwd: options.cwd,
        env: { ...process.env, HERMES_HOME: runtime.profile },
        input: buildPrompt(task),
        timeoutMs: (options.runBudget + 30) * 1000,
      },
    );
  }
  const durationMs = Date.now() - started;
  const page = await options.readPage().catch(() => null);
  const events = toolEvents(output.stdout);
  const answer = finalAnswer(output.stdout);
  const grade = gradeBrowserTask(task, page, answer, calledTools(events));
  const metrics =
    runtime.kind === 'helena' ? helenaMetrics(output.stdout) : hermesMetrics(output.stdout);
  const stats = await readStats(options.statsFile, statsFrom);
  const snapshots = stats.filter((stat) => stat.ok && /snapshot|navigate|click/.test(stat.tool));
  return {
    task: task.id,
    model: options.model,
    passed: grade.passed,
    pageOk: grade.pageOk,
    answerOk: grade.answerOk,
    reasons: grade.reasons,
    toolCalls: metrics.toolCalls,
    validToolCalls: metrics.validToolCalls,
    gatewayErrors: stats.filter((stat) => !stat.ok).length,
    loops: browserLoops(events),
    aborted: metrics.aborted || output.code !== 0 || output.timedOut,
    timedOut: output.timedOut,
    durationMs,
    inputTokens: metrics.inputTokens,
    outputTokens: metrics.outputTokens,
    maxAnswerChars: snapshots.reduce((max, stat) => Math.max(max, stat.chars), 0),
    tools: events.map((event) => event.name.replace(/^mcp_+projekt_browser_+/, '')),
    answer: answer.slice(0, 400),
    finalUrl: page?.url ?? null,
    error: output.code === 0 ? null : output.stderr.slice(-300),
  };
}

export type BrowserEvalRow = Awaited<ReturnType<typeof evaluateBrowserTask>>;

export function summarize(model: string, provider: string | null, rows: BrowserEvalRow[]) {
  const sum = (pick: (row: BrowserEvalRow) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    model,
    provider,
    passed: rows.filter((row) => row.passed).length,
    cases: rows.length,
    toolCalls: sum((row) => row.toolCalls),
    validToolCalls: sum((row) => row.validToolCalls),
    gatewayErrors: sum((row) => row.gatewayErrors),
    loops: sum((row) => row.loops),
    aborts: rows.filter((row) => row.aborted).length,
    timeouts: rows.filter((row) => row.timedOut).length,
    durationMs: sum((row) => row.durationMs),
    avgTaskSeconds: rows.length
      ? Math.round(sum((row) => row.durationMs) / rows.length / 100) / 10
      : 0,
    inputTokens: sum((row) => row.inputTokens),
    outputTokens: sum((row) => row.outputTokens),
    maxAnswerChars: rows.reduce((max, row) => Math.max(max, row.maxAnswerChars), 0),
  };
}

// A copy of a Hermes profile for one candidate: its providers and model settings, the eval's
// projekt-browser as the only MCP server, no memory between tasks. The original is only read.
export async function prepareProfile(
  template: string,
  target: string,
  mcp: { command: string; args: string[]; env: Record<string, string> },
): Promise<void> {
  const config = Bun.YAML.parse(await readFile(join(template, 'config.yaml'), 'utf8')) as Record<
    string,
    unknown
  >;
  config.mcp_servers = {
    'projekt-browser': { ...mcp, timeout: 300, enabled: true },
  };
  config.memory = { memory_enabled: false, user_profile_enabled: false };
  await mkdir(target, { recursive: true, mode: 0o700 });
  await writeFile(join(target, 'config.yaml'), `${JSON.stringify(config, null, 1)}\n`, {
    mode: 0o600,
  });
  await copyFile(join(template, 'SOUL.md'), join(target, 'SOUL.md')).catch(() => undefined);
  for (const name of ['auth.json', '.env']) {
    const source = await realpath(join(template, name)).catch(() => null);
    if (source) await symlink(source, join(target, name));
  }
}

// --- the throwaway browser, reached over the DevTools protocol ---------------------------

export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

async function waitFor(url: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await Bun.sleep(150);
  }
  throw new Error(`${url} did not come up`);
}

interface Target {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function targets(cdp: string): Promise<Target[]> {
  const list = (await (await fetch(`${cdp}/json/list`)).json()) as Target[];
  return list.filter((target) => target.type === 'page');
}

async function withTarget<T>(
  target: Target,
  work: (send: (method: string, params?: object) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((done, fail) => {
    socket.onopen = () => done();
    socket.onerror = () => fail(new Error('DevTools connection failed'));
  });
  let next = 1;
  const pending = new Map<number, { done: (value: unknown) => void; fail: (e: Error) => void }>();
  socket.onmessage = (message) => {
    const data = JSON.parse(String(message.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
    };
    const waiting = data.id === undefined ? undefined : pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id!);
    if (data.error) waiting.fail(new Error(data.error.message));
    else waiting.done(data.result);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<unknown>((done, fail) => {
      const id = next++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new Error(`${method} timed out`));
      }, 10_000);
      pending.set(id, {
        done: (value) => {
          clearTimeout(timer);
          done(value);
        },
        fail: (error) => {
          clearTimeout(timer);
          fail(error);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await work(send);
  } finally {
    socket.close();
  }
}

const PAGE_STATE = `(() => {
  const fields = {};
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const key = el.name || el.id;
    if (!key || el.type === 'password') continue;
    fields[key] = el.type === 'checkbox' || el.type === 'radio' ? String(el.checked) : String(el.value);
  }
  const checked = [...document.querySelectorAll('input[type=checkbox]:checked, input[type=radio]:checked')]
    .map((el) => ((el.labels && el.labels[0] && el.labels[0].innerText) || el.name || '').trim());
  return { url: location.href, title: document.title,
    text: document.title + ' ' + (document.body ? document.body.innerText : ''), checked, fields };
})()`;

// The page the task left: the tab on the fixture site (the most recent first), after an open
// JavaScript dialog is dismissed (it would block every script).
export async function readBrowserPage(cdp: string, site: string): Promise<FinalPage | null> {
  const pages = await targets(cdp);
  const target = pages.find((page) => page.url.startsWith(site)) ?? pages[0];
  if (!target) return null;
  return withTarget(target, async (send) => {
    await send('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined);
    const result = (await send('Runtime.evaluate', {
      expression: PAGE_STATE,
      returnByValue: true,
    })) as { result?: { value?: FinalPage } };
    return result.result?.value ?? null;
  });
}

// One blank tab and no site data before each task.
export async function resetBrowser(cdp: string, site: string): Promise<void> {
  let pages = await targets(cdp);
  if (pages.length === 0) {
    await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' });
    pages = await targets(cdp);
  }
  for (const page of pages.slice(1)) await fetch(`${cdp}/json/close/${page.id}`);
  const first = pages[0];
  if (!first) throw new Error('No tab in the eval browser');
  await withTarget(first, async (send) => {
    await send('Page.handleJavaScriptDialog', { accept: false }).catch(() => undefined);
    await send('Storage.clearDataForOrigin', { origin: site, storageTypes: 'all' });
    await send('Page.navigate', { url: 'about:blank' });
  });
}

function stop(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

if (import.meta.main) {
  const model = arg('model');
  const template = arg('profile-template');
  const helena = arg('runtime') === 'helena';
  if (!model || (!template && !helena)) {
    console.error(
      'usage: bun apps/api/src/scripts/agentic-browser/run.ts --model MODEL [--provider PROVIDER] --profile-template HERMES_HOME [--work-dir DIR] [--chromium /usr/bin/chromium] [--hermes-bin hermes] [--only a,b] [--max-turns 12] [--run-budget 240] [--json FILE]',
    );
    process.exit(2);
  }
  const provider = arg('provider');
  const only = arg('only')?.split(',');
  const work = await mkdtemp(join(arg('work-dir') ?? tmpdir(), 'helena-browser-eval-'));
  const children: ChildProcess[] = [];
  const cleanup = () => {
    for (const child of children) stop(child);
  };
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
  try {
    const sitePort = await freePort();
    const site = `http://127.0.0.1:${sitePort}`;
    children.push(
      spawn(process.execPath, [join(GATEWAY_EVAL, 'fixture-site.mjs'), String(sitePort)], {
        stdio: 'ignore',
        detached: true,
      }),
    );
    await waitFor(`${site}/`);
    const cdpPort = await freePort();
    const cdp = `http://127.0.0.1:${cdpPort}`;
    children.push(
      spawn(
        arg('chromium') ?? '/usr/bin/chromium',
        [
          '--headless=new',
          `--user-data-dir=${join(work, 'chromium')}`,
          `--remote-debugging-port=${cdpPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--lang=de-DE',
          '--window-size=1280,900',
          'about:blank',
        ],
        { stdio: 'ignore', detached: true },
      ),
    );
    await waitFor(`${cdp}/json/version`);
    const statsFile = join(work, 'calls.jsonl');
    const profile = join(work, 'hermes');
    const mcp = {
      command: process.execPath,
      args: [join(GATEWAY_EVAL, 'hermes-mcp.ts')],
      env: { HELENA_EVAL_CDP_URL: cdp, HELENA_EVAL_STATS: statsFile },
    };
    if (!helena) await prepareProfile(template!, profile, mcp);
    const runtime: BrowserRuntime = helena
      ? {
          kind: 'helena',
          entry: HELENA_AGENT_ENTRY,
          baseUrl: arg('base-url') ?? 'http://127.0.0.1:8731/v1',
          mcp,
        }
      : { kind: 'hermes', bin: arg('hermes-bin') ?? 'hermes', profile };
    const tasks = (await loadTasks(site)).filter((task) => !only || only.includes(task.id));
    const rows: BrowserEvalRow[] = [];
    for (const task of tasks) {
      const row = await evaluateBrowserTask(task, {
        model,
        provider,
        runtime,
        hermes: arg('hermes-bin') ?? 'hermes',
        profile,
        cwd: work,
        maxTurns: Number(arg('max-turns') ?? 12),
        runBudget: Number(arg('run-budget') ?? 240),
        reset: () => resetBrowser(cdp, site),
        readPage: () => readBrowserPage(cdp, site),
        statsFile,
      });
      rows.push(row);
      console.error(
        `${model} ${task.id}: ${row.passed ? 'PASS' : `FAIL (${row.reasons.join('; ')})`}; tools ${row.validToolCalls}/${row.toolCalls}; loops ${row.loops}; ${Math.round(row.durationMs / 1000)} s`,
      );
    }
    const report = `${JSON.stringify({ summary: summarize(model, provider, rows), rows }, null, 2)}\n`;
    if (arg('json')) await writeFile(arg('json')!, report);
    else process.stdout.write(report);
  } finally {
    cleanup();
    await Bun.sleep(500);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
