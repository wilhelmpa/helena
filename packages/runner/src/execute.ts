import { spawn } from 'node:child_process';
import { runnerDisplayName } from './display-name';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ContextUsage } from './agui';
import { presetOf, type RunnerConfig } from './config';
import { isolatedEnv, isolationEnabled, launch, LaunchError, type WorkKind } from './isolation';
import type { CliCommand, RuntimeFailure } from '@helena/sdk';
import { presetArgv, presetPrompt } from './presets';
import type { CommandHooks } from './runtime';
import { runtimeOf } from './runtimes';
import { localRoute } from './local-ai';
import { executeWebhook } from './webhook-runtime';
import { externalResult } from './external-result';
import type { Spend } from './spend';
import { NativeResultReader } from './native-result';

// Runs one task: the command the preset builds, or the operator's own in a shell, with the
// task on stdin and its context in the environment. Everything the agent needs beyond the
// task — the issue, its comments, its fields — it reads itself through the API or MCP with
// the key handed to it here.

// A queued run and a chat message differ only in these.
export interface Task {
  prompt: string;
  // A preset with no flag for it puts this in front of the prompt; the operator's own
  // command reads it from the environment.
  systemPrompt: string;
  env: Record<string, string>;
  // The coding agent session to resume, for a preset that keeps them.
  sessionId?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  // Limits of a queued run; a chat answer has none.
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  // The toolsets Hermes is limited to, or null for the profile's own selection.
  toolsets?: string[] | null;
  // An image the model reads with the prompt.
  image?: string | null;
  // What the agent's runtime adapter asks of this command (runtime.ts).
  hooks?: CommandHooks;
  // Helena's Autopilot level; absent on an older server.
  autopilotLevel?: number | null;
  // The names of the environment variables Helena delivered for this work (their values are
  // in `env`), which a runtime that filters its tool processes' environment lets through.
  delivered?: string[];
  // What the runtime adapter adds to a task read as JSON (promptVia `stdin-json`).
  input?: Record<string, unknown>;
}

export interface Outcome {
  status: 'success' | 'failed';
  output: string;
  error?: string;
  // What the whole run read, cache included, and wrote, for a command that reports
  // its totals (Hermes).
  usage?: ContextUsage;
  spend?: Spend;
  // The Hermes session the command ran in, and the tool calls it made there.
  sessionId?: string;
  toolCalls?: number;
  // Why it failed, where the runtime's words say (its type's classifyFailure): a model the
  // provider does not serve this account, a refusal no retry passes.
  failure?: RuntimeFailure;
}

// Only the tail of each stream is reported, so a long transcript still shows its ending —
// the part that says what the agent did — without sending megabytes back.
const OUTPUT_LIMIT = 8000;
const COMMAND_OUTPUT_LIMIT = 64 * 1024;
const ERROR_LIMIT = 400;
const RESULT_LIMIT_BYTES = 128 * 1024;
// How much of what Hermes printed outside the protocol a failure keeps: its last lines.
const HERMES_PRINTED_LIMIT = 1200;

function executionTimeoutMs(config: RunnerConfig, task: Task): number {
  return config.agent === 'command' && task.runBudgetSeconds != null
    ? Math.min(config.timeoutMs, task.runBudgetSeconds * 1000)
    : config.timeoutMs;
}

// Hermes' closing `result` line carries the final answer and the token counts of its
// session, summed over every model call of the run.
class HermesResultReader {
  private line = '';
  private oversized = false;
  // `error` is Hermes' own summary of a failed turn (the provider's words), `reason` and
  // `retryable` its verdict on it where the result line carries one.
  result:
    | {
        text: string;
        exitCode: number;
        error?: string;
        reason?: string;
        retryable?: boolean;
      }
    | undefined;
  usage: ContextUsage | undefined;
  // Named on the first line and again on the result, after a compression that moved the
  // session to a new id.
  sessionId: string | undefined;
  toolCalls = 0;
  // What Hermes printed on stdout outside the protocol. A turn that never started says why
  // only there: a failed agent start prints "Hermes couldn't start the model connection: …"
  // through its console and then the bare result "credentials or agent init failed"
  // (2026-09-25: a file of the anthropic SDK the agent could not read, three days unseen).
  printed: string[] = [];
  private printedLength = 0;

  // Told as soon as a session id is read, and again if a compression moves it to a new
  // one, so the caller can save it well before the run itself is done.
  constructor(private onSessionId?: (sessionId: string) => void) {}

  write(chunk: string): void {
    const lines = chunk.split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (!this.oversized) {
        this.line += lines[index];
        if (this.line.length > 1_048_576) {
          this.line = '';
          this.oversized = true;
        }
      }
      if (index < lines.length - 1) this.end();
    }
  }

  end(): void {
    try {
      const value = this.oversized ? null : JSON.parse(this.line);
      if (value?.type === 'tool_use') this.toolCalls++;
      if (typeof value?.session_id === 'string' && value.session_id) {
        if (value.session_id !== this.sessionId) this.onSessionId?.(value.session_id);
        this.sessionId = value.session_id;
      }
      if (value?.type === 'result' && typeof value.text === 'string') {
        this.result = {
          text: value.text,
          exitCode: typeof value.exit_code === 'number' ? value.exit_code : 0,
          ...(typeof value.error === 'string' && value.error && { error: value.error }),
          ...(typeof value.failure_reason === 'string' && { reason: value.failure_reason }),
          ...(typeof value.failure_retryable === 'boolean' && {
            retryable: value.failure_retryable,
          }),
        };
      }
      const tokens = value?.type === 'result' ? value.tokens : undefined;
      if (tokens && typeof tokens === 'object') {
        const count = (key: string) => (typeof tokens[key] === 'number' ? tokens[key] : 0);
        this.usage = {
          inputTokens: count('input') + count('cache_read') + count('cache_write'),
          outputTokens: count('output'),
        };
      }
    } catch {
      // Non-JSON CLI diagnostics do not replace the final result; a failure names them.
      this.keepPrinted();
    }
    this.line = '';
    this.oversized = false;
  }

  private keepPrinted(): void {
    const text = this.oversized ? '' : this.line.trim();
    if (!text) return;
    this.printed.push(text);
    this.printedLength += text.length;
    while (this.printed.length > 1 && this.printedLength > HERMES_PRINTED_LIMIT) {
      this.printedLength -= this.printed.shift()!.length;
    }
  }
}

// Applied as the output arrives, so a command that prints for half an hour does not buffer
// all of it to have everything but the last few kilobytes thrown away.
function tail(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}

function childEnv(config: RunnerConfig, task: Task): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    ...config.env,
    ITSAPLAN_URL: config.url,
    ITSAPLAN_API_KEY: config.apiKey,
    ...task.env,
  };
}

// The command gets its own process group, so the Ctrl-C that stops the runner does not
// reach it — the runner promises to finish what is in flight. The timeout and the
// member's stop then have to kill that group themselves, or a command that is a
// pipeline leaves its children behind.
// How long a stopped command gets to end its turn before its process group is killed.
const KILL_GRACE_MS = 5_000;

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

// An interrupt lets Hermes end the turn and save its session; the kill that follows
// covers a command, or a process it started, that ignores it.
function stopGroup(pid: number): void {
  signalGroup(pid, 'SIGINT');
  setTimeout(() => signalGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
}

// A model the catalog lists under another provider runs there; the agent's default
// model and any model the catalog does not know run on the runner's own provider.
export function modelProvider(
  config: RunnerConfig,
  model: string | null | undefined,
  thinkingLevel?: string | null,
): string | undefined {
  // A model of Helena's local AI names its provider (`helena-<slug>/<model>`); without
  // thinking, the same server's provider whose turns do not think (local-ai.ts).
  const local = localRoute(model, thinkingLevel);
  if (local) return local.provider;
  return config.models.find((entry) => entry.id === model)?.provider ?? config.provider;
}

// The model id the runtime is handed: a local model as its server names it.
export function runtimeModel(model: string | null | undefined): string | null | undefined {
  return localRoute(model)?.model ?? model;
}

// A preset is spawned directly, with no shell in between: the session id and the
// operator's arguments reach the command as they are, with nothing to quote. The
// operator's own command goes through a shell, which is what it was written for.
function spawnArgs(
  config: RunnerConfig,
  preset: CliCommand | undefined,
  task: Task,
  present: string[] = [],
): [string, string[]] {
  if (!preset) return ['sh', ['-c', config.command ?? '']];
  const argv = presetArgv(
    preset,
    task.sessionId ?? null,
    task.systemPrompt,
    config.args,
    task.prompt,
    {
      provider: modelProvider(config, task.model, task.thinkingLevel),
      model: runtimeModel(task.model),
      thinkingLevel: task.thinkingLevel,
      maxTurns: task.maxTurns,
      runBudgetSeconds: task.runBudgetSeconds,
      toolsets: task.toolsets,
      image: task.image,
      sandbox: task.hooks?.sandbox,
      autopilotLevel: task.autopilotLevel,
      policyHook: task.autopilotLevel == null ? null : policyHookCommand(),
      toolEnv: task.delivered?.length ? { delivered: task.delivered, present } : null,
    },
  );
  return commandFor(preset, argv, isolationEnabled());
}

// A subcommand of this runner's own bundle (Helena's own loop) runs on the same Node with the
// same script. The isolation launcher's preset names Node, the script and the subcommand
// itself (launcher.json `fixedArgs`), so an isolated command sends only its own arguments:
// sending the prefix too made the loop read the script path as an unknown argument.
export function commandFor(
  preset: Pick<CliCommand, 'bin'> & { runnerSubcommand?: boolean },
  argv: string[],
  isolated: boolean,
  node: string = process.execPath,
  script: string | undefined = process.argv[1],
): [string, string[]] {
  if (preset.runnerSubcommand && script && !isolated) return [node, [script, preset.bin, ...argv]];
  return [preset.bin, argv];
}

// The names in the environment the command starts with (the launcher and the sandbox add
// only their own, none of them a secret).
function commandEnvNames(config: RunnerConfig, task: Task): string[] {
  const env = isolationEnabled()
    ? isolatedEnv(
        config.env,
        { ITSAPLAN_URL: config.url, ITSAPLAN_API_KEY: config.apiKey },
        task.env,
      )
    : childEnv(config, task);
  return Object.keys(env);
}

// A directory private to one command, for a runtime whose scratch files can hold the
// environment (Hermes' terminal snapshot: `export -p` of the shell, delivered variables
// included). An isolated command's /tmp is its unit's own and goes with the unit; a command
// the runner starts itself gets a fresh 0700 directory that is removed when it ends. The
// operator's own setting of the variable is left alone.
async function scratchDir(
  config: RunnerConfig,
  preset: CliCommand | undefined,
): Promise<{ env: Record<string, string>; cleanup: () => Promise<void> } | null> {
  const name = preset?.scratchDirEnv;
  if (!name || config.env[name]) return null;
  if (isolationEnabled()) return { env: { [name]: '/tmp' }, cleanup: async () => {} };
  const dir = await mkdtemp(join(tmpdir(), 'helena-run-'));
  return { env: { [name]: dir }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// The command Claude Code runs before each tool call: this runner's `policy-hook`, which
// asks Helena's policy engine. It blocks the call (exit 2) when it cannot even start, so a
// missing runner never lets a call through unchecked.
export function policyHookCommand(
  node: string = process.execPath,
  script: string | null | undefined = process.argv[1],
): string | null {
  if (!script) return null;
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return `${quote(node)} ${quote(script)} policy-hook || exit 2`;
}

// Codex runs the model's shell commands in a sandbox of its own (bubblewrap), which cannot
// start inside the container Helena runs in. A Codex command without that sandbox
// (danger-full-access, or the bypass flag) has no boundary but Helena's agent isolation,
// where the agent runs as its project's user in a unit of its own. So such a command is
// started only there, whoever asked for it (owner decision 2026-09-24).
const CODEX_BYPASS = new Set([
  '--dangerously-bypass-approvals-and-sandbox',
  '--yolo',
  '--sandbox=danger-full-access',
  '-s=danger-full-access',
]);

export function codexWithoutSandbox(argv: string[]): boolean {
  const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  return argv.some((arg, index) => {
    if (CODEX_BYPASS.has(arg)) return true;
    const sandbox =
      arg === '-s' || arg === '--sandbox'
        ? argv[index + 1]
        : /^(?:--sandbox=|-s=?)(.+)$/.exec(arg)?.[1];
    if (sandbox && unquote(sandbox) === 'danger-full-access') return true;
    const config =
      arg === '-c' || arg === '--config'
        ? argv[index + 1]
        : /^(?:--config=|-c=?)(.+)$/.exec(arg)?.[1];
    if (!config) return false;
    const value = /^\s*sandbox_mode\s*=\s*(.+)$/.exec(config)?.[1];
    return value != null && unquote(value) === 'danger-full-access';
  });
}

export function assertCodexSandbox(
  config: Pick<RunnerConfig, 'isolation'>,
  preset: CliCommand | undefined,
  argv: string[],
): void {
  if (preset?.bin !== 'codex') return;
  const isolated = isolationEnabled() && config.isolation !== undefined;
  if (!isolated && codexWithoutSandbox(argv)) {
    throw new Error(
      `Codex runs without its sandbox only inside ${runnerDisplayName()}'s agent isolation; this agent is not isolated`,
    );
  }
}

// How long one command may hold the start gate of a login file before the next one starts
// anyway (runtime.ts StartGate).
const START_GATE_MS = 60_000;
// The first line that shows the model answered: the login was used, refreshed or refused.
const MODEL_ANSWERED =
  /"type":"(?:item\.(?:started|completed)|turn\.(?:completed|failed)|assistant)"/;

// Holds the gate until the command's first model answer, its end, or the deadline.
async function openGate(hooks: CommandHooks | undefined): Promise<{
  seen: (chunk: string) => void;
  release: () => void;
}> {
  const release = hooks?.startGate ? await hooks.startGate.acquire() : null;
  let open = release === null;
  const done = () => {
    if (open) return;
    open = true;
    clearTimeout(timer);
    release?.();
  };
  const timer = setTimeout(done, START_GATE_MS);
  timer.unref?.();
  if (open) clearTimeout(timer);
  return {
    seen: (chunk) => {
      if (!open && MODEL_ANSWERED.test(chunk)) done();
    },
    release: done,
  };
}

// A CLI that took the task as an argument would read it twice if it also arrived here.
function stdinText(preset: CliCommand | undefined, task: Task, command = false): string {
  if (command) {
    return JSON.stringify({
      prompt: task.prompt,
      systemPrompt: task.systemPrompt,
      sessionId: task.sessionId ?? null,
      model: task.model ?? null,
      thinkingLevel: task.thinkingLevel ?? null,
      maxTurns: task.maxTurns ?? null,
      runBudgetSeconds: task.runBudgetSeconds ?? null,
      autopilotLevel: task.autopilotLevel ?? null,
    });
  }
  if (!preset) return task.prompt;
  if (preset.promptVia === 'arg') return '';
  if (preset.promptVia === 'stdin-json') {
    return JSON.stringify({
      prompt: task.prompt,
      systemPrompt: task.systemPrompt,
      sessionId: task.sessionId ?? null,
      model: task.model ?? null,
      thinkingLevel: task.thinkingLevel ?? null,
      maxTurns: task.maxTurns ?? null,
      runBudgetSeconds: task.runBudgetSeconds ?? null,
      autopilotLevel: task.autopilotLevel ?? null,
      ...task.input,
    });
  }
  return presetPrompt(preset, task.systemPrompt, task.prompt);
}

export interface ExecuteOptions {
  onData?: (chunk: string) => void;
  // Fired as soon as the command names its session, and again if it moves to a new
  // one. Only hermes-stream-json commands report one.
  onSessionId?: (sessionId: string) => void;
  signal?: AbortSignal;
  // What the command works on, which the unit of an isolated agent is named after.
  work?: { kind: WorkKind; id: number | null };
}

// `onData` sees stdout as it arrives, for a caller that reports the output while the
// command is still running. `signal` ends the command the way the timeout does, for a
// chat answer the member stopped.
export async function execute(
  config: RunnerConfig,
  task: Task,
  opts: ExecuteOptions = {},
): Promise<Outcome> {
  if (config.agent === 'webhook') return executeWebhook(config, task, opts);
  const preset = presetOf(config);
  const scratch = await scratchDir(config, preset);
  const run = scratch ? { ...task, env: { ...task.env, ...scratch.env } } : task;
  try {
    const [bin, args] = spawnArgs(config, preset, run, commandEnvNames(config, run));
    assertCodexSandbox(config, preset, args);
    const gate = await openGate(run.hooks);
    try {
      const command = config.agent === 'command';
      const outputOptions = command ? { ...opts, onData: undefined } : opts;
      const raw = isolationEnabled()
        ? await executeIsolated(config, run, preset, args, outputOptions, gate.seen)
        : await executeLocal(config, run, preset, bin, args, outputOptions, gate.seen);
      const outcome =
        command && raw.status === 'success' ? externalResult(raw.output, 'command') : raw;
      if (command && outcome.output) opts.onData?.(outcome.output);
      run.hooks?.finished?.({ status: outcome.status, error: outcome.error });
      return outcome;
    } finally {
      gate.release();
    }
  } finally {
    await scratch?.cleanup().catch(() => {});
  }
}

async function executeLocal(
  config: RunnerConfig,
  task: Task,
  preset: CliCommand | undefined,
  bin: string,
  args: string[],
  opts: ExecuteOptions,
  seen: (chunk: string) => void,
): Promise<Outcome> {
  const child = spawn(bin, args, {
    cwd: config.cwd,
    env: childEnv(config, task),
    detached: true,
  });

  const kill = () => {
    if (child.pid !== undefined) stopGroup(child.pid);
  };
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      kill();
    },
    executionTimeoutMs(config, task),
  );
  opts.signal?.addEventListener('abort', kill, { once: true });
  // A stop that came before the command started fires no event.
  if (opts.signal?.aborted) kill();

  let stdout = '';
  let stderr = '';
  let commandOutputTooLarge = false;
  const hermesResult =
    config.outputFormat === 'hermes-stream-json' ? new HermesResultReader(opts.onSessionId) : null;
  const nativeResult = config.outputFormat === 'helena-jsonl' ? new NativeResultReader() : null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const next = stdout + chunk;
    if (config.agent === 'command' && Buffer.byteLength(next, 'utf8') > COMMAND_OUTPUT_LIMIT) {
      commandOutputTooLarge = true;
    }
    stdout = tail(next, config.agent === 'command' ? COMMAND_OUTPUT_LIMIT : OUTPUT_LIMIT);
    hermesResult?.write(chunk);
    nativeResult?.write(chunk);
    seen(chunk);
    task.hooks?.output?.(chunk);
    opts.onData?.(chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr = tail(stderr + chunk, ERROR_LIMIT);
  });
  // A command that ignores stdin closes the pipe before the prompt is written, which is an
  // EPIPE the runner has no reason to fail on.
  child.stdin.on('error', () => {});
  child.stdin.end(stdinText(preset, task, config.agent === 'command'));

  // 'close' also waits for the command's stdio to close, which never happens if a
  // grandchild it left behind inherited the same pipe -- a killed command must not be
  // able to hang the run that way. 'exit' alone can fire before the last chunk of
  // output is delivered, so it is given a brief moment to catch a 'close' that is
  // already on its way before it is trusted on its own.
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
    child.on('exit', (exitCode, exitSignal) => {
      setTimeout(() => resolve({ code: exitCode, signal: exitSignal }), 200).unref();
    });
  });

  let code: number | null;
  let signal: string | null;
  try {
    ({ code, signal } = await exited);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', kill);
  }

  hermesResult?.end();
  nativeResult?.end();
  if (commandOutputTooLarge) {
    return { status: 'failed', output: '', error: 'Command output exceeds 64 KiB' };
  }
  return finalOutcome(
    config,
    preset,
    settle(
      code,
      signal,
      timedOut,
      stdout,
      stderr,
      executionTimeoutMs(config, task),
      hermesResult,
      nativeResult,
    ),
    hermesResult,
    nativeResult,
  );
}

// The same command, started by the launcher as the project's user in its sandbox. The
// output is read the same way; stopping it closes the connection, and the launcher stops
// the unit (SIGINT, SIGKILL after a grace period).
async function executeIsolated(
  config: RunnerConfig,
  task: Task,
  preset: CliCommand | undefined,
  args: string[],
  opts: ExecuteOptions,
  seen: (chunk: string) => void,
): Promise<Outcome> {
  const isolation = config.isolation;
  if (!isolation) {
    throw new Error(
      'Agent isolation is on and this agent has no isolated project, so it is not started',
    );
  }
  // The runtimes the launcher knows as presets of its own (launcher.json) say so in their
  // capabilities.
  if (!preset || !config.agent || !runtimeOf(config.agent)?.capabilities.isolation) {
    throw new Error(`${config.agent ?? 'A custom command'} cannot run isolated`);
  }
  if (!config.cwd) throw new Error('An isolated agent needs its working directory');
  const stop = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      stop.abort();
    },
    executionTimeoutMs(config, task),
  );
  const onAbort = () => stop.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  // A stop that came before the command started fires no event.
  if (opts.signal?.aborted) stop.abort();

  let stdout = '';
  let stderr = '';
  let commandOutputTooLarge = false;
  const hermesResult =
    config.outputFormat === 'hermes-stream-json' ? new HermesResultReader(opts.onSessionId) : null;
  const nativeResult = config.outputFormat === 'helena-jsonl' ? new NativeResultReader() : null;
  const out = new StringDecoder('utf8');
  const err = new StringDecoder('utf8');
  const onStdout = (text: string) => {
    if (!text) return;
    const next = stdout + text;
    if (config.agent === 'command' && Buffer.byteLength(next, 'utf8') > COMMAND_OUTPUT_LIMIT) {
      commandOutputTooLarge = true;
    }
    stdout = tail(next, config.agent === 'command' ? COMMAND_OUTPUT_LIMIT : OUTPUT_LIMIT);
    hermesResult?.write(text);
    nativeResult?.write(text);
    seen(text);
    task.hooks?.output?.(text);
    opts.onData?.(text);
  };
  let code: number | null = null;
  let signal: string | null = null;
  try {
    const result = await launch(
      {
        slug: isolation.slug,
        profile: isolation.profile,
        runtime: config.agent,
        args,
        env: isolatedEnv(
          config.env,
          { ITSAPLAN_URL: config.url, ITSAPLAN_API_KEY: config.apiKey },
          task.env,
        ),
        cwd: config.cwd,
        agentId: isolation.agentId,
        work: opts.work ?? { kind: 'run', id: null },
        limits: { runtimeMaxSec: Math.ceil(executionTimeoutMs(config, task) / 1000) + 60 },
      },
      {
        stdin: stdinText(preset, task, config.agent === 'command'),
        onStdout: (chunk) => onStdout(out.write(chunk)),
        onStderr: (chunk) => {
          stderr = tail(stderr + err.write(chunk), ERROR_LIMIT);
        },
        signal: stop.signal,
      },
    );
    code = result.code;
  } catch (error) {
    if (!(error instanceof LaunchError && error.code === 'aborted')) throw error;
    signal = 'SIGINT';
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
  onStdout(out.end());
  hermesResult?.end();
  nativeResult?.end();
  if (commandOutputTooLarge) {
    return { status: 'failed', output: '', error: 'Command output exceeds 64 KiB' };
  }
  return finalOutcome(
    config,
    preset,
    settle(
      code,
      signal,
      timedOut,
      stdout,
      stderr,
      executionTimeoutMs(config, task),
      hermesResult,
      nativeResult,
    ),
    hermesResult,
    nativeResult,
  );
}

// Final protocol metadata and runtime failure classification.
function finalOutcome(
  config: RunnerConfig,
  preset: CliCommand | undefined,
  settled: Outcome,
  hermesResult: HermesResultReader | null,
  nativeResult: NativeResultReader | null,
): Outcome {
  const outcome = hermesResult
    ? {
        ...settled,
        ...(hermesResult.usage && { usage: hermesResult.usage }),
        ...(hermesResult.sessionId && { sessionId: hermesResult.sessionId }),
        ...(hermesResult.toolCalls > 0 && { toolCalls: hermesResult.toolCalls }),
      }
    : settled;
  return preset
    ? withFailure(config, outcome, nativeResult?.result ?? hermesResult?.result)
    : outcome;
}

// A failed command's reason, in the words of its runtime type (classifyFailure), with
// the verdict from its final result line.
export function withFailure(
  config: Pick<RunnerConfig, 'agent'>,
  outcome: Outcome,
  verdict?: { reason?: string; retryable?: boolean },
): Outcome {
  if (outcome.status !== 'failed' || outcome.failure) return outcome;
  const failure = runtimeOf(config.agent)?.classifyFailure?.({
    output: outcome.output,
    error: outcome.error ?? null,
    reason: verdict?.reason ?? null,
    retryable: verdict?.retryable ?? null,
  });
  return failure ? { ...outcome, failure } : outcome;
}

function settle(
  code: number | null,
  signal: string | null,
  timedOut: boolean,
  stdout: string,
  stderr: string,
  timeoutMs: number,
  hermesResult: HermesResultReader | null,
  nativeResult: NativeResultReader | null,
): Outcome {
  const output = nativeResult?.result?.text ?? hermesResult?.result?.text ?? stdout.trim();
  if (
    (nativeResult?.result || hermesResult?.result) &&
    Buffer.byteLength(output, 'utf8') > RESULT_LIMIT_BYTES
  )
    return {
      status: 'failed',
      output: '',
      error: `${nativeResult ? 'Native' : 'Hermes'} final result exceeds 128 KiB`,
    };
  if (timedOut) return { status: 'failed', output, error: `Timed out after ${timeoutMs}ms` };
  const native = nativeResult?.result;
  if (code === 0 && nativeResult && !native)
    return { status: 'failed', output: '', error: 'Native stream ended without a final result' };
  if (native?.exitCode)
    return {
      status: 'failed',
      output,
      error:
        native.error || native.reason || `Native runtime reported exit code ${native.exitCode}`,
    };
  if (code === 0 && hermesResult && !hermesResult.result)
    return { status: 'failed', output: '', error: 'Hermes stream ended without a final result' };
  const result = hermesResult?.result;
  const printed = hermesResult?.printed ?? [];
  if (code === 0 && result?.exitCode)
    return {
      status: 'failed',
      output,
      error:
        hermesError(result, stderr, false, printed) ??
        `Hermes reported exit code ${result.exitCode}`,
    };
  if (code === 0) return { status: 'success', output };
  return {
    status: 'failed',
    output,
    error:
      (hermesResult ? hermesError(result, stderr, true, printed) : stderr.trim()) ||
      (signal ? `Command killed by ${signal}` : `Command exited with ${code}`),
  };
}

// Hermes ends its stderr with the session it ran in ("session_id: …"), which says nothing
// about a failure. What failed is on its result line: the provider's summary in `error`, and,
// for a process that failed, Hermes' own account of the failed turn in the text ("…
// rejected the request and retrying won't help … Provider said: HTTP 400: …"). What it printed
// on stdout outside the protocol comes next (a start that failed says why only there, wrapped
// at the console's width, so its lines are joined), then anything else on stderr (a sandbox
// note, a traceback).
const HERMES_SESSION_LINE = /^\s*session_id:\s*\S*\s*$/gm;
const HERMES_ERROR_LIMIT = 500;

export function hermesError(
  result: HermesResultReader['result'],
  stderr: string,
  fromText: boolean,
  stdoutLines: readonly string[] = [],
): string | undefined {
  const printed = stderr.replace(HERMES_SESSION_LINE, '').trim();
  const said = stdoutLines.join(' ').replace(/\s+/g, ' ').trim();
  const text = fromText ? (result?.text.trim() ?? '') : '';
  const told =
    result?.error ||
    (!printed && text ? (/Provider said:\s*([^\n]+)/.exec(text)?.[1] ?? text.split('\n')[0]!) : '');
  // Within the limit: the result's words whole where they fit, then the end of the print (its
  // last line says what happened), then the start of stderr.
  const pieces: string[] = [];
  let room = HERMES_ERROR_LIMIT;
  for (const [part, keepEnd] of [
    [told, false],
    [said, true],
    [printed, false],
  ] as const) {
    const budget = room - (pieces.length ? 1 : 0);
    if (!part || budget < 2) continue;
    const piece =
      part.length <= budget
        ? part
        : keepEnd
          ? `…${part.slice(-(budget - 1))}`
          : `${part.slice(0, budget - 1)}…`;
    pieces.push(piece);
    room = budget - piece.length;
  }
  return pieces.length ? pieces.join('\n') : undefined;
}
