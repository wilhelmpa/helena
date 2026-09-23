import { afterEach, describe, expect, it } from 'bun:test';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HermesInventory, HermesProfile } from '../inventory';
import {
  allowedToolsets,
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  type RuntimeMcpServer,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
  type RuntimeStatus,
} from '../policy';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(profile?: HermesProfile) {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-policy-'));
  roots.push(root);
  const hermesHome = join(root, 'hermes');
  return {
    root,
    hermesHome,
    materializer: new HermesPolicyMaterializer({ hermesHome, profile }),
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

async function managedConfig(hermesHome: string): Promise<unknown> {
  return JSON.parse(await readFile(join(hermesHome, 'run/itsaplan-managed/config.yaml'), 'utf8'));
}

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

    expect(result).toEqual({ revision: 'sha256:first', conflicts: [], mcpSecrets: null });
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
      mcp_servers: {
        'jev-browser': {
          command: 'npx',
          args: ['-y', '@jkudish/jev-browser'],
          env: { TYPESAFE_API_KEY: '${ITSAPLAN_MCP_SECRET_7}', JEV_BROWSER_MODEL: 'jev-latest' },
        },
        docs: {
          url: 'https://mcp.example.com/sse',
          transport: 'sse',
          headers: { Authorization: '${ITSAPLAN_MCP_SECRET_8}' },
        },
        'browser-harness': { enabled: false },
      },
    });
    const file = join(hermesHome, 'run/itsaplan-managed/config.yaml');
    expect((await lstat(file)).mode & 0o077).toBe(0);
  });

  it('removes the managed configuration once there is nothing to put in it', async () => {
    const { hermesHome, materializer } = await fixture({ toolsets: [], mcpServers: ['itsaplan'] });
    await materializer.apply(withServers('sha256:one', [jevBrowser]));
    const result = await materializer.apply(withServers('sha256:two', [], ['web']));

    expect(result.mcpSecrets).toBeNull();
    expect(await readdir(join(hermesHome, 'run/itsaplan-managed'))).toEqual([]);
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
    const { hermesHome, materializer } = await fixture();
    await mkdir(hermesHome, { recursive: true });
    await writeFile(join(hermesHome, 'SOUL.md'), '# Hermes default');
    const statuses: RuntimeStatus[] = [];
    let memory = '';
    const inventory = async (): Promise<HermesInventory> => ({
      toolsets: ['file', 'web'],
      mcpServers: ['itsaplan'],
      skills: [],
      memory: [{ file: 'MEMORY.md', content: memory, truncated: false }],
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
    const { materializer } = await fixture();
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

    expect(sync.toolsets()).toEqual(['file', 'terminal', 'web', 'itsaplan']);
    await sync.ensure();
    expect(sync.toolsets()).toEqual(['file', 'terminal', 'web', 'itsaplan']);
    await sync.ensure();
    expect(sync.toolsets()).toEqual(['file', 'web', 'itsaplan']);
  });

  it('hands each run the managed configuration and the current values of its secrets', async () => {
    const profile = { toolsets: ['file', 'web'], mcpServers: ['itsaplan'] };
    const { materializer } = await fixture(profile);
    const sync = new HermesPolicySynchronizer(
      client(
        [withServers('sha256:one', [jevBrowser], ['web']), withServers('sha256:two', [])],
        [],
        [{ '7': 'first-value' }, {}, { '7': 'x', '9': 'newer-value' }],
      ),
      materializer,
      { profile },
    );

    expect(await sync.runSettings()).toEqual({ toolsets: null, env: {} });
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
    expect(await sync.runSettings()).toEqual({ toolsets: null, env: {} });
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
