import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeMcpArgs, CliRuntimeAdapter, codexMcpArgs, codexOwnMcpServers } from '../cli-runtime';
import type { RunnerConfig } from '../config';
import { runtimeAdapter } from '../adapters';
import type { RuntimePolicyClient, RuntimePolicySnapshot, RuntimeStatus } from '../policy';
import { PRESETS, presetArgv } from '../presets';
import { withInstructions } from '../run';
import type { McpServerSpec } from '../runtime';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const helena: McpServerSpec = {
  name: 'itsaplan',
  transport: 'http',
  url: 'http://127.0.0.1:3000/mcp',
  headers: [{ name: 'Authorization', value: { template: 'Bearer ${ITSAPLAN_API_KEY}' } }],
};

const shop: McpServerSpec = {
  name: 'shopify-dev',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@shopify/dev-mcp'],
  env: [
    { name: 'SHOPIFY_TOKEN', value: { env: 'ITSAPLAN_MCP_SECRET_3' } },
    { name: 'MODE', value: { literal: 'read-only' } },
  ],
};

describe('MCP servers for Claude Code', () => {
  it("names Helena's servers only, with secrets as variables Claude Code expands", () => {
    const args = claudeMcpArgs([helena, shop]);
    expect(args[0]).toBe('--mcp-config');
    expect(JSON.parse(args[1]!)).toEqual({
      mcpServers: {
        itsaplan: {
          type: 'http',
          url: 'http://127.0.0.1:3000/mcp',
          headers: { Authorization: 'Bearer ${ITSAPLAN_API_KEY}' },
        },
        'shopify-dev': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@shopify/dev-mcp'],
          env: { SHOPIFY_TOKEN: '${ITSAPLAN_MCP_SECRET_3}', MODE: 'read-only' },
        },
      },
    });
    expect(args.slice(2)).toEqual([
      '--strict-mcp-config',
      '--allowedTools',
      'mcp__itsaplan',
      '--allowedTools',
      'mcp__shopify-dev',
    ]);
  });
});

describe('MCP servers for Codex', () => {
  it('passes each server as -c overrides and a secret through the environment', () => {
    const { args, env, drift } = codexMcpArgs(
      [helena, shop, { name: 'old-sse', transport: 'sse', url: 'https://x.example/sse' }],
      ['own-server', 'shopify-dev'],
      { ITSAPLAN_MCP_SECRET_3: 'shop-secret' },
    );
    const overrides = args.filter((_, index) => index % 2 === 1);
    expect(args.filter((_, index) => index % 2 === 0).every((flag) => flag === '-c')).toBe(true);
    expect(overrides).toEqual([
      'mcp_servers.itsaplan.url="http://127.0.0.1:3000/mcp"',
      'mcp_servers.itsaplan.bearer_token_env_var="ITSAPLAN_API_KEY"',
      'mcp_servers.itsaplan.enabled=true',
      'mcp_servers.shopify-dev.command="npx"',
      'mcp_servers.shopify-dev.args=["-y","@shopify/dev-mcp"]',
      'mcp_servers.shopify-dev.env={MODE="read-only"}',
      'mcp_servers.shopify-dev.env_vars=["SHOPIFY_TOKEN"]',
      'mcp_servers.shopify-dev.enabled=true',
      // A server of Codex' own configuration Helena does not give the agent.
      'mcp_servers.own-server.enabled=false',
    ]);
    // The secret is in the run's environment, never on the command line.
    expect(env).toEqual({ SHOPIFY_TOKEN: 'shop-secret' });
    expect(args.join(' ')).not.toContain('shop-secret');
    expect(drift).toEqual([{ key: 'mcp_servers.old-sse', code: 'mcp-unsupported' }]);
  });

  it("reads the servers of Codex' own config.toml by name", async () => {
    const root = await mkdtemp(join(tmpdir(), 'helena-codex-'));
    roots.push(root);
    await writeFile(
      join(root, 'config.toml'),
      [
        'model = "gpt-5.5"',
        '[mcp_servers.github]',
        'command = "gh-mcp"',
        '[mcp_servers."my-docs"]',
        'url = "https://docs.example/mcp"',
        '[mcp_servers.github.env]',
        'TOKEN = "x"',
        '',
      ].join('\n'),
    );
    expect((await codexOwnMcpServers(root)).sort()).toEqual(['github', 'my-docs']);
    expect(await codexOwnMcpServers(join(root, 'missing'))).toEqual([]);
  });
});

describe('model and reasoning for Claude Code and Codex', () => {
  it('passes the model and the reasoning Helena names', () => {
    const settings = { model: 'claude-opus-5', thinkingLevel: 'high' };
    expect(presetArgv(PRESETS.claude, null, 'ctx', [], 'task', settings)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--permission-mode',
      'auto',
      '--append-system-prompt',
      'ctx',
      '--model',
      'claude-opus-5',
      '--effort',
      'high',
    ]);
    expect(
      presetArgv(PRESETS.codex, 'thread-1', '', [], 'task', {
        model: 'gpt-6-sol',
        thinkingLevel: 'low',
      }),
    ).toEqual([
      'exec',
      'resume',
      'thread-1',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-m',
      'gpt-6-sol',
      '-c',
      'model_reasoning_effort="low"',
      '-',
    ]);
    // "Agent default": nothing is passed, the CLI uses its own.
    expect(presetArgv(PRESETS.codex, null, '', [], 'task', {})).toEqual([
      'exec',
      '--json',
      '-c',
      'sandbox_mode="workspace-write"',
      '-',
    ]);
  });

  it("puts the agent's instructions in front of a fresh session's context only", () => {
    expect(withInstructions('# Soul', 'run context', null)).toBe('# Soul\n\nrun context');
    expect(withInstructions('# Soul', '', null)).toBe('# Soul');
    expect(withInstructions('# Soul', 'run context', 'session-1')).toBe('run context');
    expect(withInstructions(undefined, 'run context', null)).toBe('run context');
  });
});

describe('the Claude Code and Codex adapter', () => {
  const soul = '# You are Coder VOL\nMarker HELENA-SOUL-7.';

  function snapshot(revision: string, skills: RuntimePolicySnapshot['skills']) {
    return {
      revision,
      runtimePolicy: { files: [{ kind: 'instructions' as const, path: 'SOUL.md', content: soul }] },
      skills,
      mcpServers: [
        {
          name: 'shopify-dev',
          transport: 'stdio' as const,
          command: 'npx',
          args: [],
          url: null,
          env: [{ name: 'SHOPIFY_TOKEN', secret: 3 }],
          headers: [],
        },
      ],
      actions: [{ id: 5, kind: 'rewrite-profile' as const }],
    } satisfies RuntimePolicySnapshot;
  }

  const skill = {
    id: 7,
    slug: 'plan-7',
    name: 'Release notes',
    description: 'Writes release notes',
    markdown: '---\nname: release-notes\ndescription: Writes release notes\n---\nBody',
    files: [{ path: 'refs/style.md', content: '# Style' }],
  };

  async function adapter(runtime: 'claude' | 'codex', snapshots: RuntimePolicySnapshot[]) {
    const root = await mkdtemp(join(tmpdir(), 'helena-cli-'));
    roots.push(root);
    const statuses: RuntimeStatus[] = [];
    let current = snapshots[0]!;
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => (current = snapshots.shift() ?? current),
      reportRuntimeStatus: async (status) => {
        statuses.push(structuredClone(status));
      },
      mcpSecrets: async () => ({ '3': 'shop-secret' }),
      webLogins: async () => [],
    };
    await mkdir(join(root, 'codex'), { recursive: true });
    const config = {
      name: '',
      url: 'http://127.0.0.1:3000',
      apiKey: 'itp_test_key_for_the_adapter',
      agent: runtime,
      args: [],
      env: { HELENA_RUNTIME_DIR: join(root, 'state'), CODEX_HOME: join(root, 'codex') },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      outputFormat: runtime === 'claude' ? 'claude-stream-json' : 'codex-jsonl',
      models: [],
    } satisfies RunnerConfig;
    return { root, statuses, config, runtime: new CliRuntimeAdapter(runtime, config, client) };
  }

  it('gives Claude Code the SOUL, a plugin with the skills and the MCP servers', async () => {
    const { runtime, statuses, root } = await adapter('claude', [snapshot('sha256:one', [skill])]);
    const settings = await runtime.runSettings({ runId: 1 });

    expect(settings.instructions).toBe(soul);
    expect(settings.env).toEqual({ ITSAPLAN_MCP_SECRET_3: 'shop-secret' });
    const plugin = settings.args![settings.args!.indexOf('--plugin-dir') + 1]!;
    expect(plugin.startsWith(join(root, 'state'))).toBe(true);
    expect(await readFile(join(plugin, 'skills/plan-7/SKILL.md'), 'utf8')).toContain('Body');
    expect(await readFile(join(plugin, 'skills/plan-7/refs/style.md'), 'utf8')).toBe('# Style');
    expect(
      JSON.parse(await readFile(join(plugin, '.claude-plugin/plugin.json'), 'utf8')).name,
    ).toBe('helena');
    const config = JSON.parse(settings.args![settings.args!.indexOf('--mcp-config') + 1]!);
    expect(Object.keys(config.mcpServers)).toEqual(['itsaplan', 'shopify-dev']);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      adapter: 'claude',
      status: 'online',
      appliedRevision: 'sha256:one',
      actions: [{ id: 5, error: null }],
      inventory: { mcpServers: ['itsaplan'], skills: [{ name: 'Release notes', origin: 'plan' }] },
      profile: { drift: [] },
    });
    expect(JSON.stringify(statuses)).not.toContain('shop-secret');
  });

  it('removes a skill Helena no longer gives the agent', async () => {
    const { runtime, config } = await adapter('claude', [
      snapshot('sha256:one', [skill]),
      snapshot('sha256:two', []),
    ]);
    const first = await runtime.runSettings();
    const plugin = first.args![first.args!.indexOf('--plugin-dir') + 1]!;
    runtime.inventoryChanged();
    await runtime.runSettings();
    expect(await readdir(join(plugin, 'skills'))).toEqual([]);
    expect(config.agent).toBe('claude');
  });

  it("gives Codex the SOUL with the skills' index and its MCP overrides", async () => {
    const { runtime, root } = await adapter('codex', [snapshot('sha256:one', [skill])]);
    await writeFile(
      join(root, 'codex', 'config.toml'),
      'model = "gpt-5.5"\nmodel_reasoning_effort = "medium"\n[mcp_servers.github]\ncommand = "gh"\n',
    );
    const settings = await runtime.runSettings({ messageId: 3 });

    expect(settings.instructions).toContain(soul);
    expect(settings.instructions).toContain('## Skills');
    expect(settings.instructions).toContain('- Release notes: Writes release notes (');
    expect(settings.instructions).toContain('skills/plan-7/SKILL.md)');
    expect(settings.args).toContain('mcp_servers.github.enabled=false');
    expect(settings.env).toEqual({
      ITSAPLAN_MCP_SECRET_3: 'shop-secret',
      SHOPIFY_TOKEN: 'shop-secret',
    });
    expect(runtime.defaults()).toEqual({ model: 'gpt-5.5', provider: null, reasoning: 'medium' });
  });

  it('serves Hermes, Claude Code and Codex through an adapter, and nothing else', () => {
    const client = {} as RuntimePolicyClient;
    const base = {
      name: '',
      url: 'http://x',
      apiKey: 'k',
      args: [],
      env: {},
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 1000,
      outputFormat: 'text' as const,
      models: [],
    };
    expect(runtimeAdapter({ ...base, agent: 'claude' }, client)?.runtime).toBe('claude');
    expect(runtimeAdapter({ ...base, agent: 'codex' }, client)?.runtime).toBe('codex');
    expect(runtimeAdapter({ ...base, agent: 'opencode' }, client)).toBeNull();
    expect(runtimeAdapter({ ...base, command: 'my-agent' }, client)).toBeNull();
  });
});
