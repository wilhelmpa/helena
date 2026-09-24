import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  UsageLimitAgentContext,
  UsageLimitObserver,
  UsageLimitProbe,
  UsageLimitSnapshot,
  UsageLimitSource,
} from '@helena/sdk';
import { runCommand } from '../readers/process';
import {
  accountHash,
  fromClaudeRateLimitInfo,
  fromClaudeUsageReport,
  locationHash,
} from './normalize';

// The Claude plan limits, read by Claude Code itself.
//
// Passive, for every agent: a Claude Code session on a subscription login (a
// `claude setup-token` token included) gets the unified rate-limit headers with every
// answer and writes them into its stream-json output as `rate_limit_event` lines; the
// runner reads them off the run's output like the token counts.
//
// Probe, only where a full login is stored (`.credentials.json` in the config directory:
// the owner's own `claude` login, or an agent's own `/login`): the local `/usage` command
// (no model call) run as `claude --safe-mode -p "/usage"`, whose stream-json answer carries
// the usage endpoint's rows as `usage_report`. A setup-token lacks the `user:profile` scope
// that endpoint needs, so an agent's runtime login is never probed.

const PROBE_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function claudeBin(env: Record<string, string>): string {
  return env.HELENA_CLAUDE_BIN ?? process.env.HELENA_CLAUDE_BIN ?? 'claude';
}

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

function lines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      out.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Not a stream-json line.
    }
  }
  return out;
}

// The environment a probe runs Claude Code in: the config directory, no updates, and none
// of the login variables the runner hands a run, so only the stored login is used.
function probeEnv(context: Pick<UsageLimitAgentContext, 'env'>, configDir: string | null) {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...context.env,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
    NO_COLOR: '1',
  };
  for (const name of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_TOKEN',
  ]) {
    delete env[name];
  }
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}

// The plan and the account of the stored login, from `claude auth status`: only
// `subscriptionType` and a hash of `orgId` are kept; the e-mail and names it prints are
// dropped here.
async function claudeAccount(
  bin: string,
  env: Record<string, string>,
  cwd: string,
): Promise<{ plan: string | null; account: string | null; loggedIn: boolean }> {
  const result = await runCommand(bin, ['auth', 'status'], {
    env,
    cwd,
    timeoutMs: 20_000,
    maxBytes: 64 * 1024,
  });
  try {
    const status = JSON.parse(result.stdout) as {
      loggedIn?: unknown;
      authMethod?: unknown;
      subscriptionType?: unknown;
      orgId?: unknown;
    };
    const org = typeof status.orgId === 'string' && status.orgId ? status.orgId : null;
    return {
      loggedIn: status.loggedIn === true && status.authMethod === 'claude.ai',
      plan: typeof status.subscriptionType === 'string' ? status.subscriptionType : null,
      account: org ? accountHash('anthropic', org) : null,
    };
  } catch {
    return { loggedIn: false, plan: null, account: null };
  }
}

// One probe of a stored claude.ai login in `configDir` (null: Claude Code's default, the
// user's own ~/.claude), or none where no login is stored there.
export async function claudeProbes(
  context: Pick<UsageLimitAgentContext, 'env'>,
  configDir: string | null,
  login: string,
  options: { home?: string; cwd: string },
): Promise<UsageLimitProbe[]> {
  const dir = configDir ?? join(options.home ?? process.env.HOME ?? '', '.claude');
  if (!(await hasFile(join(dir, '.credentials.json')))) return [];
  const bin = claudeBin(context.env);
  const env = probeEnv(context, configDir);
  return [
    {
      key: `claude-code:${dir}`,
      provider: 'anthropic',
      async run(signal) {
        if (signal?.aborted) return [];
        const who = await claudeAccount(bin, env, options.cwd);
        if (!who.loggedIn) return [];
        const result = await runCommand(
          bin,
          [
            '--safe-mode',
            '-p',
            '/usage',
            '--output-format',
            'stream-json',
            '--verbose',
            '--no-session-persistence',
          ],
          { env, cwd: options.cwd, timeoutMs: PROBE_TIMEOUT_MS, maxBytes: MAX_OUTPUT_BYTES },
        );
        if (result.code !== 0) {
          throw new Error(
            result.code === null
              ? 'Claude Code did not answer in time'
              : `Claude Code exited with ${result.code}`,
          );
        }
        const report = lines(result.stdout).find((line) => line.usage_report)?.usage_report;
        const snapshot = fromClaudeUsageReport(report, {
          source: 'claude-code',
          login,
          account: who.account ?? locationHash('claude-code', dir),
          plan: who.plan,
        });
        if (snapshot) return [snapshot];
        // The login lacks the profile scope, or the CLI could not fetch the rows.
        return [
          {
            provider: 'anthropic',
            account: who.account ?? locationHash('claude-code', dir),
            source: 'claude-code',
            login,
            plan: who.plan,
            windows: [],
            extra: null,
            resetCredits: null,
            allowed: null,
            via: 'probe',
            observedAt: new Date().toISOString(),
            unavailable: 'no_profile_scope',
          },
        ];
      },
    },
  ];
}

// Reads `rate_limit_event` lines off a Claude Code run's stream-json output.
export function claudeObserver(context: UsageLimitAgentContext): UsageLimitObserver {
  const account = context.loginRef
    ? locationHash('claude-code', context.loginRef)
    : locationHash('claude-code', context.home);
  let last = '';
  return {
    line(text: string): UsageLimitSnapshot[] {
      if (!text.includes('rate_limit_event')) return [];
      let event: { type?: unknown; rate_limit_info?: unknown };
      try {
        event = JSON.parse(text);
      } catch {
        return [];
      }
      if (event.type !== 'rate_limit_event') return [];
      const snapshot = fromClaudeRateLimitInfo(event.rate_limit_info, {
        source: 'claude-code',
        login: 'claude-code',
        account,
      });
      if (!snapshot) return [];
      const key = JSON.stringify([snapshot.windows, snapshot.allowed]);
      if (key === last) return [];
      last = key;
      return [snapshot];
    },
  };
}

export const claudeLimitSource: UsageLimitSource = {
  id: 'claude-code',
  label: 'Claude Code',
  providers: ['anthropic'],
  runtimes: ['claude'],
  probes: (context) => claudeProbes(context, context.home, 'claude-code', { cwd: context.home }),
  observe: (format, context) => (format === 'claude-stream-json' ? claudeObserver(context) : null),
};
