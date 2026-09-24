#!/usr/bin/env bun
/**
 * prove-hermes-sync.ts — proves on a live Helena that what is set for an agent reaches its
 * runtime exactly, per runtime (Hermes, Claude Code, Codex), and stays in sync after edits.
 *
 * For each runtime it keeps one test agent in the project (created once, reused on every
 * run: helena-e2e-hermes, helena-e2e-claude, helena-e2e-codex), gives it a fresh marker in
 * its instructions and a team skill with another marker, and starts one real run on a task
 * labeled "E2E-Test". The agent has to
 *   - quote the instruction marker            → the instructions reached it (SOUL / prompt)
 *   - quote the skill's marker                 → the skill reached it
 *   - read the task's description with Helena's MCP tools (it is not in the run's prompt)
 *                                              → Helena's MCP server works, with its key
 * and the run record has to name the model its session ran on, matching the configured one
 * (modelCheck without mismatch).
 *
 * Hermes runs on the server's own runner: the new agent must come online by itself
 * (provisioning writes its runtime, the runner restarts). Then the drift test: an edit in
 * Helena must reach its profile (the runtime sync turns "synced" on the new revision, and
 * SOUL.md holds the new marker), "Neu schreiben" must come back synced, and with --tamper a
 * config.yaml replaced by a plain file must be put back by the runner within two minutes.
 *
 * Claude Code and Codex agents run on a runner this script starts for the run, as the
 * current user (whose `claude` and `codex` are logged in), and stops afterwards.
 *
 * Run it on the server as the owner, after the deploy:
 *   HELENA_API_KEY=itp_... bun deployment/volition-stack/scripts/prove-hermes-sync.ts \
 *     [--base-url=http://127.0.0.1:3000] [--project=VOL] [--runtimes=hermes,claude,codex] \
 *     [--model-hermes=gpt-6-luna --reasoning-hermes=low] [--model-claude=...] [--model-codex=...]
 *     [--tamper] [--remove-agents] [--timeout-min=20] [--report=<file.json>]
 * HELENA_API_KEY is a personal API key of the owner (Konto → API-Schlüssel); it is sent as
 * x-api-key and never printed. The script needs `sudo` only for --tamper and to read
 * SOUL.md of the Hermes test agent's profile (no secret is read).
 *
 * Idempotent: agents, the skill and the label are reused; every run adds one task, labeled
 * E2E-Test. The test agents stay for the next proof; --remove-agents deletes them, which
 * removes the Hermes test runtime again (another runner restart). Creating the Hermes test
 * agent the first time restarts the server's runner once (provisioning), which hands the
 * runs in flight back to the queue. Exit code 0 when every check passed.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Runtime = 'hermes' | 'claude' | 'codex';

interface Options {
  // Per runtime: the model and reasoning the test agent is set to (empty: the runtime's own
  // default, "Agent default"). The run's model check compares them with what ran.
  models: Partial<Record<Runtime, { model: string | null; reasoning: string | null }>>;
  baseUrl: string;
  project: string;
  runtimes: Runtime[];
  tamper: boolean;
  removeAgents: boolean;
  timeoutMs: number;
  report: string | null;
  runner: string;
}

function options(argv: string[]): Options {
  const value = (name: string) =>
    argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const runtimes = (value('runtimes') ?? 'hermes,claude,codex')
    .split(',')
    .filter((name): name is Runtime => ['hermes', 'claude', 'codex'].includes(name));
  const models: Options['models'] = {};
  for (const runtime of ['hermes', 'claude', 'codex'] as const) {
    const model = value(`model-${runtime}`) ?? null;
    const reasoning = value(`reasoning-${runtime}`) ?? null;
    if (model || reasoning) models[runtime] = { model, reasoning };
  }
  return {
    models,
    baseUrl: (value('base-url') ?? 'http://127.0.0.1:3000').replace(/\/+$/, ''),
    project: value('project') ?? 'VOL',
    runtimes,
    tamper: argv.includes('--tamper'),
    removeAgents: argv.includes('--remove-agents'),
    timeoutMs: Number(value('timeout-min') ?? 20) * 60_000,
    report: value('report') ?? null,
    runner: value('runner') ?? '/srv/volition/source/plan/packages/runner/dist/cli.js',
  };
}

const opts = options(process.argv.slice(2));
const apiKey = process.env.HELENA_API_KEY?.trim();
if (!apiKey) {
  console.error('HELENA_API_KEY is not set (a personal API key of the owner).');
  process.exit(2);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${opts.baseUrl}${path}`, {
    method,
    headers: {
      'x-api-key': apiKey!,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(
  what: string,
  read: () => Promise<T | null | undefined | false>,
  timeoutMs: number,
  everyMs = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown = null;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(everyMs);
  }
  throw new Error(`Timed out waiting for ${what}${last ? ` (${String(last)})` : ''}`);
}

// ── Report ────────────────────────────────────────────────────────────────────────────

interface Check {
  runtime: Runtime | 'all';
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const evidence: Record<string, unknown> = {};

function check(runtime: Check['runtime'], name: string, ok: boolean, detail = ''): void {
  checks.push({ runtime, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${runtime}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Helena objects ────────────────────────────────────────────────────────────────────

interface Agent {
  id: number;
  userId: string;
  username: string;
  runtimeState: {
    adapter: string | null;
    status: string;
    restored: string[];
    profile: { drift: { key: string; code: string }[]; hash: string } | null;
  };
  runtimePolicy: Record<string, unknown>;
}

interface RuntimeSync {
  state: string;
  revision: string;
  appliedRevision: string | null;
  rewritePending: boolean;
  profile: { hash: string; drift: { key: string; code: string; detail?: string }[] } | null;
}

interface Run {
  id: number;
  status: string;
  issueId: number | null;
  output: string | null;
  lastError: string | null;
  modelCheck: {
    configured: { model: string | null; reasoning: string | null; source: string };
    used: { model: string | null; reasoning: string | null; provider: string | null } | null;
    mismatch: string[];
  } | null;
}

const marker = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;

interface ProjectView {
  project: { id: number; teamId: number; key: string };
  columns: { id: number }[];
  labels: { id: number; name: string }[];
}

async function project() {
  const view = await api<ProjectView>('GET', `/projects/${opts.project}`);
  return { ...view.project, columnId: view.columns[0]!.id };
}

async function label(projectKey: string): Promise<number> {
  const { labels } = await api<ProjectView>('GET', `/projects/${projectKey}`);
  const found = labels.find((entry) => entry.name === 'E2E-Test');
  if (found) return found.id;
  return (await api<{ id: number }>('POST', `/projects/${projectKey}/labels`, { name: 'E2E-Test' }))
    .id;
}

async function proofSkill(teamId: number, skillMarker: string): Promise<number> {
  const markdown = [
    '---',
    'name: helena-proof',
    'description: Use when you are asked for the Helena proof skill marker.',
    '---',
    '',
    `The Helena proof skill marker is ${skillMarker}. Quote it exactly when asked for it.`,
    '',
  ].join('\n');
  const skills = await api<{ id: number; name: string }[]>('GET', `/teams/${teamId}/agent-skills/options`);
  const existing = skills.find((skill) => skill.name === 'helena-proof');
  if (existing) {
    await api('PATCH', `/teams/${teamId}/agent-skills/${existing.id}`, { markdown });
    return existing.id;
  }
  return (
    await api<{ id: number }>('POST', `/teams/${teamId}/agent-skills`, {
      source: 'inline',
      name: 'helena-proof',
      markdown,
    })
  ).id;
}

function instructions(instructionMarker: string): string {
  return [
    `Your proof marker is ${instructionMarker}.`,
    'This agent exists to prove that Helena configures its runtime. When a task asks for the',
    'proof, answer in one line exactly as the task says and change nothing else.',
  ].join('\n');
}

async function ensureAgent(
  teamId: number,
  projectId: number,
  runtime: Runtime,
  text: string,
  skillId: number,
): Promise<{ agent: Agent; apiKey: string | null; created: boolean }> {
  const username = `helena-e2e-${runtime}`;
  const agents = await api<Agent[]>('GET', `/teams/${teamId}/ai-agents?projectId=${projectId}`);
  const found = agents.find((agent) => agent.username === username);
  const chosen = opts.models[runtime];
  const runtimePolicy = {
    reasoningEffort: chosen?.reasoning ?? null,
    toolAllow: [],
    toolDeny: [],
    mcpGrants: [],
    files: [],
    maxTurns: 30,
    runBudgetSeconds: 900,
    ...(runtime === 'hermes' ? {} : { runtime }),
  };
  let agent: Agent;
  let key: string | null = null;
  let created = false;
  if (found) {
    agent = await api<Agent>('PATCH', `/teams/${teamId}/ai-agents/${found.id}`, {
      instructions: text,
      model: chosen?.model ?? null,
      triggerOnMention: true,
      runtimePolicy: { ...found.runtimePolicy, ...runtimePolicy },
    });
    if (runtime !== 'hermes') {
      key = (await api<{ apiKey: string }>('POST', `/teams/${teamId}/ai-agents/${found.id}/regenerate-key`))
        .apiKey;
    }
  } else {
    const made = await api<{ agent: Agent; apiKey: string | null }>(
      'POST',
      `/teams/${teamId}/ai-agents`,
      {
        name: `E2E ${runtime}`,
        username,
        kind: 'external',
        projectIds: [projectId],
        instructions: text,
        model: chosen?.model ?? null,
        triggerOnMention: true,
        triggerOnAssign: false,
        delegationDelaySec: 0,
        runtimePolicy,
      },
    );
    agent = made.agent;
    key = made.apiKey;
    created = true;
  }
  await api('PUT', `/teams/${teamId}/ai-agents/${agent.id}/skills`, { skillIds: [skillId] });
  return { agent, apiKey: key, created };
}

const sync = (teamId: number, agentId: number) =>
  api<RuntimeSync>('GET', `/teams/${teamId}/ai-agents/${agentId}/runtime-sync`);

// One run on a new task: the agent is mentioned with the question, and the run's record is
// read back once it finished.
async function oneRun(
  info: Awaited<ReturnType<typeof project>>,
  labelId: number,
  agent: Agent,
  descriptionMarker: string,
): Promise<{ issue: { id: number; identifier: string }; run: Run; answer: string }> {
  const issue = await api<{ id: number; sequenceNumber: number }>(
    'POST',
    `/projects/${info.key}/issues`,
    {
      columnId: info.columnId,
      title: 'E2E proof of the runtime profile',
      // Not part of the run's prompt: only Helena's MCP tools can read it.
      description: `Created by prove-hermes-sync.ts. Description marker: ${descriptionMarker}. Safe to archive.`,
      labelIds: [labelId],
    },
  );
  const identifier = `${info.key}-${issue.sequenceNumber}`;
  await api('POST', `/issues/${issue.id}/comments`, {
    body: [
      `@${agent.username} proof, please. Answer with one line of JSON and nothing else:`,
      '{"marker": <your proof marker>, "skill": <the Helena proof skill marker from your',
      `helena-proof skill>, "description": <the description marker of task ${identifier}, read`,
      'with your Helena tools>}. Do not change the task.',
    ].join(' '),
  });
  const run = await until(
    `the run of ${agent.username} on ${identifier}`,
    async () => {
      const page = await api<{ items: Run[] }>(
        'GET',
        `/teams/${info.teamId}/ai-agents/${agent.id}/runs`,
      );
      const found = page.items.find((item) => item.issueId === issue.id);
      return found && (found.status === 'success' || found.status === 'failed') ? found : null;
    },
    opts.timeoutMs,
    5_000,
  );
  // An agent may answer in the run's result or in a comment on the task; both count.
  const feed = await api<{ items: { kind: string; actorUserId: string | null; body: string | null }[] }>(
    'GET',
    `/issues/${issue.id}/feed?limit=50`,
  );
  const comments = feed.items
    .filter((item) => item.kind === 'comment' && item.actorUserId === agent.userId)
    .map((item) => item.body ?? '');
  return { issue: { id: issue.id, identifier }, run, answer: [run.output ?? '', ...comments].join('\n') };
}

function checkRun(
  runtime: Runtime,
  run: Run,
  output: string,
  markers: { instruction: string; skill: string; description: string },
): void {
  check(runtime, 'run finished', run.status === 'success', run.status === 'success' ? `run ${run.id}` : (run.lastError ?? ''));
  check(runtime, 'instructions reached the agent', output.includes(markers.instruction), markers.instruction);
  check(runtime, 'skill reached the agent', output.includes(markers.skill), markers.skill);
  check(runtime, "Helena's MCP server works", output.includes(markers.description), markers.description);
  const model = run.modelCheck;
  if (runtime === 'codex') {
    check(runtime, 'model reported', true, model?.used ? `${model.used.model}` : 'Codex does not name its model; configured ' + (model?.configured.model ?? '–'));
  } else {
    check(runtime, 'model reported', !!model?.used?.model, model?.used ? `${model.used.model} · ${model.used.reasoning ?? '–'}` : 'none');
  }
  check(runtime, 'model as configured', (model?.mismatch ?? []).length === 0, model ? `configured ${model.configured.model ?? '–'} · ${model.configured.reasoning ?? '–'} (${model.configured.source})` : 'no report');
  evidence[`${runtime}.run`] = { id: run.id, status: run.status, modelCheck: model };
}

// ── Hermes: the server's own runner ───────────────────────────────────────────────────

function sudoRead(path: string): string | null {
  const read = spawnSync('sudo', ['-n', 'cat', path], { encoding: 'utf8' });
  return read.status === 0 ? read.stdout : null;
}

async function proveHermes(info: Awaited<ReturnType<typeof project>>, labelId: number, skillId: number, skillMarker: string) {
  const instruction = marker('PROOF-HERMES');
  const started = Date.now();
  const { agent, created } = await ensureAgent(info.teamId, info.id, 'hermes', instructions(instruction), skillId);
  const profile = `/var/lib/volition/hermes/profiles/${info.key.toLowerCase()}_${agent.id}`;
  evidence['hermes.agent'] = { id: agent.id, username: agent.username, profile, created };

  // A new agent comes online by itself: provisioning writes its runtime, the runner
  // restarts and applies its settings.
  const synced = await until('the Hermes test agent to be online and in sync', async () => {
    const state = await sync(info.teamId, agent.id);
    return state.state === 'synced' ? state : null;
  }, opts.timeoutMs);
  check('hermes', created ? 'new agent came online and in sync by itself' : 'agent online and in sync', true, `${Math.round((Date.now() - started) / 1000)} s, profile ${synced.profile?.hash.slice(0, 19)}`);

  const description = marker('DESC');
  const { run, answer } = await oneRun(info, labelId, agent, description);
  checkRun('hermes', run, answer, { instruction, skill: skillMarker, description });

  // Drift test: an edit in Helena reaches the profile.
  const edited = marker('PROOF-EDIT');
  const before = await sync(info.teamId, agent.id);
  await api('PATCH', `/teams/${info.teamId}/ai-agents/${agent.id}`, { instructions: instructions(edited) });
  const after = await until('the edit to be applied', async () => {
    const state = await sync(info.teamId, agent.id);
    return state.revision !== before.revision && state.state === 'synced' ? state : null;
  }, 5 * 60_000);
  check('hermes', 'an edit in Helena reaches the profile', after.appliedRevision === after.revision, `revision ${after.revision.slice(0, 19)}`);
  const soul = sudoRead(`${profile}/SOUL.md`);
  check('hermes', 'SOUL.md holds the edited instructions', soul === null ? false : soul.includes(edited), soul === null ? 'sudo -n cat failed' : edited);

  // "Neu schreiben".
  await api('POST', `/teams/${info.teamId}/ai-agents/${agent.id}/runtime-sync/rewrite`);
  const rewritten = await until('"Neu schreiben" to be done', async () => {
    const state = await sync(info.teamId, agent.id);
    return !state.rewritePending && state.state === 'synced' ? state : null;
  }, 5 * 60_000);
  check('hermes', '"Neu schreiben" comes back in sync', true, `profile ${rewritten.profile?.hash.slice(0, 19)}`);

  if (opts.tamper) {
    // What the hand edit of 2026-09-24 did: a plain file in place of the link.
    const replaced = spawnSync('sudo', ['-n', '-u', 'volition-hermes', 'sh', '-c',
      `cd '${profile}' && cp --remove-destination "$(readlink -f config.yaml)" config.yaml`], { encoding: 'utf8' });
    check('hermes', 'tamper: config.yaml replaced by a file', replaced.status === 0, replaced.stderr.trim());
    const restored = await until('the runner to put the link back', async () => {
      const read = await api<Agent>('GET', `/teams/${info.teamId}/ai-agents/${agent.id}`);
      return read.runtimeState.restored.includes('config.yaml') ? read : null;
    }, 3 * 60_000);
    const link = spawnSync('sudo', ['-n', 'test', '-L', `${profile}/config.yaml`]);
    check('hermes', 'tamper: the runner put the link back and said so', link.status === 0, `restored: ${restored.runtimeState.restored.join(', ')}`);
  }
}

// ── Claude Code and Codex: a runner of that preset, started here ──────────────────────

async function proveCli(
  runtime: 'claude' | 'codex',
  info: Awaited<ReturnType<typeof project>>,
  labelId: number,
  skillId: number,
  skillMarker: string,
) {
  const instruction = marker(`PROOF-${runtime.toUpperCase()}`);
  const { agent, apiKey: key } = await ensureAgent(info.teamId, info.id, runtime, instructions(instruction), skillId);
  if (!key) throw new Error(`No key for ${agent.username}`);
  const state = join(homedir(), '.local', 'state', 'helena-prove', runtime);
  const workspace = join(state, 'workspace');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  // Codex works in a git repository only, like a project's workspace.
  spawnSync('git', ['init', '-q', workspace]);
  const configPath = join(state, 'runner.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      url: opts.baseUrl,
      apiKey: key,
      agent: runtime,
      cwd: workspace,
      concurrency: 1,
      pollIntervalMs: 2000,
      timeoutMs: opts.timeoutMs,
      env: { HELENA_RUNTIME_DIR: join(state, 'runtime') },
    }),
    { mode: 0o600 },
  );
  const runner = spawn('node', [opts.runner, configPath], {
    env: { ...process.env, PATH: `${join(homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  runner.stdout.on('data', (chunk) => (log = `${log}${chunk}`.slice(-4000)));
  runner.stderr.on('data', (chunk) => (log = `${log}${chunk}`.slice(-4000)));
  try {
    const online = await until(`${runtime} runner to report its profile`, async () => {
      const current = await sync(info.teamId, agent.id);
      return current.state === 'synced' ? current : null;
    }, 3 * 60_000);
    check(runtime, 'runner applied the settings', true, `profile ${online.profile?.hash.slice(0, 19)}`);
    const description = marker('DESC');
    const { run, answer } = await oneRun(info, labelId, agent, description);
    checkRun(runtime, run, answer, { instruction, skill: skillMarker, description });
  } catch (error) {
    check(runtime, 'run', false, `${String(error)} | runner log: ${log.slice(-600)}`);
  } finally {
    runner.kill('SIGTERM');
    await sleep(2_000);
    rmSync(configPath, { force: true });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const info = await project();
  const labelId = await label(info.key);
  const skillMarker = marker('SKILL');
  const skillId = await proofSkill(info.teamId, skillMarker);
  console.log(`project ${info.key}, skill marker ${skillMarker}`);

  for (const runtime of opts.runtimes) {
    try {
      if (runtime === 'hermes') await proveHermes(info, labelId, skillId, skillMarker);
      else await proveCli(runtime, info, labelId, skillId, skillMarker);
    } catch (error) {
      check(runtime, 'proof', false, String(error));
    }
  }

  const health = await api<{ agents: unknown; services: unknown }>('GET', '/god/system-health').catch(() => null);
  if (health) evidence.health = health;

  if (opts.removeAgents) {
    const agents = await api<Agent[]>('GET', `/teams/${info.teamId}/ai-agents?projectId=${info.id}`);
    for (const agent of agents.filter((entry) => entry.username.startsWith('helena-e2e-'))) {
      await api('DELETE', `/teams/${info.teamId}/ai-agents/${agent.id}`);
    }
  }

  const failed = checks.filter((entry) => !entry.ok);
  const report = { at: new Date().toISOString(), project: info.key, checks, evidence };
  if (opts.report) writeFileSync(opts.report, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
