import { spawn } from 'node:child_process';
import { presetOf, type RunnerConfig } from './config';
import { presetArgv, presetPrompt, type Preset } from './presets';

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
}

export interface Outcome {
  status: 'success' | 'failed';
  output: string;
  error?: string;
}

// Only the tail of each stream is reported, so a long transcript still shows its ending —
// the part that says what the agent did — without sending megabytes back.
const OUTPUT_LIMIT = 8000;
const ERROR_LIMIT = 400;
const HERMES_RESULT_LIMIT_BYTES = 128 * 1024;

class HermesResultReader {
  private line = '';
  private oversized = false;
  result: { text: string; exitCode: number } | undefined;

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
      if (value?.type === 'result' && typeof value.text === 'string') {
        this.result = {
          text: value.text,
          exitCode: typeof value.exit_code === 'number' ? value.exit_code : 0,
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

// A preset is spawned directly, with no shell in between: the session id and the
// operator's arguments reach the command as they are, with nothing to quote. The
// operator's own command goes through a shell, which is what it was written for.
function spawnArgs(
  config: RunnerConfig,
  preset: Preset | undefined,
  task: Task,
): [string, string[]] {
  if (!preset) return ['sh', ['-c', config.command ?? '']];
  return [
    preset.bin,
    presetArgv(preset, task.sessionId ?? null, task.systemPrompt, config.args, task.prompt, {
      provider: config.provider,
      model: task.model,
      thinkingLevel: task.thinkingLevel,
    }),
  ];
}

// A CLI that took the task as an argument would read it twice if it also arrived here.
function stdinText(preset: Preset | undefined, task: Task): string {
  if (!preset) return task.prompt;
  if (preset.promptVia === 'arg') return '';
  return presetPrompt(preset, task.systemPrompt, task.prompt);
}

// `onData` sees stdout as it arrives, for a caller that reports the output while the
// command is still running. `signal` ends the command the way the timeout does, for a
// chat answer the member stopped.
export async function execute(
  config: RunnerConfig,
  task: Task,
  opts: { onData?: (chunk: string) => void; signal?: AbortSignal } = {},
): Promise<Outcome> {
  const preset = presetOf(config);
  const [bin, args] = spawnArgs(config, preset, task);
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

  let stdout = '';
  let stderr = '';
  const hermesResult =
    config.outputFormat === 'hermes-stream-json' ? new HermesResultReader() : null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout = tail(stdout + chunk, OUTPUT_LIMIT);
    hermesResult?.write(chunk);
    opts.onData?.(chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    stderr = tail(stderr + chunk, ERROR_LIMIT);
  });
  // A command that ignores stdin closes the pipe before the prompt is written, which is an
  // EPIPE the runner has no reason to fail on.
  child.stdin.on('error', () => {});
  child.stdin.end(stdinText(preset, task));

  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
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
  const output = hermesResult?.result?.text ?? stdout.trim();
  if (hermesResult?.result && Buffer.byteLength(output, 'utf8') > HERMES_RESULT_LIMIT_BYTES)
    return { status: 'failed', output: '', error: 'Hermes final result exceeds 128 KiB' };
  if (code === 0 && hermesResult && !hermesResult.result)
    return { status: 'failed', output: '', error: 'Hermes stream ended without a final result' };
  if (code === 0 && hermesResult?.result?.exitCode)
    return {
      status: 'failed',
      output,
      error: `Hermes reported exit code ${hermesResult.result.exitCode}`,
    };
  if (code === 0) return { status: 'success', output };
  // The timeout says more about the failure than whatever the command printed.
  if (timedOut) return { status: 'failed', output, error: `Timed out after ${config.timeoutMs}ms` };
  return {
    status: 'failed',
    output,
    error:
      stderr.trim() || (signal ? `Command killed by ${signal}` : `Command exited with ${code}`),
  };
}
