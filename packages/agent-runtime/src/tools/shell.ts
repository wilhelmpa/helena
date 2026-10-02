import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { error, text, type AgentTool, type ToolOutput } from './types';

// One shell command in the working folder. Inside Helena's agent isolation the loop runs as
// the project's user in the project's sandbox unit, so this command does too: that is the
// boundary, and Helena's policy engine classifies the command before it runs (the loop asks
// it; `question`). Without isolation the tool exists only where the config allows it (evals,
// an operator's own machine).
//
// The command's environment leaves out every variable whose name reads like a secret (KEY,
// SECRET, TOKEN, PASSWORD), as Codex does, except the ones Helena delivered for the work.

const OUTPUT_LIMIT = 30_000;
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;
// A command that runs a test suite, read from its words.
const TEST_COMMAND =
  /(^|[\s;&|(])(bun\s+test|npm\s+(run\s+)?test|pnpm\s+(run\s+)?test|yarn\s+test|npx\s+(vitest|jest)|vitest|jest|pytest|python3?\s+-m\s+(unittest|pytest)|go\s+test|cargo\s+test|make\s+test)\b/;

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

export function shellEnv(
  env: Record<string, string | undefined>,
  delivered: string[] = [],
): Record<string, string> {
  const allowed = new Set(delivered);
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_NAME.test(name) && !allowed.has(name)) continue;
    if (name.startsWith('ITSAPLAN_') || name.startsWith('HELENA_AGENT_')) continue;
    result[name] = value;
  }
  return result;
}

function tail(value: string): string {
  return value.length <= OUTPUT_LIMIT ? value : `…${value.slice(-OUTPUT_LIMIT)}`;
}

export function runShell(
  command: string,
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{
  code: number | null;
  output: string;
  timedOut: boolean;
  startError?: string;
  aborted?: boolean;
}> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve({ code: null, output: '', timedOut: false, aborted: true });
      return;
    }
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
    let startError: string | undefined;
    const killGroup = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // gone already
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const onAbort = () => killGroup();
    signal.addEventListener('abort', onAbort, { once: true });
    const append = (chunk: Buffer) => {
      output = tail(output + chunk.toString('utf8'));
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const done = (code: number | null) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve({ code, output, timedOut, startError, aborted: signal.aborted });
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      startError = error.code ?? 'spawn failed';
      done(null);
    });
    child.on('close', (code) => done(code));
  });
}

export function shellTool(options: { timeoutMs: number; delivered?: string[] }): AgentTool {
  return {
    name: 'shell',
    kind: 'shell',
    description:
      'Run a shell command in the working folder and get its output (stdout and stderr together, the end of long output). ' +
      'Use it to run tests, builds, git and small scripts. No interactive commands. ' +
      'Prefer small calls. Guard optional files with if test -f FILE; then COMMAND; fi or (test -f FILE && COMMAND) || true. ' +
      'Use ; for independent checks, && for dependencies. Nonzero exit codes preserve useful output; inspect outcome and exitCode.',
    timeoutMs: options.timeoutMs + 5_000,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
    },
    question: (input) => ({ tool: 'shell', command: text(input.command) }),
    async execute(input, ctx): Promise<ToolOutput> {
      const command = text(input.command).trim();
      if (!command) return { ...error('No command.'), outcome: 'error' };
      const cwd = await realpath(ctx.workdir).catch(() => null);
      if (!cwd) return { ...error('Working folder is unavailable.'), outcome: 'error' };
      const result = await runShell(
        command,
        cwd,
        shellEnv(ctx.env, options.delivered),
        options.timeoutMs,
        ctx.signal,
      );
      const failed =
        result.timedOut ||
        result.aborted ||
        !!result.startError ||
        result.code === null ||
        result.code === 126 ||
        result.code === 127 ||
        (result.code !== 0 && /permission denied|operation not permitted/i.test(result.output));
      let outcome: ToolOutput['outcome'] = 'ok';
      if (failed) outcome = 'error';
      else if (result.code !== 0) outcome = 'nonzero_with_output';
      let head = `Exit code ${result.code}.`;
      if (result.timedOut) head = `Timed out after ${Math.round(options.timeoutMs / 1000)} s.`;
      else if (result.startError) head = `Could not start command (${result.startError}).`;
      else if (result.aborted) head = 'Command aborted.';
      let hint = '';
      if (outcome === 'nonzero_with_output') {
        hint =
          'The command completed with a nonzero exit code. Inspect partial results; do not claim the command or tests passed.';
        if (/no such file|cannot open|not found/i.test(result.output))
          hint =
            'A file or path may be missing. Earlier output remains usable; check the failing part.';
        else if (/AGENTS\.md/.test(command))
          hint =
            'The optional AGENTS.md read may have failed (inference; stderr may be hidden). Earlier output remains usable.';
      }
      return {
        text: `${head}\n${hint}\n${result.output.trim() || '(no output)'}`,
        isError: outcome === 'error',
        outcome,
        changed: true,
        exitCode: result.timedOut ? null : result.code,
        test: isTestCommand(command),
      };
    },
  };
}
