import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readHermesInventory, type HermesInventory, type HermesProfile } from '../inventory';
import { RequestError } from '../client';
import { readLearnedSkills } from '../learning';
import type { WebLogin } from '../logins';
import { claudeMcpArgs, codexMcpArgs } from '../cli-runtime';
import { collectProfile } from '../contributions';
import {
  allowedToolsets,
  BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
  BROWSER_GATEWAY_MCP_SERVER_NAME,
  BROWSER_GATEWAY_SHIM_PATH,
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  type MaterializerContext,
  toolsetsWithBrowser,
  usesBrowserGateway,
  type LoginVault,
  type RuntimeMcpServer,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
  type RuntimeStatus,
} from '../policy';
import { fakeHermes, type FakeHermes } from './hermes-fake';

const roots: string[] = [];
// Where Helena answers, for a materializer that writes Helena's own MCP server.
const HELENA = { url: 'http://127.0.0.1:3000' };

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(
  profile?: HermesProfile,
  context: MaterializerContext = {},
  hermes: FakeHermes = fakeHermes(),
) {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-policy-'));
  roots.push(root);
  const hermesHome = join(root, 'hermes');
  return {
    root,
    hermesHome,
    hermes,
    materializer: new HermesPolicyMaterializer({
      hermesHome,
      profile,
      context: { reader: hermes, ...context },
    }),
  };
}

const jevBrowser: RuntimeMcpServer = {
  name: 'jev-browser',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@jkudish/jev-browser'],
  url: null,
  env: [
    { name: 'TYPESAFE_API_KEY', secret: 7 },
    { name: 'JEV_BROWSER_MODEL', value: 'jev-latest' },
  ],
  headers: [],
};

const docs: RuntimeMcpServer = {
  name: 'docs',
  transport: 'sse',
  command: null,
  args: [],
  url: 'https://mcp.example.com/sse',
  env: [],
  headers: [{ name: 'Authorization', secret: 8 }],
};

function withServers(
  revision: string,
  mcpServers: RuntimeMcpServer[],
  toolDeny: string[] = [],
): RuntimePolicySnapshot {
  return { revision, runtimePolicy: { files: [], toolDeny }, skills: [], mcpServers };
}

async function managedConfig(hermesHome: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(hermesHome, 'run/itsaplan-managed/config.yaml'), 'utf8'));
}

// What every managed configuration holds, whatever else Plan sets.
const alwaysOff = {
  auxiliary: {
    background_review: { enabled: false },
    title_generation: { model_upgrade_enabled: false },
  },
};

function snapshot(
  revision: string,
  files: RuntimePolicySnapshot['runtimePolicy']['files'] = [],
  skills: RuntimePolicySnapshot['skills'] = [],
): RuntimePolicySnapshot {
  return { revision, runtimePolicy: { files }, skills };
}

const soul = (content: string) => [{ kind: 'instructions' as const, path: 'SOUL.md', content }];

async function outsideCopies(hermesHome: string): Promise<string[]> {
  return (await readdir(hermesHome)).filter((name) => name.startsWith('SOUL.md.outside-'));
}

describe('Hermes runtime policy materializer', () => {
  it('writes the SOUL.md and linked skills atomically', async () => {
    const { hermesHome, materializer } = await fixture();
    const result = await materializer.apply(
      snapshot('sha256:first', soul('# Soul'), [
        {
          id: 7,
          slug: 'plan-7',
          name: 'Triage',
          description: 'Triage work',
          markdown: '# Skill',
          files: [{ path: 'refs/checklist.md', content: '# Checklist' }],
        },
      ]),
    );

    expect(result).toEqual({
      revision: 'sha256:first',
      conflicts: [],
      restored: [],
      mcpSecrets: null,
      managedConfig: alwaysOff,
      mcpToolsets: [],
      runtimeServers: [],
      deniedToolsets: [],
      managedChanged: true,
    });
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Soul');
    expect(await readFile(join(hermesHome, 'skills/plan-managed/plan-7/SKILL.md'), 'utf8')).toBe(
      '# Skill',
    );
    expect(
      await readFile(join(hermesHome, 'skills/plan-managed/plan-7/refs/checklist.md'), 'utf8'),
    ).toBe('# Checklist');
    const manifest = join(hermesHome, 'run/itsaplan-policy-manifest.json');
    expect((await lstat(manifest)).mode & 0o077).toBe(0);
    expect(await readFile(manifest, 'utf8')).not.toContain('# Soul');
  });

  it('updates and removes only files owned by the private manifest', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply(
      snapshot('sha256:first', soul('old'), [
        {
          id: 2,
          slug: 'plan-2',
          name: 'Skill',
          description: '',
          markdown: 'remove skill',
          files: [],
        },
      ]),
    );
    const unmanagedSkill = join(hermesHome, 'skills/plan-managed/unmanaged');
    await mkdir(unmanagedSkill, { recursive: true });
    await writeFile(join(unmanagedSkill, 'note.md'), 'keep skill');

    await materializer.apply(snapshot('sha256:second', soul('new')));

    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('new');
    expect(await readFile(join(unmanagedSkill, 'note.md'), 'utf8')).toBe('keep skill');
    await expect(
      readFile(join(hermesHome, 'skills/plan-managed/plan-2/SKILL.md'), 'utf8'),
    ).rejects.toThrow();

    await materializer.apply(snapshot('sha256:removed'));
    await expect(readFile(join(hermesHome, 'SOUL.md'), 'utf8')).rejects.toThrow();
  });

  it('takes over an existing SOUL.md and keeps and reports its content', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Hermes default');

    const result = await materializer.apply(snapshot('sha256:adopt', soul('# Plan soul')));

    expect(result.conflicts).toEqual([{ path: 'SOUL.md', content: '# Hermes default' }]);
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Plan soul');
    const [copy] = await outsideCopies(hermesHome);
    expect(await readFile(join(hermesHome, copy!), 'utf8')).toBe('# Hermes default');
  });

  it('replaces a SOUL.md edited outside Plan and reports the edit', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply(snapshot('sha256:one', soul('# Plan soul')));
    await writeFile(join(hermesHome, 'SOUL.md'), '# Edited by Hermes');

    const result = await materializer.apply(snapshot('sha256:two', soul('# Plan soul v2')));

    expect(result.conflicts).toEqual([{ path: 'SOUL.md', content: '# Edited by Hermes' }]);
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Plan soul v2');
    expect(await outsideCopies(hermesHome)).toHaveLength(1);
  });

  it('leaves a file edited outside Plan in place when Plan stops managing it', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply(snapshot('sha256:owned', soul('owned')));
    await writeFile(join(hermesHome, 'SOUL.md'), 'changed outside');

    const result = await materializer.apply(snapshot('sha256:released'));

    expect(result.conflicts).toEqual([]);
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('changed outside');
  });

  it('drops files of an older manifest it no longer writes without touching them', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(join(hermesHome, 'run'), { recursive: true });
    await writeFile(join(hermesHome, 'AGENTS.md'), 'project file');
    await writeFile(
      join(hermesHome, 'run/itsaplan-policy-manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        revision: 'sha256:old',
        entries: [{ source: 'runtime', path: 'AGENTS.md', sha256: 'a'.repeat(64) }],
      }),
      { mode: 0o600 },
    );

    await materializer.apply(snapshot('sha256:new', soul('# Soul')));

    expect(await readFile(join(hermesHome, 'AGENTS.md'), 'utf8')).toBe('project file');
    expect(await readFile(join(hermesHome, 'SOUL.md'), 'utf8')).toBe('# Soul');
  });

  it('rejects traversal, other paths, unsafe skill slugs and symlinks', async () => {
    const { root, hermesHome, materializer } = await fixture();
    await expect(
      materializer.apply(
        snapshot('sha256:bad', [{ kind: 'instructions', path: '../config.yaml', content: 'bad' }]),
      ),
    ).rejects.toThrow('unsafe path');
    await expect(
      materializer.apply(
        snapshot('sha256:memory', [{ kind: 'instructions', path: 'MEMORY.md', content: 'x' }]),
      ),
    ).rejects.toThrow('unsafe path');
    await expect(
      materializer.apply(
        snapshot(
          'sha256:bad-skill',
          [],
          [
            {
              id: 1,
              slug: '../skill',
              name: 'Bad',
              description: '',
              markdown: 'bad',
              files: [],
            },
          ],
        ),
      ),
    ).rejects.toThrow('identity is invalid');

    const outside = join(root, 'outside');
    await writeFile(outside, 'outside');
    await mkdir(hermesHome, { recursive: true });
    await symlink(outside, join(hermesHome, 'SOUL.md'));
    await expect(materializer.apply(snapshot('sha256:symlink', soul('replace')))).rejects.toThrow(
      'unsafe',
    );
    expect(await readFile(outside, 'utf8')).toBe('outside');
  });
});

describe('Hermes managed MCP servers', () => {
  it("writes the agent's servers, secrets as variables, and turns denied servers off", async () => {
    const { hermesHome, materializer } = await fixture({
      toolsets: ['terminal', 'web'],
      mcpServers: ['itsaplan', 'browser-harness'],
    });
    const result = await materializer.apply(
      withServers('sha256:one', [jevBrowser, docs], ['browser-harness', 'terminal']),
    );

    expect(result.mcpSecrets).toEqual([7, 8]);
    expect(await managedConfig(hermesHome)).toEqual({
      ...alwaysOff,
      mcp_servers: {
        'jev-browser': {
          command: 'npx',
          args: ['-y', '@jkudish/jev-browser'],
          env: { TYPESAFE_API_KEY: '${ITSAPLAN_MCP_SECRET_7}', JEV_BROWSER_MODEL: 'jev-latest' },
          enabled: true,
        },
        docs: {
          url: 'https://mcp.example.com/sse',
          transport: 'sse',
          headers: { Authorization: '${ITSAPLAN_MCP_SECRET_8}' },
          enabled: true,
        },
        // Servers of the shared configuration Helena does not give the agent are off.
        itsaplan: { enabled: false },
        'browser-harness': { enabled: false },
      },
    });
    const file = join(hermesHome, 'run/itsaplan-managed/config.yaml');
    expect((await lstat(file)).mode & 0o077).toBe(0);
  });

  it('drops the servers from the managed configuration once the agent has none', async () => {
    const { hermesHome, materializer } = await fixture({ toolsets: [], mcpServers: [] });
    await materializer.apply(withServers('sha256:one', [jevBrowser]));
    const result = await materializer.apply(withServers('sha256:two', [], ['web']));

    expect(result.mcpSecrets).toBeNull();
    expect(await managedConfig(hermesHome)).toEqual(alwaysOff);
  });

  it('refuses a server named like a toolset or server of the profile, or badly', async () => {
    const { hermesHome, materializer } = await fixture({
      toolsets: ['terminal'],
      mcpServers: ['itsaplan'],
    });
    for (const name of ['itsaplan', 'terminal']) {
      await expect(
        materializer.apply(withServers('sha256:one', [{ ...jevBrowser, name }])),
      ).rejects.toThrow(`MCP server ${name} has the name of a Hermes toolset or server`);
    }
    await expect(
      materializer.apply(withServers('sha256:one', [{ ...jevBrowser, name: '../x' }])),
    ).rejects.toThrow('invalid MCP server name');
    await expect(
      materializer.apply(withServers('sha256:one', [jevBrowser, jevBrowser])),
    ).rejects.toThrow('invalid MCP server name');
    await expect(readFile(join(hermesHome, 'run/itsaplan-managed/config.yaml'))).rejects.toThrow();
  });
});

describe('Hermes runtime policy synchronizer', () => {
  function client(
    values: RuntimePolicySnapshot[],
    statuses: RuntimeStatus[],
    secrets: Record<string, string>[] = [],
  ): RuntimePolicyClient {
    return {
      runtimePolicy: async () => {
        const next = values.shift();
        if (!next) throw new Error('server unreachable');
        return next;
      },
      reportRuntimeStatus: async (status) => {
        statuses.push(status);
      },
      mcpSecrets: async () => {
        const next = secrets.shift();
        if (!next) throw new Error('no secrets expected');
        return next;
      },
      webLogins: async () => {
        throw new Error('no logins expected');
      },
    };
  }

  it('reports applied revisions and a secret-free degraded status without throwing', async () => {
    const { materializer } = await fixture();
    const statuses: RuntimeStatus[] = [];
    const sync = new HermesPolicySynchronizer(
      client(
        [
          snapshot('sha256:one', soul('one')),
          snapshot('sha256:one', soul('one')),
          snapshot('sha256:two', soul('two')),
          snapshot('sha256:bad', [
            { kind: 'instructions', path: '../secret-token.md', content: 'provider-secret-value' },
          ]),
        ],
        statuses,
      ),
      materializer,
    );

    await sync.ensure();
    await sync.ensure();
    await sync.ensure();
    await sync.ensure();
    // An unreachable server leaves the applied policy in place.
    await sync.ensure();

    expect(statuses.map(({ status, appliedRevision }) => ({ status, appliedRevision }))).toEqual([
      { status: 'online', appliedRevision: 'sha256:one' },
      { status: 'online', appliedRevision: 'sha256:two' },
      { status: 'degraded', appliedRevision: 'sha256:two' },
    ]);
    expect(statuses[0]?.capabilities).toEqual([
      'model',
      'reasoning',
      'managed-markdown',
      'managed-skills',
      'managed-mcp-servers',
      'learning',
      'profile-drift',
      'rewrite-profile',
      'session-facts',
      // What Helena can ask the runtime through the runner (readers/).
      'sessions',
      'session-search',
      'transcripts',
      'logs',
      'health',
      'version',
      'curator',
      'estop',
      // Plan limits of the runtime's logins (limits/).
      'limits',
    ]);
    expect(JSON.stringify(statuses)).not.toContain('provider-secret-value');
    expect(statuses.at(-1)?.detail).toBe(
      'Runtime policy sync failed: runtime policy contains an unsafe path',
    );
  });

  it('retries a failed revision only after a pause', async () => {
    const { materializer } = await fixture();
    const statuses: RuntimeStatus[] = [];
    const bad = () =>
      snapshot('sha256:bad', [{ kind: 'instructions', path: 'AGENTS.md', content: 'x' }]);
    let now = 0;
    const sync = new HermesPolicySynchronizer(
      client([bad(), bad(), bad()], statuses),
      materializer,
      { now: () => now },
    );

    await sync.ensure();
    now = 30_000;
    await sync.ensure();
    now = 61_000;
    await sync.ensure();

    expect(statuses.map(({ status }) => status)).toEqual(['degraded', 'degraded']);
  });

  it('reports the files it replaced', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Hermes default');
    const statuses: RuntimeStatus[] = [];
    const sync = new HermesPolicySynchronizer(
      client([snapshot('sha256:one', soul('# Plan soul'))], statuses),
      materializer,
    );

    await sync.ensure();

    expect(statuses).toEqual([
      expect.objectContaining({
        status: 'online',
        conflicts: [{ path: 'SOUL.md', content: '# Hermes default' }],
      }),
    ]);
  });

  it('reports the inventory with the status, and again only once it changed', async () => {
    const { hermesHome, materializer } = await fixture(undefined, HELENA);
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Hermes default');
    const statuses: RuntimeStatus[] = [];
    let memory = '';
    const inventory = async (): Promise<HermesInventory> => ({
      toolsets: ['file', 'web'],
      mcpServers: ['itsaplan'],
      skills: [],
      memory: [{ file: 'MEMORY.md', content: memory, truncated: false, sha256: '', chars: 0 }],
      cronJobs: 0,
    });
    let now = 0;
    const same = () => snapshot('sha256:one', soul('# Plan soul'));
    const sync = new HermesPolicySynchronizer(
      client([same(), same(), same(), same(), same()], statuses),
      materializer,
      { inventory, now: () => now },
    );

    await sync.ensure();
    memory = 'Prefers short answers.';
    // Within the interval the profile is not read again.
    now = 30_000;
    await sync.ensure();
    now = 60_000;
    await sync.ensure();
    // Unchanged since the last read: nothing to report.
    sync.inventoryChanged();
    await sync.ensure();
    memory = 'Prefers German.';
    sync.inventoryChanged();
    await sync.ensure();

    expect(statuses.map((status) => status.inventory?.memory[0]?.content)).toEqual([
      '',
      'Prefers short answers.',
      'Prefers German.',
    ]);
    // A report replaces the whole state Plan keeps, so the conflicts come along again.
    expect(statuses.at(-1)).toMatchObject({
      status: 'online',
      appliedRevision: 'sha256:one',
      conflicts: [{ path: 'SOUL.md', content: '# Hermes default' }],
      inventory: { toolsets: ['file', 'web'], mcpServers: ['itsaplan'] },
    });
  });

  it('restricts the toolsets as the latest policy says, even one that failed to apply', async () => {
    const { materializer } = await fixture(undefined, HELENA);
    const profile = { toolsets: ['file', 'terminal', 'web'], mcpServers: ['itsaplan'] };
    const withDeny = (revision: string, toolDeny: string[], path = 'SOUL.md') => ({
      revision,
      runtimePolicy: { files: [{ kind: 'instructions' as const, path, content: 'x' }], toolDeny },
      skills: [],
    });
    const sync = new HermesPolicySynchronizer(
      client([withDeny('sha256:one', []), withDeny('sha256:two', ['terminal'], 'AGENTS.md')], []),
      materializer,
      { profile },
    );

    // Before the first revision no MCP server is Helena's yet.
    expect(sync.toolsets()).toEqual(['file', 'terminal', 'web']);
    await sync.ensure();
    expect(sync.toolsets()).toEqual(['file', 'terminal', 'web', 'itsaplan']);
    await sync.ensure();
    expect(sync.toolsets()).toEqual(['file', 'web', 'itsaplan']);
  });

  it('hands each run the managed configuration and the current values of its secrets', async () => {
    const profile = { toolsets: ['file', 'web'], mcpServers: ['itsaplan'] };
    const { materializer } = await fixture(profile, HELENA);
    const sync = new HermesPolicySynchronizer(
      client(
        [withServers('sha256:one', [jevBrowser], ['web']), withServers('sha256:two', [])],
        [],
        [{ '7': 'first-value' }, {}, { '7': 'x', '9': 'newer-value' }],
      ),
      materializer,
      { profile },
    );

    const managed = { HERMES_MANAGED_DIR: materializer.managedDir };
    expect(await sync.runSettings()).toEqual({ toolsets: ['file', 'web'], env: managed });
    await sync.ensure();
    const settings = {
      toolsets: ['file', 'itsaplan', 'jev-browser'],
      env: { HERMES_MANAGED_DIR: materializer.managedDir, ITSAPLAN_MCP_SECRET_7: 'first-value' },
    };
    expect(await sync.runSettings()).toEqual(settings);
    // A secret deleted in Plan since.
    expect(await sync.runSettings()).toEqual({
      ...settings,
      env: { ...settings.env, ITSAPLAN_MCP_SECRET_7: '' },
    });
    // A newer revision's secret, for a managed configuration the other feed rewrote.
    expect((await sync.runSettings()).env).toEqual({
      HERMES_MANAGED_DIR: materializer.managedDir,
      ITSAPLAN_MCP_SECRET_7: 'x',
      ITSAPLAN_MCP_SECRET_9: 'newer-value',
    });

    // Without servers there is nothing to read from Plan.
    await sync.ensure();
    expect(await sync.runSettings()).toEqual({
      toolsets: ['file', 'web', 'itsaplan'],
      env: managed,
    });
  });

  it('hands the vault paths of the latest policy to Hermes in the environment', async () => {
    const { materializer } = await fixture();
    const vaultAccess = {
      root: '/srv/volition/vault',
      read: ['/srv/volition/vault/Projects/VOL', '/srv/volition/vault/Templates'],
      write: ['/srv/volition/vault/Projects/VOL'],
      deny: ['/srv/volition/vault/Private'],
    };
    const sync = new HermesPolicySynchronizer(
      client(
        [
          {
            revision: 'sha256:one',
            runtimePolicy: { files: [{ kind: 'instructions', path: 'SOUL.md', content: 'x' }] },
            skills: [],
            vaultAccess,
          },
        ],
        [],
      ),
      materializer,
    );

    expect((await sync.runSettings()).env.VOLITION_VAULT_ACCESS).toBeUndefined();
    await sync.ensure();
    const { env } = await sync.runSettings();
    expect(JSON.parse(env.VOLITION_VAULT_ACCESS!)).toEqual(vaultAccess);
  });
});

describe('Hermes toolset restriction', () => {
  const profile = { toolsets: ['browser', 'file', 'terminal'], mcpServers: ['itsaplan'] };

  it('names the toolsets, the MCP servers and the agent servers while nothing is denied', () => {
    expect(allowedToolsets(profile, [])).toEqual(['browser', 'file', 'terminal', 'itsaplan']);
    expect(allowedToolsets(profile, ['message.send'], ['shopify-dev'])).toEqual([
      'browser',
      'file',
      'terminal',
      'itsaplan',
      'shopify-dev',
    ]);
  });

  it('leaves Hermes on its own selection without the profile', () => {
    expect(allowedToolsets(undefined, ['terminal'])).toBeNull();
  });

  it('names the toolsets and MCP servers that stay on, and the agent servers', () => {
    expect(allowedToolsets(profile, ['terminal'])).toEqual(['browser', 'file', 'itsaplan']);
    expect(allowedToolsets(profile, ['browser', 'file', 'terminal'])).toEqual(['itsaplan']);
    expect(allowedToolsets(profile, ['itsaplan'], ['shopify-dev'])).toEqual([
      'browser',
      'file',
      'terminal',
      'shopify-dev',
    ]);
  });

  it('never passes the Hermes scheduler on, whatever the policy allows', () => {
    const withCron = { ...profile, toolsets: ['cronjob', ...profile.toolsets] };
    expect(allowedToolsets(withCron, [])).toEqual(['browser', 'file', 'terminal', 'itsaplan']);
    expect(allowedToolsets(withCron, ['terminal'])).toEqual(['browser', 'file', 'itsaplan']);
  });

  it('refuses a list Hermes would read as no selection', () => {
    expect(() => allowedToolsets({ toolsets: ['file'], mcpServers: [] }, ['file'])).toThrow(
      'Every Hermes toolset and MCP server of the agent is turned off',
    );
  });
});

describe('Hermes learning and protected state', () => {
  const triage = {
    id: 7,
    slug: 'plan-7',
    name: 'Triage',
    description: 'Triage work',
    markdown: '# Triage',
    files: [{ path: 'refs/checklist.md', content: '# Checklist' }],
  };

  function sequence(values: RuntimePolicySnapshot[], statuses: RuntimeStatus[]) {
    let last: RuntimePolicySnapshot | undefined;
    return {
      runtimePolicy: async () => (last = values.shift() ?? last)!,
      reportRuntimeStatus: async (status: RuntimeStatus) => {
        statuses.push(status);
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
    } satisfies RuntimePolicyClient;
  }

  it('turns learning on or off in the managed configuration and pauses the curator', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply({
      ...snapshot('sha256:off'),
      learning: { enabled: false, curator: false },
    });

    expect(await managedConfig(hermesHome)).toEqual({
      ...alwaysOff,
      memory: { memory_enabled: false, user_profile_enabled: false },
      skills: { write_approval: true },
    });
    expect(JSON.parse(await readFile(join(hermesHome, 'skills/.curator_state'), 'utf8'))).toEqual({
      paused: true,
    });

    await materializer.apply({
      ...snapshot('sha256:on'),
      learning: { enabled: true, curator: true },
    });
    expect(await managedConfig(hermesHome)).toMatchObject({
      memory: { memory_enabled: true, user_profile_enabled: true },
      skills: { write_approval: false },
    });
    expect(
      JSON.parse(await readFile(join(hermesHome, 'skills/.curator_state'), 'utf8')).paused,
    ).toBe(false);
  });

  it('leaves the memory tool out of the toolsets of an agent that does not learn', async () => {
    const profile = { toolsets: ['file', 'memory', 'skills'], mcpServers: [] };
    const { materializer } = await fixture(profile);
    const sync = new HermesPolicySynchronizer(
      sequence([{ ...snapshot('sha256:off'), learning: { enabled: false, curator: false } }], []),
      materializer,
      { profile },
    );

    await sync.ensure();

    expect(sync.toolsets()).toEqual(['file', 'skills']);
  });

  it('puts back a managed skill the agent changed or removed, and reports it', async () => {
    const { hermesHome, materializer } = await fixture();
    const statuses: RuntimeStatus[] = [];
    let now = 0;
    const sync = new HermesPolicySynchronizer(
      sequence([snapshot('sha256:one', soul('# Soul'), [triage])], statuses),
      materializer,
      { now: () => now },
    );
    await sync.ensure();
    const skillFile = join(hermesHome, 'skills/plan-managed/plan-7/SKILL.md');
    await writeFile(skillFile, '# Patched by the agent');
    await rm(join(hermesHome, 'skills/plan-managed/plan-7/refs/checklist.md'));

    // Within the interval nothing is checked; after a run it is.
    now = 10_000;
    await sync.ensure();
    expect(statuses).toHaveLength(1);
    sync.inventoryChanged();
    await sync.ensure();

    expect(await readFile(skillFile, 'utf8')).toBe('# Triage');
    expect(
      await readFile(join(hermesHome, 'skills/plan-managed/plan-7/refs/checklist.md'), 'utf8'),
    ).toBe('# Checklist');
    expect(statuses.at(-1)).toMatchObject({
      status: 'online',
      restored: [
        'skills/plan-managed/plan-7/SKILL.md',
        'skills/plan-managed/plan-7/refs/checklist.md',
      ],
      conflicts: [{ path: 'skills/plan-7/SKILL.md', content: '# Patched by the agent' }],
    });

    // Nothing changed since: nothing more to report.
    sync.inventoryChanged();
    await sync.ensure();
    expect(statuses).toHaveLength(2);
  });

  it('keeps the plugin links Plan requires, before every run and at each check', async () => {
    const { root, hermesHome } = await fixture();
    const guard = join(root, 'plan/hermes-plugins/plan-approval-guard');
    await mkdir(guard, { recursive: true });
    const profile = {
      toolsets: ['file'],
      mcpServers: [],
      plugins: { 'plan-approval-guard': guard },
    };
    const materializer = new HermesPolicyMaterializer({ hermesHome, profile });
    const statuses: RuntimeStatus[] = [];
    let now = 0;
    const sync = new HermesPolicySynchronizer(
      sequence([snapshot('sha256:one', soul('# Soul'))], statuses),
      materializer,
      { profile, now: () => now },
    );
    const link = join(hermesHome, 'plugins/plan-approval-guard');

    // A home that never had the link gets it before the first run, also when two runs
    // start together.
    await Promise.all([sync.runSettings(), sync.runSettings()]);
    expect(await readlink(link)).toBe(guard);
    await sync.ensure();
    expect(statuses[0]?.restored).toEqual(['plugins/plan-approval-guard']);

    // The agent replaced the link with a plugin of its own.
    await rm(link);
    await mkdir(link);
    await writeFile(join(link, '__init__.py'), 'def register(ctx): pass');
    now = 60_000;
    await sync.ensure();

    expect(await readlink(link)).toBe(guard);
    const moved = (await readdir(join(hermesHome, 'run'))).filter((name) =>
      name.startsWith('plugin-plan-approval-guard.outside-'),
    );
    expect(moved).toHaveLength(1);
    expect(statuses.at(-1)).toMatchObject({
      detail: expect.stringContaining('plugin links changed outside Helena were restored'),
      restored: ['plugins/plan-approval-guard'],
    });
  });

  it('carries out the actions of a revision once and reports their results', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(join(hermesHome, 'memories'), { recursive: true });
    await writeFile(join(hermesHome, 'memories/MEMORY.md'), 'old');
    const statuses: RuntimeStatus[] = [];
    const withActions: RuntimePolicySnapshot = {
      ...snapshot('sha256:one'),
      actions: [
        { id: 3, kind: 'write-memory', file: 'MEMORY.md', content: 'new', baseSha256: 'x' },
        {
          id: 4,
          kind: 'write-memory',
          file: 'MEMORY.md',
          content: 'edited',
          baseSha256: createHash('sha256').update('old').digest('hex'),
        },
      ],
    };
    let reachable = false;
    const values = [withActions, withActions, withActions, snapshot('sha256:two')];
    const sync = new HermesPolicySynchronizer(
      {
        runtimePolicy: async () => values.shift()!,
        reportRuntimeStatus: async (status) => {
          if (!reachable) throw new Error('server unreachable');
          statuses.push(status);
        },
        mcpSecrets: async () => ({}),
        webLogins: async () => [],
      },
      materializer,
    );

    await sync.ensure();
    // The report did not arrive, so the next sync sends it again, and the same revision
    // does not run its actions a second time.
    reachable = true;
    await sync.ensure();
    await sync.ensure();
    await sync.ensure();

    expect(await readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).toBe('edited');
    expect(statuses.map((status) => status.actions)).toEqual([
      [
        { id: 3, error: 'The memory changed since it was read; reload it and edit again' },
        { id: 4, error: null },
      ],
      [],
    ]);
  });

  it('reports the content of the skills the agent created with the inventory', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(join(hermesHome, 'skills/notes'), { recursive: true });
    await writeFile(join(hermesHome, 'skills/notes/SKILL.md'), '---\nname: notes\n---\n# Notes');
    const statuses: RuntimeStatus[] = [];
    const sync = new HermesPolicySynchronizer(
      sequence([snapshot('sha256:one')], statuses),
      materializer,
      {
        inventory: () => readHermesInventory(hermesHome, undefined),
        learned: (skills) => readLearnedSkills(hermesHome, skills),
      },
    );

    await sync.ensure();

    expect(statuses[0]?.learnedSkills).toEqual([
      {
        path: 'notes',
        name: 'notes',
        markdown: '---\nname: notes\n---\n# Notes',
        files: [],
        otherFiles: 0,
        truncated: false,
      },
    ]);
  });

  it('keeps saying that a revision failed when it restores a plugin link meanwhile', async () => {
    const { root, hermesHome } = await fixture();
    const guard = join(root, 'plan-approval-guard');
    await mkdir(guard, { recursive: true });
    const profile = {
      toolsets: ['file'],
      mcpServers: [],
      plugins: { 'plan-approval-guard': guard },
    };
    const materializer = new HermesPolicyMaterializer({ hermesHome, profile });
    const statuses: RuntimeStatus[] = [];
    const bad = snapshot('sha256:bad', [{ kind: 'instructions', path: 'AGENTS.md', content: 'x' }]);
    const sync = new HermesPolicySynchronizer(sequence([bad], statuses), materializer, {
      profile,
    });

    await sync.ensure();
    // The home has no link yet: the run that starts puts it there.
    await sync.runSettings();
    await sync.ensure();

    expect(statuses.at(-1)).toMatchObject({
      status: 'degraded',
      detail: expect.stringContaining('Runtime policy sync failed'),
      restored: ['plugins/plan-approval-guard'],
    });
  });

  it('sends a report again only when it did not arrive, not when Plan refused it', async () => {
    const { materializer } = await fixture();
    const sent: RuntimeStatus[] = [];
    let answer: Error | null = new RequestError(400, 'refused');
    const sync = new HermesPolicySynchronizer(
      {
        runtimePolicy: async () => snapshot('sha256:one', soul('# Soul')),
        reportRuntimeStatus: async (status) => {
          sent.push(status);
          if (answer) throw answer;
        },
        mcpSecrets: async () => ({}),
        webLogins: async () => [],
      },
      materializer,
    );

    await sync.ensure();
    await sync.ensure();
    expect(sent).toHaveLength(1);

    answer = new Error('connection refused');
    await rm(join(materializer.hermesHome, 'SOUL.md'));
    sync.inventoryChanged();
    await sync.ensure();
    answer = null;
    await sync.ensure();
    expect(sent).toHaveLength(3);
  });
});

describe('memory writes held for the owner and Hermes settings from Helena', () => {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  it('reports a memory change as a proposal and puts the approved version back', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(join(hermesHome, 'memories'), { recursive: true });
    await writeFile(
      join(hermesHome, 'memories/MEMORY.md'),
      'Uses bun.\n§\nOwner likes short answers.',
    );
    const statuses: RuntimeStatus[] = [];
    const policy: RuntimePolicySnapshot = {
      ...snapshot('sha256:mem'),
      memoryWrites: {
        approval: true,
        baseline: [
          { file: 'MEMORY.md', sha256: sha('Uses bun.'), content: 'Uses bun.' },
          { file: 'USER.md', sha256: sha(''), content: '' },
        ],
      },
    };
    let current = policy;
    const sync = new HermesPolicySynchronizer(
      {
        runtimePolicy: async () => current,
        reportRuntimeStatus: async (status) => {
          statuses.push(status);
        },
        mcpSecrets: async () => ({}),
        webLogins: async () => [],
      },
      materializer,
      { inventory: () => readHermesInventory(hermesHome, undefined, new Set()) },
    );

    await sync.ensure();

    expect(await readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).toBe('Uses bun.');
    expect(statuses.at(-1)!.memoryProposals).toEqual([
      {
        file: 'MEMORY.md',
        content: 'Uses bun.\n§\nOwner likes short answers.',
        sha256: sha('Uses bun.\n§\nOwner likes short answers.'),
        baseSha256: sha('Uses bun.'),
      },
    ]);
    expect(statuses.at(-1)!.inventory!.memory[0]!.content).toBe('Uses bun.');

    // Without approval the agent's write stays.
    current = {
      ...policy,
      revision: 'sha256:free',
      memoryWrites: { ...policy.memoryWrites!, approval: false },
    };
    await writeFile(join(hermesHome, 'memories/MEMORY.md'), 'Uses bun.\n§\nNew fact.');
    sync.inventoryChanged();
    await sync.ensure();
    expect(await readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).toBe(
      'Uses bun.\n§\nNew fact.',
    );
    expect(statuses.at(-1)!.memoryProposals).toBeUndefined();
  });

  it('keeps an approved memory write although the snapshot still names the old baseline', async () => {
    const { hermesHome, materializer } = await fixture();
    await mkdir(join(hermesHome, 'memories'), { recursive: true });
    await writeFile(join(hermesHome, 'memories/MEMORY.md'), 'Uses bun.');
    const statuses: RuntimeStatus[] = [];
    const approved = 'Uses bun.\n§\nOwner likes short answers.';
    const policy: RuntimePolicySnapshot = {
      ...snapshot('sha256:approved'),
      memoryWrites: {
        approval: true,
        baseline: [{ file: 'MEMORY.md', sha256: sha('Uses bun.'), content: 'Uses bun.' }],
      },
      actions: [
        {
          id: 7,
          kind: 'write-memory',
          file: 'MEMORY.md',
          content: approved,
          baseSha256: sha('Uses bun.'),
        },
      ],
    };
    const sync = new HermesPolicySynchronizer(
      {
        runtimePolicy: async () => policy,
        reportRuntimeStatus: async (status) => {
          statuses.push(status);
        },
        mcpSecrets: async () => ({}),
        webLogins: async () => [],
      },
      materializer,
      { inventory: () => readHermesInventory(hermesHome, undefined, new Set()) },
    );

    await sync.ensure();

    expect(await readFile(join(hermesHome, 'memories/MEMORY.md'), 'utf8')).toBe(approved);
    expect(statuses.at(-1)!.memoryProposals).toBeUndefined();
    expect(statuses.at(-1)!.actions).toEqual([{ id: 7, error: null }]);
  });

  it('writes the disabled skills and the fallback models into the managed configuration', async () => {
    const { hermesHome, materializer } = await fixture();
    await materializer.apply({
      ...snapshot('sha256:hermes'),
      learning: { enabled: true, curator: false },
      hermes: {
        skillsDisabled: ['airtable'],
        fallbackModels: [{ provider: 'openrouter', model: 'google/gemini-3.6-flash' }],
      },
    });
    expect(await managedConfig(hermesHome)).toMatchObject({
      skills: { write_approval: false, disabled: ['airtable'] },
      fallback_providers: [{ provider: 'openrouter', model: 'google/gemini-3.6-flash' }],
    });
  });
});

const gatewayServer: RuntimeMcpServer = {
  name: BROWSER_GATEWAY_MCP_SERVER_NAME,
  transport: 'stdio',
  command: BROWSER_GATEWAY_SHIM_PATH,
  args: [],
  url: null,
  env: [],
  headers: [],
};

const legacyServer: RuntimeMcpServer = {
  name: BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
  transport: 'stdio',
  command: 'hermes-native-browser-toolset',
  args: [],
  url: null,
  env: [],
  headers: [],
};

// The gateway is a profile contribution (browser-gateway.ts): the same mechanism that owns
// every MCP server of the agent, so these run through the materializer and the synchronizer.
const GATEWAY_PROFILE = {
  toolsets: ['browser', 'file', 'terminal'],
  mcpServers: ['browser-harness', 'itsaplan'],
  browserHarness: '/opt/hermes/bin/browser-harness-mcp',
};
const GATEWAY_CONTEXT = {
  url: 'http://127.0.0.1:3000',
  env: { BROWSER_CDP_URL: 'http://127.0.0.1:19203' },
};

describe('Browser gateway: Hermes side (design §3, §6)', () => {
  it("writes the gateway's shim whatever the library row says, and never the legacy marker", async () => {
    const { hermesHome, materializer } = await fixture(GATEWAY_PROFILE, GATEWAY_CONTEXT);
    await materializer.apply(
      withServers('sha256:one', [
        { ...gatewayServer, command: '/somewhere/else', args: ['--x'] },
        legacyServer,
      ]),
    );
    const servers = (await managedConfig(hermesHome)).mcp_servers as Record<string, unknown>;
    expect(servers[BROWSER_GATEWAY_MCP_SERVER_NAME]).toEqual({
      command: BROWSER_GATEWAY_SHIM_PATH,
      args: [],
      env: {
        ITSAPLAN_API_KEY: '${ITSAPLAN_API_KEY}',
        ITSAPLAN_RUN_ID: '${ITSAPLAN_RUN_ID}',
        ITSAPLAN_MESSAGE_ID: '${ITSAPLAN_MESSAGE_ID}',
        BROWSER_GATEWAY_SOCKET: '${BROWSER_GATEWAY_SOCKET}',
      },
      timeout: 1900,
      enabled: true,
    });
    expect(servers).not.toHaveProperty(BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME);
  });

  it('usesBrowserGateway is true only for the gateway without the explicit legacy fallback', () => {
    expect(usesBrowserGateway([])).toBe(false);
    expect(usesBrowserGateway([BROWSER_GATEWAY_MCP_SERVER_NAME])).toBe(true);
    expect(usesBrowserGateway([BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME])).toBe(false);
    expect(
      usesBrowserGateway([BROWSER_GATEWAY_MCP_SERVER_NAME, BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME]),
    ).toBe(false);
  });

  it('toolsetsWithBrowser keeps its own behavior: forces the browser toolset on for a login sync', () => {
    const profile = { toolsets: ['file'], mcpServers: ['itsaplan'] };
    expect(toolsetsWithBrowser(profile, [], [])).toEqual(['file', 'itsaplan', 'browser']);
    expect(toolsetsWithBrowser(profile, ['browser'], [])).toEqual(['file', 'itsaplan', 'browser']);
  });

  it('turns browser-harness off for an agent on the gateway, and only then', async () => {
    const { hermesHome, materializer } = await fixture(GATEWAY_PROFILE, GATEWAY_CONTEXT);
    const harness = async (servers: RuntimeMcpServer[]) => {
      await materializer.apply(withServers(`sha256:${servers.length}`, servers));
      return (
        (await managedConfig(hermesHome)).mcp_servers as Record<string, { enabled?: boolean }>
      )['browser-harness'];
    };
    expect(await harness([gatewayServer])).toEqual({ enabled: false });
    expect((await harness([gatewayServer, legacyServer]))?.enabled).toBe(true);
    expect((await harness([]))?.enabled).toBe(true);
  });

  describe('the four combinations, through the synchronizer', () => {
    const login: WebLogin = {
      id: 1,
      label: 'Example',
      updatedAt: '2026-01-01T00:00:00Z',
      origins: ['https://example.com'],
      username: 'user',
      password: 'secret',
      totpSecret: null,
    };

    async function run(ownServers: RuntimeMcpServer[]) {
      const { materializer } = await fixture(GATEWAY_PROFILE, GATEWAY_CONTEXT);
      const vaultCalls: WebLogin[][] = [];
      const vault: LoginVault = {
        sync: async (logins) => {
          vaultCalls.push(logins);
          return new Map(logins.map((entry) => [`handle-${entry.id}`, entry.id]));
        },
      };
      const clientStub: RuntimePolicyClient = {
        runtimePolicy: async () => ({
          ...withServers('sha256:one', ownServers),
          webLogins: true,
        }),
        reportRuntimeStatus: async () => {},
        mcpSecrets: async () => ({}),
        webLogins: async () => [login],
      };
      const sync = new HermesPolicySynchronizer(clientStub, materializer, {
        profile: GATEWAY_PROFILE,
        vault,
      });
      await sync.ensure();
      const settings = await sync.runSettings({ runId: 1 });
      return { toolsets: sync.toolsets(), settings, vaultCalls };
    }

    it('neither gateway nor legacy: unchanged (browser forced on, Hermes vault synced)', async () => {
      const { toolsets, settings, vaultCalls } = await run([]);
      expect(toolsets).toEqual(['browser', 'file', 'terminal', 'itsaplan', 'browser-harness']);
      expect(settings.toolsets).toEqual(toolsets);
      expect(vaultCalls).toEqual([[login]]);
      expect(settings.logins?.size).toBe(1);
    });

    it('gateway only: the native browser toolset is excluded and the Hermes vault is emptied, once', async () => {
      const { toolsets, settings, vaultCalls } = await run([gatewayServer]);
      expect(toolsets).toEqual(['file', 'terminal', 'itsaplan', BROWSER_GATEWAY_MCP_SERVER_NAME]);
      expect(settings.toolsets).toEqual(toolsets);
      // Emptied at the policy sync; the run itself finds it done and syncs nothing more.
      expect(vaultCalls).toEqual([[]]);
      expect(settings.logins).toBeUndefined();
    });

    it('legacy only: the explicit fallback keeps the native browser and the vault sync', async () => {
      const { toolsets, settings, vaultCalls } = await run([legacyServer]);
      // The marker is no server, so no toolset names it.
      expect(toolsets).toEqual(['browser', 'file', 'terminal', 'itsaplan', 'browser-harness']);
      expect(settings.toolsets).toEqual(toolsets);
      expect(vaultCalls).toEqual([[login]]);
    });

    it('gateway and legacy together: the fallback wins, and the gateway is there too', async () => {
      const { toolsets, settings, vaultCalls } = await run([gatewayServer, legacyServer]);
      expect(toolsets).toEqual([
        'browser',
        'file',
        'terminal',
        'itsaplan',
        'browser-harness',
        BROWSER_GATEWAY_MCP_SERVER_NAME,
      ]);
      expect(settings.toolsets).toEqual(toolsets);
      expect(vaultCalls).toEqual([[login]]);
    });
  });
});

describe('Browser gateway: Claude Code and Codex get it on the command line', () => {
  const snapshot = (servers: RuntimeMcpServer[]) => withServers('sha256:one', servers);
  const specs = (runtime: 'claude' | 'codex', servers: RuntimeMcpServer[]) =>
    collectProfile({ runtime, snapshot: snapshot(servers), env: {} }).mcpServers;

  it('Claude Code: a dynamic stdio server and its tools allowed', () => {
    const args = claudeMcpArgs(specs('claude', [gatewayServer]));
    expect(args[0]).toBe('--mcp-config');
    expect(JSON.parse(args[1]!)).toEqual({
      mcpServers: {
        [BROWSER_GATEWAY_MCP_SERVER_NAME]: {
          type: 'stdio',
          command: BROWSER_GATEWAY_SHIM_PATH,
          args: [],
          env: {},
        },
      },
    });
    expect(args.slice(2)).toEqual([
      '--strict-mcp-config',
      '--allowedTools',
      `mcp__${BROWSER_GATEWAY_MCP_SERVER_NAME}`,
    ]);
  });

  it('Codex: the table as -c overrides, its variables passed by name', () => {
    expect(codexMcpArgs(specs('codex', [gatewayServer]), [], {}).args).toEqual([
      '-c',
      'mcp_servers.projekt-browser.command="/usr/local/libexec/helena-browser-mcp"',
      '-c',
      'mcp_servers.projekt-browser.args=[]',
      '-c',
      'mcp_servers.projekt-browser.env_vars=["ITSAPLAN_API_KEY","ITSAPLAN_RUN_ID","ITSAPLAN_MESSAGE_ID","BROWSER_GATEWAY_SOCKET"]',
      '-c',
      'mcp_servers.projekt-browser.tool_timeout_sec=1900',
      '-c',
      'mcp_servers.projekt-browser.default_tools_approval_mode="approve"',
      '-c',
      'mcp_servers.projekt-browser.enabled=true',
    ]);
  });

  it('only for an agent with Projekt-Browser on', () => {
    expect(specs('codex', [])).toEqual([]);
    expect(specs('codex', [legacyServer])).toEqual([]);
  });
});
