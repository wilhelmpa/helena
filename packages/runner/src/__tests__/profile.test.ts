import { afterEach, describe, expect, it } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectProfile,
  registerProfileContribution,
  unregisterProfileContribution,
} from '../contributions';
import { hermesDrift, maskEntry, renderHermesMcp, type HermesProbe } from '../hermes-profile';
import {
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  type RuntimeMcpServer,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
  type RuntimeStatus,
} from '../policy';
import { runModelReport } from '../runtime';
import { fakeHermes, type FakeHermes } from './hermes-fake';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const URL = 'http://127.0.0.1:3000';
const HARNESS = '/opt/hermes/bin/browser-harness-mcp';
const CDP = 'http://127.0.0.1:19203';

// What the live shared config.yaml holds: Helena's server and the browser harness pointing at
// the Home browser, as every profile had it before the runner owned its servers.
const SHARED = {
  itsaplan: {
    url: 'http://127.0.0.1:3000/mcp',
    headers: { Authorization: 'Bearer ${ITSAPLAN_API_KEY}' },
    strict_redirect_headers: true,
    lazy: true,
    connect_timeout: 15,
    timeout: 120,
  },
  'browser-harness': {
    command: HARNESS,
    env: { BU_CDP_URL: 'http://127.0.0.1:9222' },
    connect_timeout: 20.0,
    enabled: true,
  },
};

const PROFILE = {
  toolsets: ['browser', 'file', 'terminal'],
  mcpServers: ['browser-harness', 'itsaplan'],
  browserHarness: HARNESS,
};

async function home(options: { env?: Record<string, string>; hermes?: FakeHermes } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'helena-profile-'));
  roots.push(root);
  const hermesHome = join(root, 'profiles', 'vol');
  const shared = join(root, 'config.yaml');
  await writeFile(shared, 'shared: true\n');
  const hermes = options.hermes ?? fakeHermes(structuredClone(SHARED));
  const profile = { ...PROFILE, sharedConfig: shared };
  const materializer = new HermesPolicyMaterializer({
    hermesHome,
    profile,
    context: { url: URL, env: options.env ?? { BROWSER_CDP_URL: CDP }, reader: hermes },
  });
  return { root, hermesHome, shared, hermes, profile, materializer };
}

const library: RuntimeMcpServer = {
  name: 'shopify-dev',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@shopify/dev-mcp'],
  url: null,
  env: [{ name: 'SHOPIFY_TOKEN', secret: 3 }],
  headers: [],
};

function snapshot(revision: string, extra: Partial<RuntimePolicySnapshot> = {}) {
  return {
    revision,
    runtimePolicy: { files: [{ kind: 'instructions' as const, path: 'SOUL.md', content: '# S' }] },
    skills: [],
    learning: { enabled: true, curator: false },
    ...extra,
  } satisfies RuntimePolicySnapshot;
}

function client(
  snapshots: RuntimePolicySnapshot[],
  statuses: RuntimeStatus[],
): RuntimePolicyClient {
  let last = snapshots[0];
  return {
    runtimePolicy: async () => (last = snapshots.shift() ?? last),
    reportRuntimeStatus: async (status) => {
      statuses.push(structuredClone(status));
    },
    mcpSecrets: async () => ({ '3': 'shop-secret' }),
    webLogins: async () => [],
  };
}

async function managed(hermesHome: string) {
  return JSON.parse(await readFile(join(hermesHome, 'run/itsaplan-managed/config.yaml'), 'utf8'));
}

describe('Helena owns every MCP server of a Hermes profile', () => {
  it("writes Helena's server, the project's browser and the library, and turns the rest off", async () => {
    const { hermesHome, materializer } = await home();
    const result = await materializer.apply(snapshot('sha256:one', { mcpServers: [library] }));

    const config = await managed(hermesHome);
    expect(config.mcp_servers).toEqual({
      itsaplan: {
        url: 'http://127.0.0.1:3000/mcp',
        headers: {
          Authorization: 'Bearer ${ITSAPLAN_API_KEY}',
          'x-helena-run': '${ITSAPLAN_RUN_ID}',
        },
        strict_redirect_headers: true,
        lazy: true,
        connect_timeout: 15,
        timeout: 120,
        enabled: true,
      },
      'browser-harness': {
        command: HARNESS,
        args: [],
        env: { BU_CDP_URL: CDP },
        connect_timeout: 20,
        enabled: true,
      },
      'shopify-dev': {
        command: 'npx',
        args: ['-y', '@shopify/dev-mcp'],
        env: { SHOPIFY_TOKEN: '${ITSAPLAN_MCP_SECRET_3}' },
        enabled: true,
      },
    });
    expect(result.mcpToolsets).toEqual(['itsaplan', 'browser-harness', 'shopify-dev']);
    expect(result.runtimeServers).toEqual(['itsaplan', 'browser-harness']);
    expect(result.mcpSecrets).toEqual([3]);
  });

  it('turns off a server of the shared configuration Helena does not give the agent', async () => {
    const { hermesHome, materializer } = await home({ env: {} });
    await materializer.apply(snapshot('sha256:one'), { sharedMcpServers: ['old-server'] });

    const config = await managed(hermesHome);
    // Without the project's browser the harness is off, like any other leftover.
    expect(config.mcp_servers['browser-harness']).toEqual({ enabled: false });
    expect(config.mcp_servers['old-server']).toEqual({ enabled: false });
    expect(config.mcp_servers.itsaplan.enabled).toBe(true);
  });

  it('turns off a server of the runner the owner turned off for the agent', async () => {
    const { hermesHome, materializer } = await home();
    const result = await materializer.apply(
      snapshot('sha256:one', {
        runtimePolicy: { files: [], toolDeny: ['browser-harness'] },
      }),
    );
    expect((await managed(hermesHome)).mcp_servers['browser-harness']).toEqual({ enabled: false });
    expect(result.mcpToolsets).toEqual(['itsaplan']);
  });

  it('refuses a library server named like a server of the shared configuration', async () => {
    const { materializer } = await home();
    await expect(
      materializer.apply(
        snapshot('sha256:one', { mcpServers: [{ ...library, name: 'browser-harness' }] }),
      ),
    ).rejects.toThrow('has the name of a Hermes toolset or server');
  });

  it('takes servers and settings from a registered contribution', async () => {
    const { hermesHome, materializer } = await home();
    registerProfileContribution({
      id: 'test-extra',
      mcpServers: ({ runtime }) =>
        runtime === 'hermes'
          ? [{ name: 'extra-tool', transport: 'http', url: 'http://127.0.0.1:9/mcp' }]
          : [],
      suppress: () => ['browser-harness'],
      denyToolsets: () => ['browser'],
      hermesConfig: () => ({ fallback_providers: [{ provider: 'anthropic' }] }),
    });
    try {
      const result = await materializer.apply(snapshot('sha256:one'));
      expect(result.deniedToolsets).toEqual(['browser']);
      const config = await managed(hermesHome);
      expect(config.mcp_servers['extra-tool']).toEqual({
        url: 'http://127.0.0.1:9/mcp',
        headers: {},
        enabled: true,
      });
      expect(config.mcp_servers['browser-harness']).toEqual({ enabled: false });
      expect(config.fallback_providers).toEqual([{ provider: 'anthropic' }]);
    } finally {
      unregisterProfileContribution('test-extra');
    }
  });
});

describe('the shared configuration link', () => {
  it('puts back a config.yaml that replaced the link, keeps the file and reports it', async () => {
    const { hermesHome, shared, materializer } = await home();
    await mkdir(hermesHome, { recursive: true });
    // What the hand-edited CDP fix of 2026-09-24 left: a regular file instead of the link.
    await writeFile(join(hermesHome, 'config.yaml'), 'mcp_servers: {}\n');

    expect(await materializer.ensurePlugins()).toEqual(['config.yaml']);
    expect(await readlink(join(hermesHome, 'config.yaml'))).toBe(shared);
    const aside = (await readdir(join(hermesHome, 'run'))).filter((name) =>
      name.startsWith('config.yaml.outside-'),
    );
    expect(aside).toHaveLength(1);
    expect(await readFile(join(hermesHome, 'run', aside[0]!), 'utf8')).toBe('mcp_servers: {}\n');
    // In place now: nothing more to do.
    expect(await materializer.ensurePlugins()).toEqual([]);
    expect((await lstat(join(hermesHome, 'config.yaml'))).isSymbolicLink()).toBe(true);
  });

  it('creates the link in a new home', async () => {
    const { hermesHome, shared, materializer } = await home();
    await mkdir(hermesHome, { recursive: true });
    expect(await materializer.ensurePlugins()).toEqual(['config.yaml']);
    expect(await readlink(join(hermesHome, 'config.yaml'))).toBe(shared);
  });
});

describe('drift detection', () => {
  async function synced(options: { hermes?: FakeHermes } = {}) {
    const setup = await home(options);
    const statuses: RuntimeStatus[] = [];
    let now = 0;
    const snapshots = [snapshot('sha256:one', { mcpServers: [library] })];
    const sync = new HermesPolicySynchronizer(client(snapshots, statuses), setup.materializer, {
      profile: setup.profile,
      now: () => now,
    });
    return { ...setup, statuses, sync, advance: (ms: number) => (now += ms) };
  }

  it('reports a synced profile with its digest and the runtime defaults', async () => {
    const { sync, statuses, hermesHome, materializer } = await synced();
    await materializer.ensurePlugins();
    await mkdir(hermesHome, { recursive: true });
    await sync.ensure();

    const profile = statuses.at(-1)?.profile;
    expect(profile?.drift).toEqual([]);
    expect(profile?.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(profile?.defaults).toEqual({
      model: 'gpt-test',
      provider: 'test-provider',
      reasoning: 'low',
    });
    expect(profile?.mcpServers).toEqual([
      { name: 'browser-harness', enabled: true, managed: true },
      { name: 'itsaplan', enabled: true, managed: true },
      { name: 'shopify-dev', enabled: true, managed: true },
    ]);
    expect(sync.defaults()?.model).toBe('gpt-test');
    expect(statuses.at(-1)?.detail).toBeNull();
    // The same profile checked again later is not reported again.
    const reports = statuses.length;
    await sync.ensure();
    expect(statuses).toHaveLength(reports);
  });

  it('turns off a server the shared configuration gained, without leaving drift', async () => {
    const { sync, statuses, hermes, hermesHome, advance } = await synced();
    await sync.ensure();
    hermes.shared['new-server'] = { command: '/bin/true' };
    advance(5 * 60_000);
    await sync.ensure();

    expect((await managed(hermesHome)).mcp_servers['new-server']).toEqual({ enabled: false });
    const profile = statuses.at(-1)?.profile;
    expect(profile?.drift.filter((d) => d.code !== 'not-linked')).toEqual([]);
    expect(profile?.mcpServers).toContainEqual({
      name: 'new-server',
      enabled: false,
      managed: false,
    });
  });

  it('reports a managed configuration Hermes does not apply, and says so on the status', async () => {
    const hermes = fakeHermes(structuredClone(SHARED));
    const { sync, statuses, materializer } = await synced({ hermes });
    await materializer.ensurePlugins();
    hermes.ignoreManaged = true;
    await sync.ensure();

    const drift = statuses.at(-1)?.profile?.drift ?? [];
    expect(drift).toContainEqual({
      key: 'run/itsaplan-managed/config.yaml',
      code: 'managed-config',
    });
    // The harness of the shared configuration still points at the Home browser.
    expect(drift).toContainEqual({
      key: 'mcp_servers.browser-harness',
      code: 'mcp-differs',
      detail: 'args, env.BU_CDP_URL',
    });
    expect(drift).toContainEqual({ key: 'mcp_servers.shopify-dev', code: 'mcp-missing' });
    expect(statuses.at(-1)?.detail).toBe("The agent's profile differs from Ava's settings.");
    expect(JSON.stringify(drift)).not.toContain('9222');
  });

  it('reports dangerous commands that no approval guard decides', async () => {
    const hermes = fakeHermes(structuredClone(SHARED));
    hermes.approvals = { singleQueryMode: 'approve', plugins: [] };
    const { sync, statuses, materializer } = await synced({ hermes });
    await materializer.ensurePlugins();
    await sync.ensure();
    expect(statuses.at(-1)?.profile?.drift).toContainEqual({
      key: 'approvals.single_query_mode',
      code: 'approval-guard',
    });
  });

  it('rewrites the whole profile for "Neu schreiben" and reports the action done', async () => {
    const setup = await home();
    const statuses: RuntimeStatus[] = [];
    const sync = new HermesPolicySynchronizer(
      client(
        [
          snapshot('sha256:one'),
          snapshot('sha256:two', { actions: [{ id: 41, kind: 'rewrite-profile' }] }),
        ],
        statuses,
      ),
      setup.materializer,
      { profile: setup.profile },
    );
    await sync.ensure();
    const file = join(setup.hermesHome, 'run/itsaplan-managed/config.yaml');
    const before = (await lstat(file)).ino;
    const probes = setup.hermes.probes;
    await sync.ensure();

    expect((await lstat(file)).ino).not.toBe(before);
    expect(setup.hermes.probes).toBeGreaterThan(probes);
    expect(statuses.at(-1)?.actions).toEqual([{ id: 41, error: null }]);
  });
});

describe('the model a run really ran on', () => {
  it("reads the session's model and reasoning from Hermes", async () => {
    const hermes = fakeHermes();
    hermes.sessions.set('s-1', {
      model: 'gpt-5.6-luna',
      reasoning: 'low',
      provider: 'openai-codex',
    });
    const setup = await home({ hermes });
    const sync = new HermesPolicySynchronizer(
      client([snapshot('sha256:one')], []),
      setup.materializer,
      {
        profile: setup.profile,
      },
    );
    await sync.ensure();

    expect(
      await runModelReport(sync, { model: null, reasoning: 'low' }, 's-1', 'gpt-5.6-luna'),
    ).toEqual({
      requested: { model: null, reasoning: 'low' },
      defaults: { model: 'gpt-test', provider: 'test-provider', reasoning: 'low' },
      used: { model: 'gpt-5.6-luna', reasoning: 'low', provider: 'openai-codex' },
    });
    // A session the store does not have: what the command named, reasoning unknown.
    expect(
      (await runModelReport(sync, { model: null, reasoning: null }, 'gone', 'm-x'))?.used,
    ).toEqual({ model: 'm-x', reasoning: null, provider: null });
    expect(
      await runModelReport(null, { model: null, reasoning: null }, 's-1', null),
    ).toBeUndefined();
  });
});

describe('hermesDrift', () => {
  const probe = (
    servers: HermesProbe['mcpServers'],
    extra: Partial<HermesProbe> = {},
  ): HermesProbe => ({
    configLink: '/shared/config.yaml',
    configExists: true,
    managedLoaded: true,
    sharedMcpServers: [],
    mcpServers: servers,
    values: { 'memory.memory_enabled': true },
    defaults: { model: null, provider: null, reasoning: null },
    approvals: { singleQueryMode: 'approve', plugins: ['plan-approval-guard'] },
    security: { tirithEnabled: true, tirithFailOpen: false },
    ...extra,
  });

  it('names what differs by key and never a value', () => {
    const want = renderHermesMcp({
      name: 'docs',
      transport: 'http',
      url: 'https://docs.example/mcp',
      headers: [{ name: 'Authorization', value: { literal: 'secret-token-value' } }],
    });
    const { drift } = hermesDrift(
      {
        managedConfig: {
          memory: { memory_enabled: false },
          mcp_servers: { docs: want, gone: { enabled: false } },
        },
        sharedConfig: '/other/config.yaml',
      },
      probe({
        docs: {
          enabled: true,
          entry: maskEntry({ ...want, headers: { Authorization: 'other-value' } }) as Record<
            string,
            unknown
          >,
        },
        gone: { enabled: true, entry: { command: '/bin/true' } },
      }),
    );
    expect(drift).toEqual([
      { key: 'config.yaml', code: 'not-linked' },
      { key: 'memory.memory_enabled', code: 'setting-differs' },
      { key: 'mcp_servers.docs', code: 'mcp-differs', detail: 'headers.Authorization' },
      { key: 'mcp_servers.gone', code: 'mcp-unmanaged' },
    ]);
    expect(JSON.stringify(drift)).not.toContain('secret-token-value');
  });

  it('collects the same servers for every runtime', () => {
    const snap = snapshot('sha256:one', { mcpServers: [library] });
    const names = (runtime: 'hermes' | 'claude' | 'codex') =>
      collectProfile({
        runtime,
        snapshot: snap,
        url: URL,
        env: { BROWSER_CDP_URL: CDP },
        hermes: PROFILE,
      }).mcpServers.map((spec) => spec.name);
    expect(names('hermes')).toEqual(['itsaplan', 'browser-harness', 'shopify-dev']);
    // The harness is Hermes' own; the other runtimes reach the browser through the gateway.
    expect(names('claude')).toEqual(['itsaplan', 'shopify-dev']);
    expect(names('codex')).toEqual(['itsaplan', 'shopify-dev']);
  });
});
