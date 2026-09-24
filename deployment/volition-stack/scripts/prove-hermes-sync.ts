#!/usr/bin/env bun
/**
 * prove-hermes-sync.ts — proves on a live Helena that what is set for an agent reaches its
 * runtime exactly, per runtime (Hermes, Claude Code, Codex), and stays in sync after edits.
 * The proof itself is prove-hermes-sync.ops.ts; this is its server-side runner, with an API
 * key and the host steps only a process on the server can do.
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
 * config.yaml replaced by a plain file must be put back by the runner.
 *
 * Claude Code and Codex agents run on the server's own runner too (hub/cli-runtimes): the
 * new test agent has to come online by itself, its runtime installed and signed in (a
 * Laufzeit-Anmeldung in Zugänge, which the proof grants to the test agent, or the agent's
 * own login), before its run.
 *
 * Run it on the server as the owner:
 *   HELENA_API_KEY=itp_... bun deployment/volition-stack/scripts/prove-hermes-sync.ts \
 *     [--base-url=http://127.0.0.1:3000] [--project=VOL] [--runtimes=hermes,claude,codex] \
 *     [--model-hermes=gpt-6-luna --reasoning-hermes=low] [--model-claude=...] [--model-codex=...]
 *     [--tamper] [--remove-agents] [--timeout-min=20] [--report=<file.json>]
 * HELENA_API_KEY is a personal API key of the owner; it is sent as x-api-key and never
 * printed. Without a key, use the browser build (prove-hermes-sync.browser.ts), which runs in
 * a signed-in Helena tab and proves every runtime but the host steps (SOUL.md, --tamper).
 *
 * Idempotent: agents, the skill and the label are reused; every run adds tasks labeled
 * E2E-Test. Creating the Hermes test agent the first time restarts the server's runner once
 * (provisioning), which hands the runs in flight back to the queue. Exit code 0 when every
 * check passed.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { keyTransport } from '../../../scripts/helena-bundle-sync.ts';
import { runProof, type ProofHost, type ProofOptions, type Runtime } from './prove-hermes-sync.ops.ts';

const argv = process.argv.slice(2);
const value = (name: string) =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const models: ProofOptions['models'] = {};
for (const runtime of ['hermes', 'claude', 'codex'] as const) {
  const model = value(`model-${runtime}`) ?? null;
  const reasoning = value(`reasoning-${runtime}`) ?? null;
  if (model || reasoning) models[runtime] = { model, reasoning };
}
const options: ProofOptions = {
  project: value('project') ?? 'VOL',
  runtimes: (value('runtimes') ?? 'hermes,claude,codex')
    .split(',')
    .filter((name): name is Runtime => ['hermes', 'claude', 'codex'].includes(name)),
  models,
  tamper: argv.includes('--tamper'),
  removeAgents: argv.includes('--remove-agents'),
  timeoutMin: Number(value('timeout-min') ?? 20),
};
const baseUrl = (value('base-url') ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const reportPath = value('report') ?? null;

const apiKey = process.env.HELENA_API_KEY?.trim();
if (!apiKey) {
  console.error('HELENA_API_KEY is not set (a personal API key of the owner).');
  process.exit(2);
}

const host: ProofHost = {
  readProfileFile(path) {
    const read = spawnSync('sudo', ['-n', 'cat', path], { encoding: 'utf8' });
    return read.status === 0 ? read.stdout : null;
  },
  replaceConfigLink(profile) {
    const replaced = spawnSync(
      'sudo',
      [
        '-n',
        '-u',
        'volition-hermes',
        'sh',
        '-c',
        `cd '${profile}' && cp --remove-destination "$(readlink -f config.yaml)" config.yaml`,
      ],
      { encoding: 'utf8' },
    );
    return { ok: replaced.status === 0, detail: replaced.stderr.trim() };
  },
  isConfigLink(profile) {
    return spawnSync('sudo', ['-n', 'test', '-L', `${profile}/config.yaml`]).status === 0;
  },
};

try {
  const report = await runProof(options, keyTransport(baseUrl, apiKey), host, (line) =>
    console.log(line),
  );
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.failed === 0 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
