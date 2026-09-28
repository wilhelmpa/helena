import { spawn } from 'node:child_process';
import type { LocalAiChatAnswer, LocalAiChatRequest } from '@helena/sdk';

// The judge of command-line evals (scripts/local-ai-eval.ts --judge-cli): the owner's Claude
// Code or Codex CLI, logged in with the owner's own subscription, one call per text, no tools.
// No database here: the script runs without Helena's. The judge Helena's own evals use is
// judge.ts.

type Judge = (request: LocalAiChatRequest) => Promise<LocalAiChatAnswer>;

// ── The owner's CLI, for command-line evals ────────────────────────────────────────────

export function cliJudgeArgs(
  cli: 'claude' | 'codex',
  model: string,
  request: LocalAiChatRequest,
): string[] {
  if (cli === 'claude')
    return [
      '-p',
      '--model',
      model,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--output-format',
      'json',
      '--system-prompt',
      request.system ?? '',
    ];
  return [
    'exec',
    '--model',
    model,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--json',
  ];
}

// The answer text of one CLI run: Claude Code's `--output-format json` result, or the last
// agent message of Codex's JSON events.
export function cliJudgeText(cli: 'claude' | 'codex', output: string): string {
  if (cli === 'claude') {
    const body = JSON.parse(output) as { result?: unknown; is_error?: unknown };
    if (body.is_error === true) throw new Error(`claude: ${String(body.result).slice(0, 160)}`);
    return String(body.result ?? '');
  }
  let last = '';
  for (const line of output.split('\n')) {
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.item?.type === 'agent_message' && typeof event.item.text === 'string')
        last = event.item.text;
    } catch {
      // Not an event line.
    }
  }
  return last;
}

export function cliJudge(cli: 'claude' | 'codex', model: string, cwd: string): Judge {
  return (request) =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const input =
        cli === 'claude'
          ? request.prompt
          : [request.system, request.prompt].filter(Boolean).join('\n\n');
      const child = spawn(cli, cliJudgeArgs(cli, model, request), {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
      child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
      child.stderr.on('data', (data: Buffer) => (stderr += data.toString().slice(0, 4000)));
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`${cli} exited ${code}: ${stderr.slice(0, 200)}`));
        try {
          resolve({
            text: cliJudgeText(cli, stdout),
            toolCalls: [],
            inputTokens: null,
            outputTokens: null,
            latencyMs: Date.now() - started,
          });
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(input);
    });
}
