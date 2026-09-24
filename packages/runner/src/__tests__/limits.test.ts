import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UsageLimitSnapshot, UsageLimitSource } from '@helena/sdk';
import { answerRuntimeRequest, readerCapabilities } from '../readers';
import {
  LimitProber,
  LimitsStream,
  claudeObserver,
  claudeProbes,
  codexProbes,
  dedupe,
  hermesLimitSource,
  hermesLoginStore,
} from '../limits';
import {
  accountHash,
  fromClaudeRateLimitInfo,
  fromClaudeUsageReport,
  fromCodexRateLimits,
  fromHermesDocument,
} from '../limits/normalize';
import { writeSpool } from '../limits/report';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'helena-limits-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function script(dir: string, name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

// Codex 0.156.1's answer to `account/rateLimits/read` for a Pro plan on 2026-09-24: one
// bucket, only a weekly window, and it arrives as `primary`.
const CODEX_PRO = {
  accountId: 'acct-owner',
  ordinaryUsageAllowed: true,
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 46, windowDurationMins: 10080, resetsAt: 1790625629 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    planType: 'pro',
    rateLimitReachedType: null,
  },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      primary: { usedPercent: 46, windowDurationMins: 10080, resetsAt: 1790625629 },
      secondary: null,
      planType: 'pro',
    },
    codex_spark: {
      limitId: 'codex_spark',
      limitName: 'GPT-5.3-Codex-Spark',
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1790625629 },
      secondary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1790260000 },
      rateLimitReachedType: 'rate_limit_reached',
    },
  },
  rateLimitResetCredits: { availableCount: 2, credits: null },
  rateLimitUpsell: { title: 'Upgrade' },
};

// Claude Code 2.1.281's `usage_report.rate_limits` of `/usage` on 2026-09-24.
const CLAUDE_REPORT = {
  session: { total_cost_usd: 0 },
  rate_limits: {
    limits: [
      {
        kind: 'session',
        group: 'session',
        percent: 80,
        resets_at: '2026-09-24T14:30:00.241248+00:00',
        scope: null,
        severity: 'warning',
        is_active: true,
      },
      {
        kind: 'weekly_all',
        group: 'weekly',
        percent: 21,
        resets_at: '2026-09-27T14:00:00.241270+00:00',
        scope: null,
        severity: 'normal',
        is_active: false,
      },
      {
        kind: 'weekly_scoped',
        group: 'weekly',
        percent: 0,
        resets_at: '2026-09-27T14:00:00+00:00',
        scope: { model: { display_name: 'Fable' }, surface: null },
        severity: 'normal',
        is_active: false,
      },
    ],
    extra_usage: {
      is_enabled: false,
      monthly_limit: 17000,
      used_credits: 0,
      utilization: 0,
      currency: 'EUR',
    },
  },
};

describe('normalize', () => {
  it('classifies Codex windows by length and keeps model buckets apart', () => {
    const snapshot = fromCodexRateLimits(CODEX_PRO, {
      source: 'codex',
      login: 'owner',
      fallbackAccount: 'loc-x',
      observedAt: '2026-09-24T13:00:00.000Z',
    })!;
    expect(snapshot.account).toBe(accountHash('openai-codex', 'acct-owner'));
    expect(snapshot.plan).toBe('pro');
    expect(snapshot.resetCredits).toBe(2);
    expect(snapshot.allowed).toBe(true);
    expect(snapshot.windows).toEqual([
      expect.objectContaining({ id: 'weekly', kind: 'weekly', usedPercent: 46 }),
      expect.objectContaining({
        id: 'codex_spark:weekly',
        kind: 'model',
        label: 'GPT-5.3-Codex-Spark',
        usedPercent: 100,
        limited: true,
      }),
      expect.objectContaining({ id: 'codex_spark:session', kind: 'model', usedPercent: 12 }),
    ]);
    expect(snapshot.windows[0]!.resetsAt).toBe(new Date(1790625629 * 1000).toISOString());
    expect(snapshot.extra).toMatchObject({ kind: 'credits', enabled: false, balance: 0 });
    // Nothing of the answer but numbers and names travels on.
    expect(JSON.stringify(snapshot)).not.toContain('acct-owner');
    expect(JSON.stringify(snapshot)).not.toContain('Upgrade');
  });

  it('reads the Claude /usage rows, amounts in minor units', () => {
    const snapshot = fromClaudeUsageReport(CLAUDE_REPORT, {
      source: 'claude-code',
      login: 'owner',
      account: 'acct',
      plan: 'max',
    })!;
    expect(snapshot.windows.map((w) => [w.id, w.kind, w.usedPercent, w.severity])).toEqual([
      ['session', 'session', 80, 'warning'],
      ['weekly', 'weekly', 21, 'normal'],
      ['weekly:fable', 'model', 0, 'normal'],
    ]);
    expect(snapshot.windows[2]!.label).toBe('Fable');
    expect(snapshot.extra).toMatchObject({ kind: 'extra_usage', enabled: false, limit: 170 });
    expect(
      fromClaudeUsageReport(
        { rate_limits: null },
        { source: 'claude-code', login: 'owner', account: 'a', plan: null },
      ),
    ).toBeNull();
  });

  it("reads Claude Code's rate_limit_event", () => {
    const snapshot = fromClaudeRateLimitInfo(
      {
        status: 'rejected',
        resetsAt: 1790260000,
        rateLimitType: 'five_hour',
        utilization: 1,
        unifiedWindows: {
          five_hour: { utilization: 1.02, resetsAt: 1790260000 },
          seven_day: { utilization: 0.314, resetsAt: 1790600000 },
        },
      },
      { source: 'claude-code', login: 'claude-code', account: 'acct' },
    )!;
    expect(snapshot.via).toBe('passive');
    expect(snapshot.allowed).toBe(false);
    expect(snapshot.windows).toEqual([
      expect.objectContaining({ id: 'session', usedPercent: 102, limited: true }),
      expect.objectContaining({ id: 'weekly', usedPercent: 31.4, windowMinutes: 10080 }),
    ]);
  });

  it("reads Hermes' document, preferring the bridge's windows with their length", () => {
    const withExtras = fromHermesDocument(
      {
        provider: 'openai-codex',
        plan: 'Pro',
        fetched_at: '2026-09-24T13:00:00+00:00',
        windows: [{ label: 'Weekly', used_percent: 46, resets_at: null }],
        helena: {
          account: 'hashed-account',
          windows: [
            {
              slot: 'primary',
              used_percent: 46,
              limit_window_seconds: 604800,
              reset_at: 1790625629,
            },
          ],
          additional: [
            {
              name: 'GPT-5.3-Codex-Spark',
              feature: 'codex_spark',
              windows: [
                {
                  slot: 'primary',
                  used_percent: 5,
                  limit_window_seconds: 18000,
                  reset_after_seconds: 600,
                },
              ],
            },
          ],
          allowed: true,
          credits: { has_credits: true, unlimited: false, balance: '12.5' },
          reset_credits: 1,
        },
      },
      { source: 'hermes', login: 'hermes', fallbackAccount: 'loc' },
    )!;
    expect(withExtras.account).toBe('hashed-account');
    expect(withExtras.plan).toBe('pro');
    expect(withExtras.windows.map((w) => [w.id, w.kind, w.windowMinutes])).toEqual([
      ['weekly', 'weekly', 10080],
      ['codex_spark:session', 'model', 300],
    ]);
    expect(withExtras.windows[1]!.resetsAt).toBe('2026-09-24T13:10:00.000Z');
    expect(withExtras.extra).toMatchObject({ enabled: true, balance: 12.5 });

    const labelsOnly = fromHermesDocument(
      {
        provider: 'anthropic',
        fetched_at: '2026-09-24T13:00:00+00:00',
        windows: [
          { label: 'Current session', used_percent: 12, resets_at: '2026-09-24T15:00:00+00:00' },
          { label: 'Opus week', used_percent: 3, resets_at: null },
          { label: 'API key quota', used_percent: 50 },
        ],
      },
      { source: 'hermes', login: 'hermes', fallbackAccount: 'loc' },
    )!;
    expect(labelsOnly.account).toBe('loc');
    expect(labelsOnly.windows.map((w) => [w.id, w.kind, w.label])).toEqual([
      ['session', 'session', null],
      ['weekly:opus', 'model', 'Opus'],
      ['api-key-quota', 'other', 'API key quota'],
    ]);
  });
});

describe('Hermes source', () => {
  it("runs the bridge under Hermes' interpreter and passes on numbers only", async () => {
    const root = await tempDir();
    const profile = join(root, 'profiles', 'vol');
    await mkdir(profile, { recursive: true });
    // A stand-in for Hermes' modules, with an answer that carries what must not leave.
    const lib = join(root, 'lib');
    await mkdir(join(lib, 'agent'), { recursive: true });
    await mkdir(join(lib, 'hermes_cli', 'subcommands'), { recursive: true });
    await writeFile(join(lib, 'agent', '__init__.py'), '');
    await writeFile(join(lib, 'hermes_cli', '__init__.py'), '');
    await writeFile(join(lib, 'hermes_cli', 'subcommands', '__init__.py'), '');
    await writeFile(
      join(lib, 'agent', 'account_usage.py'),
      `import os
from types import SimpleNamespace
def fetch_account_usage(provider):
    if provider != "openai-codex":
        return None
    assert os.environ["HERMES_HOME"].endswith("profiles/vol")
    return SimpleNamespace(provider=provider, raw={
        "account_id": "acct-1", "user_id": "user-1", "email": "owner@example.com",
        "plan_type": "pro",
        "rate_limit": {"allowed": True, "limit_reached": False,
            "primary_window": {"used_percent": 46, "limit_window_seconds": 604800, "reset_at": 1790625629}},
        "additional_rate_limits": [{"limit_name": "Spark", "metered_feature": "codex_spark",
            "rate_limit": {"primary_window": {"used_percent": 3, "limit_window_seconds": 18000}}}],
        "credits": {"has_credits": False, "unlimited": False, "balance": "0"},
        "rate_limit_reset_credits": {"available_count": 2},
    })
`,
    );
    await writeFile(
      join(lib, 'hermes_cli', 'subcommands', 'usage.py'),
      `def usage_snapshot_document(snapshot):
    return {"provider": snapshot.provider, "source": "usage_api", "title": "Account limits",
            "plan": "Pro", "fetched_at": "2026-09-24T13:00:00+00:00",
            "windows": [{"label": "Weekly", "used_percent": 46, "resets_at": None, "detail": None}],
            "details": ["Signed in as owner@example.com"], "unavailable_reason": None}
`,
    );
    const context = {
      runtime: 'hermes',
      home: profile,
      env: { PYTHONPATH: lib, HERMES_PYTHON: 'python3' },
      providers: ['openai-codex', 'anthropic'],
    };
    const probes = await hermesLimitSource.probes!(context);
    expect(probes).toHaveLength(1);
    // A profile without its own login shares the root's.
    expect(probes[0]!.key).toBe(`hermes:${root}:anthropic,openai-codex`);
    const snapshots = await probes[0]!.run();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.account).toBe(accountHash('openai-codex', 'acct-1'));
    expect(snapshots[0]!.windows.map((w) => w.id)).toEqual(['weekly', 'codex_spark:session']);
    expect(snapshots[0]!.resetCredits).toBe(2);
    const text = JSON.stringify(snapshots);
    expect(text).not.toContain('example.com');
    expect(text).not.toContain('acct-1');
    expect(text).not.toContain('user-1');
  });

  it('keys a profile with its own login by the profile', async () => {
    const root = await tempDir();
    const profile = join(root, 'profiles', 'fam');
    await mkdir(profile, { recursive: true });
    expect(await hermesLoginStore(profile)).toBe(root);
    await writeFile(join(profile, 'auth.json'), '{}');
    expect(await hermesLoginStore(profile)).toBe(profile);
  });
});

describe('Codex source', () => {
  const FAKE_CODEX = `#!/usr/bin/env node
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    console.log(JSON.stringify({ id: message.id, result: { codexHome: process.env.CODEX_HOME } }));
  } else if (message.method === 'account/rateLimits/read') {
    if (process.env.FAKE_FAIL) console.log(JSON.stringify({ id: message.id, error: { code: -32600, message: 'codex account authentication required to read rate limits' } }));
    else console.log(JSON.stringify({ id: message.id, result: ${JSON.stringify(CODEX_PRO)} }));
  }
});
`;

  it('reads a ChatGPT login through the app-server, through the gate', async () => {
    const dir = await tempDir();
    const codexHome = join(dir, '.codex');
    await mkdir(codexHome);
    const bin = await script(dir, 'codex', FAKE_CODEX);
    const env = { HELENA_CODEX_BIN: bin };
    expect(await codexProbes({ home: codexHome, env }, 'codex')).toEqual([]);
    await writeFile(join(codexHome, 'auth.json'), '{}');
    let held = 0;
    const gate = {
      acquire: async () => {
        held++;
        return () => held--;
      },
    };
    const [probe] = await codexProbes({ home: codexHome, env, gate }, 'codex');
    const snapshots = await probe!.run();
    expect(held).toBe(0);
    expect(snapshots[0]).toMatchObject({ provider: 'openai-codex', plan: 'pro', login: 'codex' });

    const failing = await codexProbes(
      { home: codexHome, env: { ...env, FAKE_FAIL: '1' } },
      'codex',
    );
    await expect(failing[0]!.run()).rejects.toThrow('authentication required');
  });
});

describe('Claude Code source', () => {
  const FAKE_CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) { console.error('token leaked into the probe'); process.exit(3); }
if (args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.com', orgId: 'org-1', orgName: 'Owner', subscriptionType: 'max' }));
} else if (args.includes('/usage') && args.includes('--safe-mode') && args.includes('--no-session-persistence')) {
  console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'x' }));
  console.log(JSON.stringify({ type: 'assistant', message: { content: 'usage' }, usage_report: ${JSON.stringify(CLAUDE_REPORT)} }));
  console.log(JSON.stringify({ type: 'result', num_turns: 0 }));
} else { process.exit(2); }
`;

  it('probes a stored claude.ai login with the local /usage command', async () => {
    const dir = await tempDir();
    const config = join(dir, '.claude');
    await mkdir(config);
    const bin = await script(dir, 'claude', FAKE_CLAUDE);
    const env = { HELENA_CLAUDE_BIN: bin, CLAUDE_CODE_OAUTH_TOKEN: 'must-not-reach-it' };
    expect(await claudeProbes({ env }, config, 'owner', { cwd: dir })).toEqual([]);
    await writeFile(join(config, '.credentials.json'), '{}');
    const [probe] = await claudeProbes({ env }, config, 'owner', { cwd: dir });
    const [snapshot] = await probe!.run();
    expect(snapshot).toMatchObject({
      provider: 'anthropic',
      plan: 'max',
      login: 'owner',
      account: accountHash('anthropic', 'org-1'),
    });
    expect(snapshot!.windows).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain('example.com');
  });

  it('reads rate_limit_event lines and reports only changes', () => {
    const observer = claudeObserver({
      runtime: 'claude',
      home: '/agents/a/.claude',
      env: {},
      providers: ['anthropic'],
      loginRef: 'runtime_login:7',
    });
    const event = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'seven_day',
        unifiedWindows: {
          five_hour: { utilization: 0.4, resetsAt: 1790260000 },
          seven_day: { utilization: 0.81, resetsAt: 1790600000 },
        },
      },
    });
    const first = observer.line(event);
    expect(first).toHaveLength(1);
    expect(first[0]!.windows[1]).toMatchObject({ id: 'weekly', severity: 'warning' });
    expect(observer.line(event)).toEqual([]);
    expect(observer.line('{"type":"assistant"}')).toEqual([]);
  });
});

function snapshot(fields: Partial<UsageLimitSnapshot>): UsageLimitSnapshot {
  return {
    provider: 'openai-codex',
    account: 'acct',
    source: 'test',
    login: 'test',
    plan: 'pro',
    windows: [],
    extra: null,
    resetCredits: null,
    allowed: null,
    via: 'probe',
    observedAt: '2026-09-24T13:00:00.000Z',
    unavailable: null,
    ...fields,
  };
}

describe('LimitProber', () => {
  it('probes a login once for every agent that shares it, and again when forced', async () => {
    let runs = 0;
    let now = 1_000_000;
    let fail = false;
    const source: UsageLimitSource = {
      id: 'test',
      label: 'Test',
      providers: ['openai-codex'],
      runtimes: ['hermes'],
      probes: () => [
        {
          key: 'shared-login',
          provider: 'openai-codex',
          run: async () => {
            runs++;
            if (fail) throw new Error('offline');
            return [snapshot({ plan: `run-${runs}` })];
          },
        },
      ],
    };
    const prober = new LimitProber({ list: () => [source] }, () => now);
    const context = { runtime: 'hermes', home: '/h', env: {}, providers: [] };
    const [a, b] = await Promise.all([prober.read(context), prober.read(context)]);
    expect(runs).toBe(1);
    expect(a[0]!.plan).toBe('run-1');
    expect(b[0]!.plan).toBe('run-1');
    now += 30_000;
    await prober.read(context, { force: true });
    expect(runs).toBe(1);
    now += 60_000;
    await prober.read(context, { force: true });
    expect(runs).toBe(2);
    // A failed probe keeps the last numbers.
    fail = true;
    now += 10 * 60_000;
    const kept = await prober.read(context);
    expect(runs).toBe(3);
    expect(kept[0]!.plan).toBe('run-2');
    // Another runtime gets no probe of a Hermes source.
    expect(await prober.read({ ...context, runtime: 'codex' })).toEqual([]);
  });

  it('keeps the newest snapshot per account', () => {
    const older = snapshot({ observedAt: '2026-09-24T12:00:00.000Z', plan: 'old' });
    const newer = snapshot({ observedAt: '2026-09-24T13:00:00.000Z', plan: 'new' });
    expect(dedupe([older, newer]).map((s) => s.plan)).toEqual(['new']);
  });
});

describe('LimitsStream', () => {
  it('sends what moved at most once a minute, and the rest at the end', async () => {
    let now = 0;
    const sent: UsageLimitSnapshot[][] = [];
    let n = 0;
    const stream = new LimitsStream(
      [{ line: (text) => (text.startsWith('limit') ? [snapshot({ plan: `p${++n}` })] : []) }],
      async (snapshots) => void sent.push(snapshots),
      () => now,
    );
    stream.write('limit\nnoise\n');
    now += 10_000;
    stream.write('limit\n');
    expect(sent.map((s) => s[0]!.plan)).toEqual(['p1']);
    await stream.end();
    expect(sent.map((s) => s[0]!.plan)).toEqual(['p1', 'p2']);
  });

  it('never throws into the run when the client cannot send', () => {
    const stream = new LimitsStream([{ line: () => [snapshot({})] }], () => {
      throw new Error('no route');
    });
    expect(() => stream.write('x\n')).not.toThrow();
  });
});

const FAKE_CODEX_FOR_HELPER = `#!/usr/bin/env node
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') console.log(JSON.stringify({ id: message.id, result: {} }));
  if (message.method === 'account/rateLimits/read') {
    console.log(JSON.stringify({ id: message.id, result: ${JSON.stringify(CODEX_PRO)} }));
  }
});
`;

describe('runner integration', () => {
  it('reports the limits capability for the runtimes with a source', () => {
    for (const runtime of ['hermes', 'claude', 'codex']) {
      expect(readerCapabilities(runtime)).toContain('limits');
    }
    expect(readerCapabilities('opencode')).not.toContain('limits');
  });

  it("answers limits.read where only the runtime's home is known (the profile helper)", async () => {
    const home = await tempDir();
    await mkdir(join(home, '.codex'));
    await writeFile(join(home, '.codex', 'auth.json'), '{}');
    const bin = await script(home, 'codex', FAKE_CODEX_FOR_HELPER);
    const answer = (await answerRuntimeRequest(
      { op: 'limits.read', force: true, providers: ['openai-codex'] },
      { runtime: 'codex', home, cwd: null, env: { HELENA_CODEX_BIN: bin } },
    )) as { snapshots: UsageLimitSnapshot[] };
    expect(answer.snapshots).toHaveLength(1);
    expect(answer.snapshots[0]).toMatchObject({ provider: 'openai-codex', plan: 'pro' });
  });

  it('writes the spool file whole, readable by the API', async () => {
    const dir = await tempDir();
    const path = join(dir, 'reports', 'owner.json');
    await writeSpool(path, {
      version: 1,
      reporter: 'owner',
      reportedAt: '2026-09-24T13:00:00.000Z',
      snapshots: [snapshot({})],
    });
    const file = JSON.parse(await readFile(path, 'utf8')) as { snapshots: unknown[] };
    expect(file.snapshots).toHaveLength(1);
  });
});
