// The proof that what is set for an agent in Helena reaches its runtime exactly and stays in
// sync (prove-hermes-sync.ts). Fs-free and process-free, so it runs in Bun with an API key
// and in a signed-in Helena tab with the session (prove-hermes-sync.browser.ts). What only a
// process on the server can do (read a profile file with sudo, replace config.yaml) is the
// `host`'s; without a host those steps are skipped or proven another way, and the report
// says so. Hermes, Claude Code and Codex agents all run on the server's own runner: a new
// test agent has to come online by itself (hub/cli-runtimes).

import type { Transport } from '../../../scripts/helena-bundle-sync.ts';

export type Runtime = 'hermes' | 'claude' | 'codex';

export interface ProofOptions {
  // The project the test agents work in, by key.
  project?: string;
  runtimes?: Runtime[];
  // Per runtime: the model and reasoning the test agent is set to (unset: the runtime's own
  // default, "Agent default"). The run's model check compares them with what ran.
  models?: Partial<Record<Runtime, { model?: string | null; reasoning?: string | null }>>;
  // Replace the Hermes test agent's config.yaml by a file and wait for the runner to put the
  // link back (needs the host).
  tamper?: boolean;
  // Delete the test agents afterwards (removes the Hermes test runtime again).
  removeAgents?: boolean;
  // Grant the Claude Code or Codex test agent the newest runtime login of its runtime in
  // Zugänge ("Laufzeit-Anmeldung"), keeping every grant it already has. Default: true.
  grantLogin?: boolean;
  // How long one run may take, in minutes.
  timeoutMin?: number;
}

// What only a process on the server can do.
export interface ProofHost {
  // A profile file, read with sudo; null when it cannot be read.
  readProfileFile(path: string): string | null;
  // Replaces the profile's config.yaml by a copy of the file it links to.
  replaceConfigLink(profile: string): { ok: boolean; detail: string };
  isConfigLink(profile: string): boolean;
}

export interface Check {
  runtime: Runtime | 'all';
  name: string;
  ok: boolean;
  // Skipped: the host that could do it is missing. Counts neither as passed nor as failed.
  skipped?: boolean;
  detail: string;
}

export interface ProofReport {
  at: string;
  project: string;
  passed: number;
  failed: number;
  skipped: number;
  checks: Check[];
  evidence: Record<string, unknown>;
}

interface Agent {
  id: number;
  userId: string;
  username: string;
  runtimeState: { restored: string[] };
  runtimePolicy: Record<string, unknown>;
}

interface RuntimeSync {
  state: string;
  revision: string;
  appliedRevision: string | null;
  rewritePending: boolean;
  profile: { hash: string; drift: { key: string; code: string; detail?: string }[] } | null;
  // Absent on a server before hub/cli-runtimes.
  version?: string | null;
  issues?: { code: string; detail?: string; command?: string }[];
}

interface CredentialEntry {
  id: number;
  kind: string;
  label: string;
  runtime?: string | null;
  agentIds: number[];
  updatedAt: string;
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

interface ProjectView {
  project: { id: number; teamId: number; key: string };
  columns: { id: number }[];
  labels: { id: number; name: string }[];
}

type ProjectInfo = ProjectView['project'] & { columnId: number };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A fresh marker: works in Bun and in a browser.
export function marker(prefix: string): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `${prefix}-${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export async function runProof(
  options: ProofOptions,
  send: Transport,
  host: ProofHost | null,
  echo: (line: string) => void = () => {},
): Promise<ProofReport> {
  const runtimes = options.runtimes ?? ['hermes', 'claude', 'codex'];
  const timeoutMs = (options.timeoutMin ?? 20) * 60_000;
  const checks: Check[] = [];
  const evidence: Record<string, unknown> = {};

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await send(method, path, body);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async function until<T>(
    what: string,
    read: () => Promise<T | null | undefined | false>,
    waitMs: number,
    everyMs = 3_000,
  ): Promise<T> {
    const deadline = Date.now() + waitMs;
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

  function check(runtime: Check['runtime'], name: string, ok: boolean, detail = ''): void {
    checks.push({ runtime, name, ok, detail });
    echo(`${ok ? 'PASS' : 'FAIL'}  [${runtime}] ${name}${detail ? ` — ${detail}` : ''}`);
  }

  function skip(runtime: Check['runtime'], name: string, detail: string): void {
    checks.push({ runtime, name, ok: true, skipped: true, detail });
    echo(`SKIP  [${runtime}] ${name} — ${detail}`);
  }

  async function project(): Promise<ProjectInfo> {
    const view = await api<ProjectView>('GET', `/projects/${options.project ?? 'VOL'}`);
    return { ...view.project, columnId: view.columns[0]!.id };
  }

  async function label(projectKey: string): Promise<number> {
    const { labels } = await api<ProjectView>('GET', `/projects/${projectKey}`);
    const found = labels.find((entry) => entry.name === 'E2E-Test');
    if (found) return found.id;
    return (
      await api<{ id: number }>('POST', `/projects/${projectKey}/labels`, { name: 'E2E-Test' })
    ).id;
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
    const skills = await api<{ id: number; name: string }[]>(
      'GET',
      `/teams/${teamId}/agent-skills/options`,
    );
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

  // The test agent of a runtime, created once and reused. With `wantKey` its key is issued
  // again and handed back (no caller needs it since every runtime runs on the server's own
  // runner); it never leaves this function otherwise.
  async function ensureAgent(
    info: ProjectInfo,
    runtime: Runtime,
    text: string,
    skillId: number,
    wantKey: boolean,
  ): Promise<{ agent: Agent; apiKey: string | null; created: boolean }> {
    const username = `helena-e2e-${runtime}`;
    const agents = await api<Agent[]>(
      'GET',
      `/teams/${info.teamId}/ai-agents?projectId=${info.id}`,
    );
    const found = agents.find((agent) => agent.username === username);
    const chosen = options.models?.[runtime];
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
    if (found) {
      const agent = await api<Agent>('PATCH', `/teams/${info.teamId}/ai-agents/${found.id}`, {
        instructions: text,
        model: chosen?.model ?? null,
        triggerOnMention: true,
        runtimePolicy: { ...found.runtimePolicy, ...runtimePolicy },
      });
      const apiKey = wantKey
        ? (
            await api<{ apiKey: string }>(
              'POST',
              `/teams/${info.teamId}/ai-agents/${found.id}/regenerate-key`,
            )
          ).apiKey
        : null;
      await api('PUT', `/teams/${info.teamId}/ai-agents/${agent.id}/skills`, {
        skillIds: [skillId],
      });
      return { agent, apiKey, created: false };
    }
    const made = await api<{ agent: Agent; apiKey: string | null }>(
      'POST',
      `/teams/${info.teamId}/ai-agents`,
      {
        name: `E2E ${runtime}`,
        username,
        kind: 'external',
        projectIds: [info.id],
        instructions: text,
        model: chosen?.model ?? null,
        triggerOnMention: true,
        triggerOnAssign: false,
        delegationDelaySec: 0,
        runtimePolicy,
      },
    );
    await api('PUT', `/teams/${info.teamId}/ai-agents/${made.agent.id}/skills`, {
      skillIds: [skillId],
    });
    return { agent: made.agent, apiKey: wantKey ? made.apiKey : null, created: true };
  }

  const sync = (teamId: number, agentId: number) =>
    api<RuntimeSync>('GET', `/teams/${teamId}/ai-agents/${agentId}/runtime-sync`);

  // One run on a new task, labeled E2E-Test: the agent is mentioned with the question, and
  // the run and the agent's comments on the task are read back once it finished.
  async function oneRun(
    info: ProjectInfo,
    labelId: number,
    agent: Agent,
    question: (identifier: string) => string,
    descriptionMarker: string,
  ): Promise<{ run: Run; answer: string }> {
    const issue = await api<{ id: number; sequenceNumber: number }>(
      'POST',
      `/projects/${info.key}/issues`,
      {
        columnId: info.columnId,
        title: 'E2E proof of the runtime profile',
        // Not part of the run's prompt: only Helena's MCP tools can read it.
        description: `Created by prove-hermes-sync. Description marker: ${descriptionMarker}. Safe to archive.`,
        labelIds: [labelId],
      },
    );
    const identifier = `${info.key}-${issue.sequenceNumber}`;
    await api('POST', `/issues/${issue.id}/comments`, {
      body: `@${agent.username} ${question(identifier)}`,
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
      timeoutMs,
      5_000,
    );
    // An agent may answer in the run's result or in a comment on the task; both count.
    const feed = await api<{
      items: { kind: string; actorUserId: string | null; body: string | null }[];
    }>('GET', `/issues/${issue.id}/feed?limit=50`);
    const comments = feed.items
      .filter((item) => item.kind === 'comment' && item.actorUserId === agent.userId)
      .map((item) => item.body ?? '');
    evidence[`${agent.username}.task.${identifier}`] = { run: run.id, status: run.status };
    return { run, answer: [run.output ?? '', ...comments].join('\n') };
  }

  const proofQuestion = (identifier: string) =>
    [
      'proof, please. Answer with one line of JSON and nothing else:',
      '{"marker": <your proof marker>, "skill": <the Helena proof skill marker from your',
      `helena-proof skill>, "description": <the description marker of task ${identifier}, read`,
      'with your Helena tools>}. Do not change the task.',
    ].join(' ');

  function checkRun(
    runtime: Runtime,
    run: Run,
    output: string,
    markers: { instruction: string; skill: string; description: string },
  ): void {
    check(
      runtime,
      'run finished',
      run.status === 'success',
      run.status === 'success' ? `run ${run.id}` : (run.lastError ?? ''),
    );
    check(
      runtime,
      'instructions reached the agent',
      output.includes(markers.instruction),
      markers.instruction,
    );
    check(runtime, 'skill reached the agent', output.includes(markers.skill), markers.skill);
    check(
      runtime,
      "Helena's MCP server works",
      output.includes(markers.description),
      markers.description,
    );
    const model = run.modelCheck;
    if (runtime === 'codex') {
      check(
        runtime,
        'model reported',
        true,
        model?.used
          ? `${model.used.model}`
          : `Codex does not name its model; configured ${model?.configured.model ?? '–'}`,
      );
    } else {
      check(
        runtime,
        'model reported',
        !!model?.used?.model,
        model?.used ? `${model.used.model} · ${model.used.reasoning ?? '–'}` : 'none',
      );
    }
    check(
      runtime,
      'model as configured',
      (model?.mismatch ?? []).length === 0,
      model
        ? `configured ${model.configured.model ?? '–'} · ${model.configured.reasoning ?? '–'} (${model.configured.source})`
        : 'no report',
    );
    evidence[`${runtime}.run`] = { id: run.id, status: run.status, modelCheck: model };
  }

  // ── Hermes: the server's own runner ─────────────────────────────────────────────────

  async function proveHermes(
    info: ProjectInfo,
    labelId: number,
    skillId: number,
    skillMarker: string,
  ) {
    const instruction = marker('PROOF-HERMES');
    const started = Date.now();
    const { agent, created } = await ensureAgent(
      info,
      'hermes',
      instructions(instruction),
      skillId,
      false,
    );
    const profile = `/var/lib/volition/hermes/profiles/${info.key.toLowerCase()}_${agent.id}`;
    evidence['hermes.agent'] = { id: agent.id, username: agent.username, profile, created };

    // A new agent comes online by itself: provisioning writes its runtime, the runner
    // restarts and applies its settings.
    const synced = await until(
      'the Hermes test agent to be online and in sync',
      async () => {
        const state = await sync(info.teamId, agent.id);
        return state.state === 'synced' ? state : null;
      },
      timeoutMs,
    );
    check(
      'hermes',
      created ? 'new agent came online and in sync by itself' : 'agent online and in sync',
      true,
      `${Math.round((Date.now() - started) / 1000)} s, profile ${synced.profile?.hash.slice(0, 19)}`,
    );

    const description = marker('DESC');
    const { run, answer } = await oneRun(info, labelId, agent, proofQuestion, description);
    checkRun('hermes', run, answer, { instruction, skill: skillMarker, description });

    // Drift test: an edit in Helena reaches the profile.
    const edited = marker('PROOF-EDIT');
    const before = await sync(info.teamId, agent.id);
    await api('PATCH', `/teams/${info.teamId}/ai-agents/${agent.id}`, {
      instructions: instructions(edited),
    });
    const after = await until(
      'the edit to be applied',
      async () => {
        const state = await sync(info.teamId, agent.id);
        return state.revision !== before.revision && state.state === 'synced' ? state : null;
      },
      5 * 60_000,
    );
    check(
      'hermes',
      'an edit in Helena reaches the profile',
      after.appliedRevision === after.revision && after.profile?.hash !== before.profile?.hash,
      `revision ${after.revision.slice(0, 19)}, profile ${after.profile?.hash.slice(0, 19)}`,
    );
    const soul = host?.readProfileFile(`${profile}/SOUL.md`);
    if (soul !== undefined) {
      check(
        'hermes',
        'SOUL.md holds the edited instructions',
        soul === null ? false : soul.includes(edited),
        soul === null ? 'sudo -n cat failed' : edited,
      );
    } else {
      // Without the server: the agent itself quotes the edited marker in a second run.
      const { run: second, answer: said } = await oneRun(
        info,
        labelId,
        agent,
        () => 'what is your proof marker? Answer with the marker only.',
        marker('DESC'),
      );
      check(
        'hermes',
        'the agent works with the edited instructions',
        second.status === 'success' && said.includes(edited),
        edited,
      );
    }

    // "Neu schreiben".
    await api('POST', `/teams/${info.teamId}/ai-agents/${agent.id}/runtime-sync/rewrite`);
    const rewritten = await until(
      '"Neu schreiben" to be done',
      async () => {
        const state = await sync(info.teamId, agent.id);
        return !state.rewritePending && state.state === 'synced' ? state : null;
      },
      5 * 60_000,
    );
    check(
      'hermes',
      '"Neu schreiben" comes back in sync',
      true,
      `profile ${rewritten.profile?.hash.slice(0, 19)}`,
    );

    if (options.tamper && !host) {
      skip('hermes', 'tamper: config.yaml put back', 'needs the server (prove-hermes-sync.ts)');
    } else if (options.tamper && host) {
      // What the hand edit of 2026-09-24 did: a plain file in place of the link.
      const replaced = host.replaceConfigLink(profile);
      check('hermes', 'tamper: config.yaml replaced by a file', replaced.ok, replaced.detail);
      const restored = await until(
        'the runner to put the link back',
        async () => {
          const read = await api<Agent>('GET', `/teams/${info.teamId}/ai-agents/${agent.id}`);
          return read.runtimeState.restored.includes('config.yaml') ? read : null;
        },
        3 * 60_000,
      );
      check(
        'hermes',
        'tamper: the runner put the link back and said so',
        host.isConfigLink(profile),
        `restored: ${restored.runtimeState.restored.join(', ')}`,
      );
    }
  }

  // ── Claude Code and Codex: the server's own runner, like Hermes ─────────────────────

  // The newest runtime login of the runtime in Zugänge, granted to the agent as well.
  async function grantLogin(info: ProjectInfo, runtime: 'claude' | 'codex', agent: Agent) {
    const page = await api<{ items: CredentialEntry[] }>(
      'GET',
      `/teams/${info.teamId}/credentials?kind=runtime_login&limit=100`,
    );
    const login = page.items
      .filter((entry) => entry.runtime === runtime)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!login) return null;
    if (!login.agentIds.includes(agent.id)) {
      await api('PUT', `/teams/${info.teamId}/credentials/${login.id}/grants`, {
        agentIds: [...login.agentIds, agent.id],
      });
    }
    return login;
  }

  async function proveCli(
    runtime: 'claude' | 'codex',
    info: ProjectInfo,
    labelId: number,
    skillId: number,
    skillMarker: string,
  ) {
    const instruction = marker(`PROOF-${runtime.toUpperCase()}`);
    const started = Date.now();
    const { agent, created } = await ensureAgent(
      info,
      runtime,
      instructions(instruction),
      skillId,
      false,
    );
    evidence[`${runtime}.agent`] = { id: agent.id, username: agent.username, created };
    const login = options.grantLogin === false ? null : await grantLogin(info, runtime, agent);
    evidence[`${runtime}.login`] = login ? { credential: login.id, label: login.label } : null;

    // A new agent comes online by itself: provisioning writes its runtime, the runner restarts
    // and applies its settings. Codex outside agent isolation reports its read-only sandbox
    // as an issue, which is expected and does not stop the proof.
    const blocking = (state: RuntimeSync) =>
      (state.issues ?? []).filter((issue) => issue.code !== 'sandbox-unavailable');
    const online = await until(
      `the ${runtime} test agent to be online with its settings applied`,
      async () => {
        const state = await sync(info.teamId, agent.id);
        const applied = state.appliedRevision === state.revision && !!state.profile;
        if (!applied || state.state === 'offline' || state.state === 'pending') return null;
        return state;
      },
      timeoutMs,
    );
    check(
      runtime,
      created ? 'new agent came online by itself' : 'agent online',
      true,
      `${Math.round((Date.now() - started) / 1000)} s, profile ${online.profile?.hash.slice(0, 19)}`,
    );
    check(runtime, 'runtime installed', !!online.version, online.version ?? 'no version reported');
    const problems = blocking(online);
    check(
      runtime,
      'runtime signed in',
      problems.length === 0,
      problems.length === 0
        ? login
          ? `runtime login "${login.label}"`
          : "the agent's own login"
        : problems
            .map((issue) => `${issue.code}${issue.detail ? ` (${issue.detail})` : ''}`)
            .join(', ') +
            (login ? '' : ' — add a Laufzeit-Anmeldung in Zugänge') +
            (problems[0]?.command ? `; command: ${problems[0].command}` : ''),
    );
    if (runtime === 'codex') {
      const sandbox = (online.issues ?? []).find((issue) => issue.code === 'sandbox-unavailable');
      check(
        runtime,
        'sandbox policy',
        true,
        sandbox
          ? `${sandbox.detail ?? 'read-only'}: agent isolation is off, so Codex reaches only Helena's tools`
          : 'no sandbox of its own inside agent isolation',
      );
    }
    if (problems.length > 0) return;
    const description = marker('DESC');
    const { run, answer } = await oneRun(info, labelId, agent, proofQuestion, description);
    checkRun(runtime, run, answer, { instruction, skill: skillMarker, description });
  }

  // ── The proof ────────────────────────────────────────────────────────────────────────

  const info = await project();
  const labelId = await label(info.key);
  const skillMarker = marker('SKILL');
  const skillId = await proofSkill(info.teamId, skillMarker);
  echo(`project ${info.key}, skill marker ${skillMarker}`);

  for (const runtime of runtimes) {
    try {
      if (runtime === 'hermes') await proveHermes(info, labelId, skillId, skillMarker);
      else await proveCli(runtime, info, labelId, skillId, skillMarker);
    } catch (error) {
      check(runtime, 'proof', false, String(error));
    }
  }

  const health = await api<{ agents: unknown; services: unknown }>(
    'GET',
    '/god/system-health',
  ).catch(() => null);
  if (health) evidence.health = { agents: health.agents, services: health.services };

  if (options.removeAgents) {
    const agents = await api<Agent[]>('GET', `/teams/${info.teamId}/ai-agents?projectId=${info.id}`);
    for (const agent of agents.filter((entry) => entry.username.startsWith('helena-e2e-'))) {
      await api('DELETE', `/teams/${info.teamId}/ai-agents/${agent.id}`);
    }
  }

  const skipped = checks.filter((entry) => entry.skipped).length;
  const failed = checks.filter((entry) => !entry.ok).length;
  const report: ProofReport = {
    at: new Date().toISOString(),
    project: info.key,
    passed: checks.length - failed - skipped,
    failed,
    skipped,
    checks,
    evidence,
  };
  echo(`${report.passed} passed, ${failed} failed, ${skipped} skipped`);
  return report;
}
