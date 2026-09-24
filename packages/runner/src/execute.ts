import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { ContextUsage } from './agui';
import { presetOf, type RunnerConfig } from './config';
import { isolatedEnv, isolationEnabled, launch, LaunchError, type WorkKind } from './isolation';
import type { CliCommand, RuntimeFailure } from '@helena/sdk';
import { presetArgv, presetPrompt } from './presets';
import type { CommandHooks } from './runtime';
import { runtimeOf } from './runtimes';

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
}

export interface Outcome {
  status: 'success' | 'failed';
  output: string;
  error?: string;
  // What the whole run read, cache included, and wrote, for a command that reports
  // its totals (Hermes).
  usage?: ContextUsage;
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
const ERROR_LIMIT = 400;
const HERMES_RESULT_LIMIT_BYTES = 128 * 1024;

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
      // Non-JSON CLI diagnostics do not replace the final result.
    }
    this.line = '';
    this.oversized = false;
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
): string | undefined {
  return config.models.find((entry) => entry.id === model)?.provider ?? config.provider;
}

// A preset is spawned directly, with no shell in between: the session id and the
// operator's arguments reach the command as they are, with nothing to quote. The
// operator's own command goes through a shell, which is what it was written for.
function spawnArgs(
  config: RunnerConfig,
  preset: CliCommand | undefined,
  task: Task,
): [string, string[]] {
  if (!preset) return ['sh', ['-c', config.command ?? '']];
  return [
    preset.bin,
    presetArgv(preset, task.sessionId ?? null, task.systemPrompt, config.args, task.prompt, {
      provider: modelProvider(config, task.model),
      model: task.model,
      thinkingLevel: task.thinkingLevel,
      maxTurns: task.maxTurns,
      runBudgetSeconds: task.runBudgetSeconds,
      toolsets: task.toolsets,
      image: task.image,
      sandbox: task.hooks?.sandbox,
      autopilotLevel: task.autopilotLevel,
      policyHook: task.autopilotLevel == null ? null : policyHookCommand(),
    }),
  ];
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
  return argv.some((arg, index) => {
    if (CODEX_BYPASS.has(arg)) return true;
    const next = argv[index + 1];
    if ((arg === '-s' || arg === '--sandbox') && next === 'danger-full-access') return true;
    if ((arg === '-c' || arg === '--config') && next !== undefined) {
      return /^\s*sandbox_mode\s*=\s*"?danger-full-access"?\s*$/.test(next);
    }
    return /^--config=\s*sandbox_mode\s*=\s*"?danger-full-access"?\s*$/.test(arg);
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
      "Codex runs without its sandbox only inside Helena's agent isolation; this agent is not isolated",
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
function stdinText(preset: CliCommand | undefined, task: Task): string {
  if (!preset) return task.prompt;
  if (preset.promptVia === 'arg') return '';
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
  const preset = presetOf(config);
  const [bin, args] = spawnArgs(config, preset, task);
  assertCodexSandbox(config, preset, args);
  const gate = await openGate(task.hooks);
  try {
    const outcome = isolationEnabled()
      ? await executeIsolated(config, task, preset, args, opts, gate.seen)
      : await executeLocal(config, task, preset, bin, args, opts, gate.seen);
    task.hooks?.finished?.({ status: outcome.status, error: outcome.error });
    return outcome;
  } finally {
    gate.release();
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
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, config.timeoutMs);
  opts.signal?.addEventListener('abort', kill, { once: true });
  // A stop that came before the command started fires no event.
  if (opts.signal?.aborted) kill();

  let stdout = '';
  let stderr = '';
  const hermesResult =
    config.outputFormat === 'hermes-stream-json' ? new HermesResultReader(opts.onSessionId) : null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout = tail(stdout + chunk, OUTPUT_LIMIT);
    hermesResult?.write(chunk);
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
  child.stdin.end(stdinText(preset, task));

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
  return finalOutcome(
    config,
    preset,
    settle(code, signal, timedOut, stdout, stderr, config, hermesResult),
    hermesResult,
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
  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, config.timeoutMs);
  const onAbort = () => stop.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  // A stop that came before the command started fires no event.
  if (opts.signal?.aborted) stop.abort();

  let stdout = '';
  let stderr = '';
  const hermesResult =
    config.outputFormat === 'hermes-stream-json' ? new HermesResultReader(opts.onSessionId) : null;
  const out = new StringDecoder('utf8');
  const err = new StringDecoder('utf8');
  const onStdout = (text: string) => {
    if (!text) return;
    stdout = tail(stdout + text, OUTPUT_LIMIT);
    hermesResult?.write(text);
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
        limits: { runtimeMaxSec: Math.ceil(config.timeoutMs / 1000) + 60 },
      },
      {
        stdin: stdinText(preset, task),
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
  return finalOutcome(
    config,
    preset,
    settle(code, signal, timedOut, stdout, stderr, config, hermesResult),
    hermesResult,
  );
}

// What Hermes' result line adds to the outcome (the session's token totals, its id and its
// tool calls), and why a preset's command failed.
function finalOutcome(
  config: RunnerConfig,
  preset: CliCommand | undefined,
  settled: Outcome,
  hermesResult: HermesResultReader | null,
): Outcome {
  const outcome = hermesResult
    ? {
        ...settled,
        ...(hermesResult.usage && { usage: hermesResult.usage }),
        ...(hermesResult.sessionId && { sessionId: hermesResult.sessionId }),
        ...(hermesResult.toolCalls > 0 && { toolCalls: hermesResult.toolCalls }),
      }
    : settled;
  return preset ? withFailure(config, outcome, hermesResult?.result) : outcome;
}

// A failed command's reason, in the words of its runtime type (classifyFailure), with
// Hermes' own verdict where its result line carried one.
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
  config: RunnerConfig,
  hermesResult: HermesResultReader | null,
): Outcome {
  const output = hermesResult?.result?.text ?? stdout.trim();
  if (hermesResult?.result && Buffer.byteLength(output, 'utf8') > HERMES_RESULT_LIMIT_BYTES)
    return { status: 'failed', output: '', error: 'Hermes final result exceeds 128 KiB' };
  if (code === 0 && hermesResult && !hermesResult.result)
    return { status: 'failed', output: '', error: 'Hermes stream ended without a final result' };
  const result = hermesResult?.result;
  if (code === 0 && result?.exitCode)
    return {
      status: 'failed',
      output,
      error: hermesError(result, stderr, false) ?? `Hermes reported exit code ${result.exitCode}`,
    };
  if (code === 0) return { status: 'success', output };
  // The timeout says more about the failure than whatever the command printed.
  if (timedOut) return { status: 'failed', output, error: `Timed out after ${config.timeoutMs}ms` };
  return {
    status: 'failed',
    output,
    error:
      (hermesResult ? hermesError(result, stderr, true) : stderr.trim()) ||
      (signal ? `Command killed by ${signal}` : `Command exited with ${code}`),
  };
}

// Hermes ends its stderr with the session it ran in ("session_id: …"), which says nothing
// about a failure. What failed is on its result line: the provider's summary in `error`, and,
// for a process that failed, Hermes' own account of the failed turn in the text ("…
// rejected the request and retrying won't help … Provider said: HTTP 400: …"). Anything
// else on stderr (a sandbox note, a traceback) is kept after it.
const HERMES_SESSION_LINE = /^\s*session_id:\s*\S*\s*$/gm;
const HERMES_ERROR_LIMIT = 500;

export function hermesError(
  result: HermesResultReader['result'],
  stderr: string,
  fromText: boolean,
): string | undefined {
  const printed = stderr.replace(HERMES_SESSION_LINE, '').trim();
  const text = fromText ? (result?.text.trim() ?? '') : '';
  const told =
    result?.error ||
    (!printed && text ? (/Provider said:\s*([^\n]+)/.exec(text)?.[1] ?? text.split('\n')[0]!) : '');
  const error = [told, printed].filter(Boolean).join('\n');
  if (!error) return undefined;
  return error.length > HERMES_ERROR_LIMIT ? `${error.slice(0, HERMES_ERROR_LIMIT - 1)}…` : error;
}
