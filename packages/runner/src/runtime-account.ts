import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeRuntimeAccount, type RuntimeAccount } from '@helena/sdk';
import type { CommandResult, ShortCommand } from './cli-runtime';
import { codexAppServerRequest } from './limits/codex';

// The login Claude Code or Codex keeps of its own in an agent's home (@helena/sdk
// runtime-account.ts), read with the runtime's own interfaces, never from its file:
//
//   Codex        its app-server answers `account/read` with the login's kind and, for a
//                ChatGPT login, the account's e-mail and plan (from the id token's claims,
//                read by Codex itself). Asked without `refreshToken`, so it renews nothing.
//                A Codex without `account/read` still says whether (`codex login status`).
//   Claude Code  `claude auth status` (JSON: loggedIn, authMethod, the account's e-mail,
//                subscription and organization where it has them).
//
// When the runtime last wrote its login (signed in, renewed it) is the login file's time:
// its metadata, never its content. Signing out is the runtime's own command (`codex logout`,
// `claude auth logout`), started where the agent runs. For an isolated agent all of this
// runs as the project's user, in the profile helper and the agent's unit (cli-runtime.ts);
// only the account's facts leave it.

export type AccountRuntime = 'claude' | 'codex';

const APP_SERVER_TIMEOUT_MS = 20_000;

// The file each runtime keeps its login in, below its own directory.
const LOGIN_FILE: Record<AccountRuntime, string> = {
  codex: 'auth.json',
  claude: '.credentials.json',
};

// The variables every command of the runtime gets: its own directory in the agent's home,
// and for Claude Code no self-update and no traffic besides the model's.
export function cliRuntimeEnv(runtime: AccountRuntime, dir: string): Record<string, string> {
  return runtime === 'claude'
    ? {
        CLAUDE_CONFIG_DIR: dir,
        // The installation is Helena's (install-cli-runtimes.sh); no command updates it.
        DISABLE_AUTOUPDATER: '1',
        DISABLE_UPDATES: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      }
    : { CODEX_HOME: dir };
}

// The runtime's directory below a home, where the environment names none.
export function runtimeDirIn(
  runtime: AccountRuntime,
  home: string,
  env: Record<string, string | undefined> = {},
): string {
  return runtime === 'claude'
    ? (env.CLAUDE_CONFIG_DIR ?? join(home, '.claude'))
    : (env.CODEX_HOME ?? join(home, '.codex'));
}

type Facts = Pick<RuntimeAccount, 'signedIn' | 'method' | 'email' | 'plan' | 'organization'>;

const UNKNOWN: Facts = {
  signedIn: null,
  method: null,
  email: null,
  plan: null,
  organization: null,
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Codex' answer to `account/read`: `{ account: null | { type: 'apiKey' } | { type:
// 'chatgpt', email, planType } | { type: …, … }, requiresOpenaiAuth }`.
export function codexAccountFrom(result: unknown): Facts | null {
  if (!result || typeof result !== 'object' || !('account' in result)) return null;
  const account = (result as { account?: unknown }).account;
  if (account === null) return { ...UNKNOWN, signedIn: false };
  if (!account || typeof account !== 'object') return null;
  const raw = account as { type?: unknown; email?: unknown; planType?: unknown };
  const type = text(raw.type);
  if (type === 'chatgpt') {
    return {
      signedIn: true,
      method: 'chatgpt',
      email: text(raw.email),
      plan: text(raw.planType) === 'unknown' ? null : text(raw.planType),
      organization: null,
    };
  }
  return { ...UNKNOWN, signedIn: true, method: type === 'apiKey' ? 'api-key' : type };
}

// `claude auth status` (JSON by default): `{ loggedIn, authMethod, email?, orgName?,
// subscriptionType?, … }`. Older versions answered with an exit code only.
export function claudeAccountFrom(result: CommandResult): Facts {
  if (result.missing || result.code === null) return UNKNOWN;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return { ...UNKNOWN, signedIn: result.code === 0 };
  }
  const signedIn = raw.loggedIn === true;
  const method = text(raw.authMethod);
  return {
    signedIn,
    method: method === 'none' ? null : method === 'api_key' ? 'api-key' : method,
    email: text(raw.email) ?? text(raw.emailAddress),
    plan: text(raw.subscriptionType),
    organization: text(raw.orgName) ?? text(raw.organizationName),
  };
}

async function writtenAt(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.mtime.toISOString() : null;
  } catch {
    return null;
  }
}

export interface ReadAccountOptions {
  runtime: AccountRuntime;
  // The runtime's own directory: CODEX_HOME, CLAUDE_CONFIG_DIR.
  dir: string;
  // What the runtime's commands get besides the runner's environment.
  env: Record<string, string>;
  command: ShortCommand;
  // Codex' app-server, one request; tests give their own.
  appServer?: (method: string, params: unknown) => Promise<unknown>;
  now?: () => number;
}

function codexBin(env: Record<string, string>): string {
  return env.HELENA_CODEX_BIN ?? process.env.HELENA_CODEX_BIN ?? 'codex';
}

// Reads the runtime's own login. Never throws: what it cannot tell stays null.
export async function readRuntimeAccount(options: ReadAccountOptions): Promise<RuntimeAccount> {
  const { runtime, dir, env, command } = options;
  const now = options.now ?? Date.now;
  let facts: Facts = UNKNOWN;
  if (runtime === 'codex') {
    const appServer =
      options.appServer ??
      ((method: string, params: unknown) =>
        codexAppServerRequest(
          {
            bin: codexBin(env),
            env: { ...(process.env as Record<string, string>), ...env, CODEX_HOME: dir },
            cwd: dir,
            timeoutMs: APP_SERVER_TIMEOUT_MS,
          },
          method,
          params,
        ));
    let read: Facts | null = null;
    try {
      read = codexAccountFrom(await appServer('account/read', { refreshToken: false }));
    } catch {
      read = null;
    }
    if (read) facts = read;
    else {
      // A Codex that cannot answer `account/read` still tells whether it holds a login.
      const status = await command('codex', ['login', 'status'], { ...env, CODEX_HOME: dir });
      if (!status.missing && status.code !== null) {
        facts = { ...UNKNOWN, signedIn: status.code === 0 };
      }
    }
  } else {
    facts = claudeAccountFrom(await command('claude', ['auth', 'status'], env));
  }
  const refreshedAt = facts.signedIn ? await writtenAt(join(dir, LOGIN_FILE[runtime])) : null;
  // Checked once more: nothing but the account's facts leaves here.
  return normalizeRuntimeAccount({
    ...facts,
    refreshedAt,
    checkedAt: new Date(now()).toISOString(),
    command: null,
  })!;
}

// The runtime's own command that signs its login out.
export function signOutArgs(runtime: AccountRuntime): string[] {
  return runtime === 'codex' ? ['logout'] : ['auth', 'logout'];
}

// `login.read` answered where only the agent's home is known: in the profile helper of an
// isolated agent, as the project's user with the agent's profile bound in.
export async function answerLoginRead(
  context: { runtime: string; home: string; env: Record<string, string> },
  command: ShortCommand,
): Promise<{ account: RuntimeAccount | null }> {
  if (context.runtime !== 'claude' && context.runtime !== 'codex') {
    throw new Error(`The ${context.runtime} runtime keeps no login of its own`);
  }
  const dir = runtimeDirIn(context.runtime, context.home, context.env);
  const account = await readRuntimeAccount({
    runtime: context.runtime,
    dir,
    env: { ...context.env, ...cliRuntimeEnv(context.runtime, dir) },
    command,
  });
  return { account };
}
