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
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let timedOut = false;
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
      resolve({ code, output, timedOut });
    };
    child.on('error', () => done(127));
    child.on('close', (code) => done(code));
  });
}

export function shellTool(options: { timeoutMs: number; delivered?: string[] }): AgentTool {
  return {
    name: 'shell',
    kind: 'shell',
    description:
      'Run a shell command in the working folder and get its output (stdout and stderr together, the end of long output). ' +
      'Use it to run tests, builds, git and small scripts. No interactive commands.',
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
      if (!command) return error('No command.');
      const cwd = await realpath(ctx.workdir);
      const result = await runShell(
        command,
        cwd,
        shellEnv(ctx.env, options.delivered),
        options.timeoutMs,
        ctx.signal,
      );
      const head = result.timedOut
        ? `Timed out after ${Math.round(options.timeoutMs / 1000)} s.`
        : `Exit code ${result.code}.`;
      return {
        text: `${head}\n${result.output.trim() || '(no output)'}`,
        isError: result.timedOut || result.code !== 0,
        changed: true,
        exitCode: result.timedOut ? null : result.code,
        test: isTestCommand(command),
      };
    },
  };
}
