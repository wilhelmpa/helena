#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { answer } from './chat';
import {
  Client,
  RequestError,
  type ChatMessage,
  type Run,
  type RuntimeRequestClaim,
} from './client';
import { loadConfig, type RunnerConfig } from './config';
import { loadRunnerPlugins } from './plugins';
import { runtimeAdapter } from './adapters';
import { ensureRuntimeDir, syncCliFiles, type CliFile } from './cli-runtime';
import { readHermesInventory, type HermesProfile } from './inventory';
import { isolationEnabled, profileHelper as runProfileHelper } from './isolation';
import { answerRuntimeRequest, isRuntimeRequest, type RuntimeRequest } from './readers';
import { readerContext, runnerRedactor } from './readers/context';
import { readLearnedSkills } from './learning';
import { pythonVaultStore, WebLoginVault } from './logins';
import { HermesPolicyMaterializer, type ApplyOptions, type MaterializerContext } from './policy';
import { Redactor } from './redact';
import { reflect } from './reflect';
import { runtimeUpdate } from './update';
import { perform, reportUntilTaken, type Performed } from './run';
import { runPolicyHook } from './policy-hook';
import type { RunSettings, RuntimeAdapter } from './runtime';
import { applySshKeys, sshDir, type SshKey } from './ssh';
import { parseWorkspaceJob, runWorkspaceJob } from './workspace-job';
import { digestRuntimeError, digestSettings, isDigestRun } from './digest';
import type { Outcome } from './execute';
import type { WorkRef } from './logins';
import { limitProber } from './limits';
import { limitsContext } from './limits/context';
import { limitsProbe, limitsReport } from './limits/report';

// The runner holds no state — the queue is the server's. A runner stopped by its service
// manager (SIGTERM) kills the commands in flight and hands their runs back, so they are
// claimed again at once; one that dies mid-task leaves its runs to their leases.
//
// Two feeds are drained side by side per agent: triggered runs, polled, and chat
// messages, claimed by a call that waits on the server for one. A config that lists
// several agents runs that pair for each of them, in the one process.

const HEARTBEAT_MS = 60_000;
const noSettings = { toolsets: null, env: {} };
const ERROR_BACKOFF_MS = 5_000;
const CATALOG_RETRY_MS = 30_000;
// Runtime requests read files and start short commands; two at once keep a slow doctor run
// from holding up a transcript.
const REQUEST_CONCURRENCY = 2;

type Log = (message: string) => void;

// Shared by every agent the runner serves. `stopping` ends the claiming; `releasing` says
// the runs in flight are handed back instead of finished; `stops` holds the controllers
// that kill the commands of those runs. Chat answers in flight are left to finish.
interface State {
  stopping: boolean;
  releasing: boolean;
  stops: Set<AbortController>;
}

function prefixOf(name: string): string {
  return name ? `[itsaplan-runner ${name}]` : '[itsaplan-runner]';
}

function log(message: string): void {
  console.log(`${prefixOf('')} ${message}`);
}

// A task can take much longer than the server's lease; without this it would be handed
// out again mid-flight.
async function withHeartbeat<T>(log: Log, beat: () => Promise<void>, work: Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    beat().catch((err) => log(`heartbeat failed: ${String(err)}`));
  }, HEARTBEAT_MS);
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}

// The SSH keys granted to the agent for this piece of work, written to its key directory,
// as the environment git needs. A failure leaves git without keys rather than failing the
// work: a task that needs no repository still runs.
// Per key directory: whether the last delivery left keys there. An isolated agent's keys go
// through the profile helper (a unit start), so a directory known to be empty is skipped.
const sshDelivered = new Map<string, boolean>();

async function sshEnv(
  config: RunnerConfig,
  client: Client,
  log: Log,
  work: WorkRef,
): Promise<Record<string, string>> {
  try {
    const keys = await client.sshKeys(work);
    const dir = sshDir(config);
    // An isolated agent's profile belongs to its project user, so the profile helper writes
    // the keys there as that user, like the rest of the profile (2026-09-24: "EACCES mkdir
    // …/helena-ssh"). The first delivery after a start always runs, to clear revoked keys.
    if (isolationEnabled() && config.isolation && config.cwd) {
      if (keys.length === 0 && sshDelivered.get(dir) === false) return {};
      const env = await runProfileHelper<Record<string, string>>(config.isolation, config.cwd, {
        op: 'ssh-keys',
        keys,
        dir,
      });
      sshDelivered.set(dir, keys.length > 0);
      return env;
    }
    return await applySshKeys(dir, keys);
  } catch (err) {
    log(`ssh keys not delivered — ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

function withEnv(settings: RunSettings | null, env: Record<string, string>): RunSettings | null {
  if (Object.keys(env).length === 0) return settings;
  return {
    toolsets: settings?.toolsets ?? null,
    ...settings,
    env: { ...settings?.env, ...env },
  };
}

// Runs a workspace job (a clone) and reports it like a run's result.
async function performWorkspaceJob(
  config: RunnerConfig,
  client: Client,
  run: Run,
  stop: AbortController,
  env: Record<string, string>,
  lost: AbortSignal,
): Promise<Performed | null> {
  let outcome: Outcome;
  try {
    outcome = await runWorkspaceJob(config, parseWorkspaceJob(run.prompt), env, stop.signal);
  } catch (err) {
    outcome = {
      status: 'failed',
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (stop.signal.aborted) return null;
  await reportUntilTaken(async () => {
    await client.report(run.id, run.claim, outcome);
  }, lost);
  return { outcome, reflection: null };
}

// A cancel reaches the runner on the heartbeat, which aborts `stop` and so kills the
// command. The heartbeat does the same for a run that is no longer this runner's, and
// marks it `lost`, which also ends the reporting of a result. An answer to a heartbeat
// sent before this runner claimed its run again names the old claim and is ignored.
async function handle(
  state: State,
  config: RunnerConfig,
  client: Client,
  log: Log,
  run: Run,
  policy: RuntimeAdapter | null,
): Promise<void> {
  const label = run.issueIdentifier ?? `run ${run.id}`;
  const stop = new AbortController();
  const lost = new AbortController();
  // Set by a heartbeat during the instance's emergency stop: the run goes back to the queue.
  let held = false;
  if (state.releasing) stop.abort();
  else log(run.sessionId ? `${label}: resuming its session` : `${label}: started (${run.trigger})`);
  state.stops.add(stop);
  try {
    const digest = isDigestRun(run);
    const refused = digest ? digestRuntimeError(config) : null;
    if (refused) throw new Error(refused);
    // A digest run is text only (digest.ts): no SSH keys, no tools, no rules.
    const hermes = stop.signal.aborted
      ? null
      : digest
        ? digestSettings((await policy?.runSettings({ runId: run.id })) ?? null)
        : withEnv(
            (await policy?.runSettings({ runId: run.id })) ?? null,
            await sshEnv(config, client, log, { runId: run.id }),
          );
    const work =
      run.trigger === 'workspace'
        ? performWorkspaceJob(config, client, run, stop, hermes?.env ?? {}, lost.signal)
        : perform(config, client, run, stop, hermes, { lost: lost.signal, runtime: policy });
    const performed = stop.signal.aborted
      ? null
      : await withHeartbeat(
          log,
          async () => {
            const claim = run.claim;
            const beat = await client.beat(run.id, claim);
            if (claim !== run.claim) return;
            if (beat.hold && !beat.canceled) {
              held = true;
              stop.abort();
              return;
            }
            if (!beat.canceled) return;
            lost.abort();
            stop.abort();
          },
          work,
        );
    if (performed) {
      const { outcome, reflection } = performed;
      log(`${label}: ${outcome.status}${outcome.error ? ` — ${outcome.error}` : ''}`);
      // The run is finished and reported, so a reflection has no lease to keep alive.
      if (reflection && outcome.sessionId) {
        await reflect(config, client, run, outcome.sessionId, reflection, hermes ?? noSettings)
          .then((done) => log(`${label}: reflection ${done.status}, ${done.saved.length} saved`))
          .catch((err) => log(`${label}: reflection not reported — ${String(err)}`));
      }
    } else if ((state.releasing || held) && run.claim !== undefined)
      await client.release(run.id, run.claim).then(
        () => log(`${label}: handed back to the queue${held ? ' (emergency stop)' : ''}`),
        (err: unknown) => log(`${label}: could not be handed back — ${String(err)}`),
      );
    else log(`${label}: canceled`);
  } catch (err) {
    // The command itself never throws here; this is the runner failing to run or
    // report it. Reporting the failure keeps the run from being retried blindly. A
    // canceled run is already closed, and a run the server says is not this runner's
    // (404) takes no result from it, so nothing is reported for either.
    const message = err instanceof Error ? err.message : String(err);
    log(`${label}: runner error — ${message}`);
    if (!lost.signal.aborted && !(err instanceof RequestError && err.status === 404))
      await client.report(run.id, run.claim, { status: 'failed', error: message }).catch(() => {});
  } finally {
    state.stops.delete(stop);
  }
}

// The stop the member pressed comes back on whichever call the runner was making: the
// events report while the command writes, the heartbeat while it is silent. Both abort
// the same controller, which kills the command.
async function handleChat(
  config: RunnerConfig,
  client: Client,
  log: Log,
  message: ChatMessage,
  policy: RuntimeAdapter | null,
): Promise<void> {
  log(`chat ${message.id}: answering`);
  const stop = new AbortController();
  try {
    const hermes = withEnv(
      (await policy?.runSettings({ messageId: message.id })) ?? null,
      await sshEnv(config, client, log, { messageId: message.id }),
    );
    await withHeartbeat(
      log,
      async () => {
        if (await client.chatHeartbeat(message.id)) stop.abort();
      },
      answer(config, client, message, stop, hermes, policy),
    );
  } catch (err) {
    // Without a reported failure the chat waits for an answer that is no longer coming.
    // A stopped answer is already closed, so nothing is reported for it.
    if (!stop.signal.aborted) {
      const text = err instanceof Error ? err.message : String(err);
      log(`chat ${message.id}: runner error — ${text}`);
      await client.chatResult(message.id, { status: 'failed', error: text }).catch(() => {});
      return;
    }
  }
  log(`chat ${message.id}: ${stop.signal.aborted ? 'stopped' : 'answered'}`);
}

// A question of Helena about the agent's runtime, answered by its runtime adapter. An
// isolated agent's profile is read by the profile helper as the project's user.
async function handleRuntimeRequest(
  config: RunnerConfig,
  client: Client,
  log: Log,
  claim: RuntimeRequestClaim,
  runtime: RuntimeAdapter | null = null,
): Promise<void> {
  try {
    if (!isRuntimeRequest(claim.request)) throw new Error('This runner does not know the request');
    const request = claim.request;
    const isolated = isolationEnabled() && !!config.isolation && !!config.cwd;
    const limits = request.op === 'limits.read' ? limitsContext(config, runtime) : null;
    const viaHelper = (sent: RuntimeRequest) =>
      runProfileHelper(config.isolation!, config.cwd!, {
        op: 'runtime-request',
        request: sent,
        runtime: config.agent ?? null,
        cwd: config.cwd,
        known: runnerRedactor(config).secrets(),
      });
    let result: unknown;
    if (request.op === 'runtime.update') {
      // The Hermes installation is the runner's own, isolated agents or not.
      result = await runtimeUpdate(request);
    } else if (request.op === 'limits.read' && limits && !isolated) {
      // The runner's prober: the agents it serves share one probe per login. Numbers only;
      // the runner's redaction still runs over them, as over every answer.
      result = await runnerRedactor(config).value({
        snapshots: await limitProber.read(limits, { force: request.force === true }),
      });
    } else if (request.op === 'limits.read' && limits && isolated) {
      // The helper does not know the agent's providers, and its commands start through the
      // agent's gate like every other command of it.
      const release = limits.gate ? await limits.gate.acquire() : () => {};
      try {
        result = await viaHelper({ ...request, providers: limits.providers });
      } finally {
        release();
      }
    } else if (isolated) {
      result = await viaHelper(request);
    } else {
      result = await answerRuntimeRequest(request, readerContext(config), runnerRedactor(config));
    }
    await client.answerRuntimeRequest(claim.id, { ok: true, result });
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    log(`request ${claim.id} (${String(claim.request?.op)}) failed — ${message}`);
    await client.answerRuntimeRequest(claim.id, { ok: false, error: message }).catch(() => {});
  }
}

// Both feeds are drained the same way; they differ in what asking for work means — a poll
// for runs, a waiting claim for chat. `onEmpty` waits before asking again, and returns
// false to give the feed up entirely.
async function drain<T>(
  state: State,
  log: Log,
  concurrency: number,
  take: () => Promise<T | null>,
  run: (item: T) => Promise<void>,
  onEmpty: () => Promise<boolean>,
): Promise<void> {
  const active = new Set<Promise<void>>();
  let done = false;
  while (!state.stopping && !done) {
    if (active.size >= concurrency) {
      await Promise.race(active);
      continue;
    }
    let item: T | null = null;
    try {
      item = await take();
    } catch (err) {
      // A key the server refuses will be refused just as much on the next poll, so
      // stop instead of hiding it in a log line every few seconds.
      if (err instanceof RequestError && (err.status === 401 || err.status === 403)) throw err;
      log(`claim failed: ${String(err)}`);
      // Backing off here and not in onEmpty: a claim that waits on the server returns
      // instantly when it fails, and retrying it at that rate would hammer both sides.
      await sleep(ERROR_BACKOFF_MS);
      continue;
    }
    if (!item) {
      done = !(await onEmpty());
      continue;
    }
    const task = run(item).finally(() => active.delete(task));
    active.add(task);
  }
  await Promise.all(active);
}

function parseArgv(argv: string[]): { configPath?: string; agent?: string; args: string[] } {
  const parsed: { configPath?: string; agent?: string; args: string[] } = { args: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      parsed.args = argv.slice(i + 1);
      break;
    }
    if (arg === '--agent') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--agent needs a value');
      parsed.agent = value;
      continue;
    }
    if (arg.startsWith('--agent=')) {
      parsed.agent = arg.slice('--agent='.length);
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    parsed.configPath ??= arg;
  }
  return parsed;
}

// The server can be unreachable while the runner starts, for instance when both start at
// boot. The agent answers meanwhile; its model list follows once the server takes it.
async function publishCatalog(
  state: State,
  log: Log,
  client: Client,
  config: RunnerConfig,
): Promise<void> {
  while (!state.stopping) {
    try {
      await client.publishChatCatalog(config.models);
      return;
    } catch (err) {
      if (err instanceof RequestError && (err.status === 401 || err.status === 403)) return;
      log(`publishing the model catalog failed: ${String(err)}`);
      await sleep(CATALOG_RETRY_MS);
    }
  }
}

// Everything one agent needs: the two feeds, until the runner is stopped or the server
// refuses its key.
async function serve(state: State, config: RunnerConfig): Promise<void> {
  const client = new Client(config);
  const prefix = prefixOf(config.name);
  const log: Log = (message) => console.log(`${prefix} ${message}`);
  log(
    `running ${config.agent ?? 'the configured command'}, polling ${config.url} every ` +
      `${config.pollIntervalMs}ms, up to ${config.concurrency} at once`,
  );
  const policy = runtimeAdapter(config, client);
  await policy?.ensure();
  if (config.models.length > 0) void publishCatalog(state, log, client, config);
  let chatSupported = true;
  let requestsSupported = true;
  const inFlight = new Map<number, Run>();
  await Promise.all([
    drain<Run>(
      state,
      log,
      config.concurrency,
      async () => {
        await policy?.ensure();
        const run = await client.claim();
        const held = run && inFlight.get(run.id);
        if (!held) return run;
        // The lease ran out while the server could not be reached, and the run came back
        // to this runner: its command keeps running under the new claim.
        held.attempts = run.attempts;
        held.claim = run.claim;
        log(`${held.issueIdentifier ?? `run ${held.id}`}: claimed again while it runs`);
        return null;
      },
      async (run) => {
        inFlight.set(run.id, run);
        try {
          await policy?.ensure();
          await handle(state, config, client, log, run, policy);
          policy?.inventoryChanged();
        } finally {
          inFlight.delete(run.id);
        }
      },
      async () => {
        await sleep(config.pollIntervalMs);
        return true;
      },
    ),
    // The claim already waits on the server, so an empty one means the wait ran out and
    // asking again is the whole delay there is. An instance too old to have the feed
    // answers 404, and that loop ends rather than asking forever.
    drain<ChatMessage>(
      state,
      log,
      config.concurrency,
      async () => {
        try {
          await policy?.ensure();
          return await client.claimChat();
        } catch (err) {
          if (err instanceof RequestError && err.status === 404) {
            log('this instance has no chat feed — only queued runs will be answered');
            chatSupported = false;
            return null;
          }
          throw err;
        }
      },
      async (message) => {
        await policy?.ensure();
        await handleChat(config, client, log, message, policy);
        policy?.inventoryChanged();
      },
      () => Promise.resolve(chatSupported),
    ),
    // Helena's questions about the runtime: sessions, transcripts, logs, health. An instance
    // too old to ask any answers 404, and that loop ends.
    drain<RuntimeRequestClaim>(
      state,
      log,
      REQUEST_CONCURRENCY,
      async () => {
        try {
          return await client.claimRuntimeRequest();
        } catch (err) {
          if (err instanceof RequestError && err.status === 404) {
            requestsSupported = false;
            return null;
          }
          throw err;
        }
      },
      (claim) => handleRuntimeRequest(config, client, log, claim, policy),
      () => Promise.resolve(requestsSupported),
    ),
  ]);
}

async function readStdin(limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('the request is too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// `profile-helper`: the part of the runner that reads and writes an agent's profile, run by
// the launcher as the project's own user when agents are isolated (see policy.ts). It takes
// one operation on stdin and answers on stdout; HERMES_HOME is the profile the launcher
// bound into the unit.
async function profileHelper(): Promise<void> {
  const home = process.env.HERMES_HOME;
  let answer: unknown;
  try {
    if (!home) throw new Error('HERMES_HOME is not set');
    const request = JSON.parse(await readStdin(64 * 1024 * 1024)) as {
      op?: string;
      snapshot?: unknown;
      options?: ApplyOptions;
      context?: Pick<MaterializerContext, 'url'> | null;
      profile?: HermesProfile | null;
      logins?: unknown;
      actions?: unknown;
      request?: unknown;
      runtime?: unknown;
      cwd?: unknown;
      known?: unknown;
      keys?: unknown;
      dir?: unknown;
      sessionId?: unknown;
      files?: unknown;
    };
    const profile = request.profile ?? undefined;
    const materializer = new HermesPolicyMaterializer({
      hermesHome: home,
      profile,
      context: { url: request.context?.url, python: 'python3' },
    });
    let result: unknown;
    if (request.op === 'materialize') {
      result = await materializer.apply(request.snapshot as never, request.options ?? {});
    } else if (request.op === 'probe') {
      if (!Array.isArray(request.keys)) throw new Error('keys must be a list');
      result = await materializer.probe(request.keys.filter((key) => typeof key === 'string'));
    } else if (request.op === 'session') {
      if (typeof request.sessionId !== 'string') throw new Error('sessionId must be a string');
      result = await materializer.sessionFacts(request.sessionId);
    } else if (request.op === 'plugins') {
      result = await materializer.ensurePlugins();
    } else if (request.op === 'ssh-keys') {
      // The agent's git keys, written as the project user into its own profile.
      if (!Array.isArray(request.keys)) throw new Error('keys must be a list');
      const dir = typeof request.dir === 'string' ? resolve(request.dir) : '';
      if (!dir.startsWith(`${resolve(home)}/`)) throw new Error('dir must be inside the profile');
      result = await applySshKeys(dir, request.keys as SshKey[]);
    } else if (request.op === 'actions') {
      if (!Array.isArray(request.actions)) throw new Error('actions must be a list');
      result = await materializer.runActions(request.actions as never);
    } else if (request.op === 'inventory') {
      const inventory = await readHermesInventory(home, profile, await materializer.planSkills());
      result = { inventory, learned: await readLearnedSkills(home, inventory.skills) };
    } else if (request.op === 'cli-files') {
      // The skills of a Claude Code or Codex agent (cli-runtime.ts), and the runtime's own
      // directory, which Codex does not start without.
      if (request.runtime !== 'claude' && request.runtime !== 'codex') {
        throw new Error('runtime must be claude or codex');
      }
      if (!Array.isArray(request.files)) throw new Error('files must be a list');
      const files = (request.files as unknown[]).filter(
        (file): file is CliFile =>
          !!file &&
          typeof (file as CliFile).path === 'string' &&
          typeof (file as CliFile).content === 'string',
      );
      await ensureRuntimeDir(join(home, request.runtime === 'claude' ? '.claude' : '.codex'));
      result = { written: await syncCliFiles(join(home, '.helena'), files) };
    } else if (request.op === 'vault-sync') {
      if (!Array.isArray(request.logins)) throw new Error('logins must be a list');
      const vault = new WebLoginVault(home, pythonVaultStore(home, 'python3', {}));
      result = [...(await vault.sync(request.logins as never))];
    } else if (request.op === 'runtime-request') {
      if (!isRuntimeRequest(request.request)) throw new Error('unknown runtime request');
      const runtime = typeof request.runtime === 'string' ? request.runtime : 'hermes';
      const cwd = typeof request.cwd === 'string' ? request.cwd : null;
      result = await answerRuntimeRequest(
        request.request as RuntimeRequest,
        { runtime, home: runtime === 'hermes' ? home : (process.env.HOME ?? home), cwd, env: {} },
        new Redactor(Array.isArray(request.known) ? (request.known as string[]) : []),
      );
    } else {
      throw new Error('unknown operation');
    }
    answer = { ok: true, result };
  } catch (error) {
    answer = { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'failed' };
  }
  process.stdout.write(`${JSON.stringify(answer)}\n`);
}

// `policy-hook`: Claude Code's PreToolUse hook, which asks Helena's policy engine.
async function policyHook(): Promise<void> {
  const answer = await runPolicyHook(await readStdin(4 * 1024 * 1024));
  if (answer) process.stdout.write(`${answer}\n`);
}

// The agents the deployment's catalog script left out of the runner config, and why.
async function startProblems(path: string): Promise<string[]> {
  try {
    const file = JSON.parse(await readFile(path, 'utf8')) as { helenaProblems?: unknown };
    return Array.isArray(file.helenaProblems)
      ? file.helenaProblems.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'profile-helper') return profileHelper();
  if (process.argv[2] === 'limits-report') return limitsReport(process.argv.slice(3));
  if (process.argv[2] === 'limits-probe') return limitsProbe(process.argv.slice(3));
  if (process.argv[2] === 'policy-hook') return policyHook();
  const cli = parseArgv(process.argv.slice(2));
  const configPath =
    cli.configPath ?? process.env.ITSAPLAN_RUNNER_CONFIG ?? './itsaplan-runner.json';
  await loadRunnerPlugins(configPath, log);
  const configs = await loadConfig(configPath, { agent: cli.agent, args: cli.args });
  const state: State = { stopping: false, releasing: false, stops: new Set() };

  // Ctrl-C finishes what is in flight. SIGTERM, which a service manager sends, kills the
  // commands and hands their runs back: a restart must not wait for a run of half an
  // hour, nor leave it to a lease that counts it as a failed attempt.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // The commands run in their own process groups, so quitting now leaves them running
      // with nobody to report their result: the lease expires and the run is handed out
      // again.
      if (state.stopping) {
        log('quitting now — the commands in flight keep running, their runs are retried');
        process.exit(1);
      }
      state.stopping = true;
      if (signal === 'SIGINT') {
        log('stopping — finishing the tasks in flight, press again to quit now');
        return;
      }
      state.releasing = true;
      log('stopping — handing the runs in flight back to the queue');
      for (const stop of state.stops) stop.abort();
    });
  }

  // A start the service wrapper reported as failed is over now; what the deployment could
  // not give a runner (a broken descriptor, say) is named instead.
  const problems = await startProblems(configPath);
  if (configs[0]) {
    void new Client(configs[0])
      .reportRunnerHealth(
        problems.length > 0 ? `Left out of the runner: ${problems.join('; ')}`.slice(0, 500) : null,
      )
      .catch(() => {});
  }

  // One agent's key being refused says nothing about the others, so it does not take them
  // down with it; the runner still exits non-zero once they are all finished.
  const served = await Promise.all(
    configs.map((config) =>
      serve(state, config).then(
        () => true,
        (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`${prefixOf(config.name)} stopped — ${message}`);
          return false;
        },
      ),
    ),
  );
  process.exit(served.includes(false) ? 1 : 0);
}

main().catch((err) => {
  console.error(`[itsaplan-runner] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
