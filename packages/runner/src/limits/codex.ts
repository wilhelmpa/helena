import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageLimitAgentContext, UsageLimitProbe, UsageLimitSource } from '@helena/sdk';
import { fromCodexRateLimits, locationHash } from './normalize';

// The ChatGPT plan limits of a Codex login, read by Codex itself: its app-server (JSON-RPC
// over stdio, the protocol the IDE extensions use) answers `account/rateLimits/read` with
// the plan's windows, the model buckets (`rateLimitsByLimitId`), the plan type and the
// account id, which is hashed before it goes anywhere. Codex keeps and refreshes its login in
// CODEX_HOME; the runner never reads it. Only a ChatGPT login has plan windows: an API key
// (CODEX_API_KEY, no auth.json) is skipped.

const PROBE_TIMEOUT_MS = 30_000;
const CLIENT = { name: 'helena-limits', version: '1.0.0' };

export class CodexRpcError extends Error {}

function codexBin(env: Record<string, string>): string {
  return env.HELENA_CODEX_BIN ?? process.env.HELENA_CODEX_BIN ?? 'codex';
}

// Starts `codex app-server`, initializes it, sends one request and returns its result.
export function codexAppServerRequest(
  options: {
    bin: string;
    env: Record<string, string>;
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
  method: string,
  params: unknown,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.bin, ['app-server'], {
      env: options.env,
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let settled = false;
    let buffered = '';
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      child.stdin.end();
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new CodexRpcError('Codex did not answer in time')),
      options.timeoutMs ?? PROBE_TIMEOUT_MS,
    );
    const abort = () => finish(new CodexRpcError('stopped'));
    options.signal?.addEventListener('abort', abort);
    const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.on('error', () => {});
    child.on('error', (error) =>
      finish(new CodexRpcError(`Codex did not start: ${error.message}`)),
    );
    child.on('close', () => finish(new CodexRpcError('Codex ended before it answered')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffered += chunk;
      if (buffered.length > 4 * 1024 * 1024) {
        finish(new CodexRpcError('Codex answered too much'));
        return;
      }
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          if (message.error) {
            finish(new CodexRpcError(String(message.error.message ?? 'initialize failed')));
            return;
          }
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method, params });
        } else if (message.id === 2) {
          if (message.error) finish(new CodexRpcError(String(message.error.message ?? 'failed')));
          else finish(null, message.result);
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: CLIENT } });
  });
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

// One probe of the Codex login in `codexHome`, or none where that home holds no ChatGPT
// login. `login` names whose login it is (`codex` for an agent, `owner` for the owner's).
export async function codexProbes(
  context: Pick<UsageLimitAgentContext, 'home' | 'env' | 'gate'>,
  login: string,
): Promise<UsageLimitProbe[]> {
  const codexHome = context.home;
  if (!(await hasFile(join(codexHome, 'auth.json')))) return [];
  return [
    {
      key: `codex:${codexHome}`,
      provider: 'openai-codex',
      async run(signal) {
        // Codex may refresh the login while it answers; the agent's own commands start one
        // at a time with the probe (cli-runtime.ts LoginStartGate).
        const release = context.gate ? await context.gate.acquire() : () => {};
        try {
          const result = await codexAppServerRequest(
            {
              bin: codexBin(context.env),
              env: {
                ...(process.env as Record<string, string>),
                ...context.env,
                CODEX_HOME: codexHome,
              },
              cwd: codexHome,
              signal,
            },
            'account/rateLimits/read',
            { excludeResetCreditDetails: true },
          );
          const snapshot = fromCodexRateLimits(result, {
            source: 'codex',
            login,
            fallbackAccount: locationHash('codex', codexHome),
          });
          return snapshot ? [snapshot] : [];
        } finally {
          release();
        }
      },
    },
  ];
}

export const codexLimitSource: UsageLimitSource = {
  id: 'codex',
  label: 'Codex',
  providers: ['openai-codex'],
  runtimes: ['codex'],
  probes: (context) => codexProbes(context, 'codex'),
};
