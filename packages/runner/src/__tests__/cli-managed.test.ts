import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoginRefusalReader, loginEnv, type CliLogin, type CliLoginState } from '../cli-login';
import {
  CliRuntimeAdapter,
  codexSandbox,
  LoginStartGate,
  localLoginFrom,
  parseVersion,
  resetCodexSandboxProbe,
  signInCommand,
  type ShortCommand,
} from '../cli-runtime';
import { CLAUDE_TOOLS, CODEX_TOOLS, claudeToolArgs, codexToolArgs } from '../cli-tools';
import type { RunnerConfig } from '../config';
import { assertCodexSandbox, codexWithoutSandbox, execute } from '../execute';
import type { RuntimePolicyClient, RuntimePolicySnapshot, RuntimeStatus } from '../policy';
import { PRESETS } from '../presets';

const roots: string[] = [];
const servers: Server[] = [];
const savedIsolation = process.env.AGENT_ISOLATION;
const savedSocket = process.env.VOLITION_LAUNCHER_SOCKET;

afterEach(async () => {
  resetCodexSandboxProbe();
  for (const server of servers.splice(0)) server.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (savedIsolation === undefined) delete process.env.AGENT_ISOLATION;
  else process.env.AGENT_ISOLATION = savedIsolation;
  if (savedSocket === undefined) delete process.env.VOLITION_LAUNCHER_SOCKET;
  else process.env.VOLITION_LAUNCHER_SOCKET = savedSocket;
});

function frame(kind: number, payload: string): Buffer {
  const body = Buffer.from(payload);
  const head = Buffer.alloc(5);
  head.writeUInt8(kind, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

// A stand-in for the agent launcher: records each request with its stdin and answers it with
// what `answer` prints for that runtime.
async function fakeLauncher(answer: (request: Record<string, unknown>, stdin: string) => string) {
  const dir = await mkdtemp(join(tmpdir(), 'helena-launcher-'));
  roots.push(dir);
  const path = join(dir, 'launch.sock');
  const requests: { request: Record<string, unknown>; stdin: string }[] = [];
  const server = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let request: Record<string, unknown> | null = null;
    let stdin = '';
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!request) {
        const end = buffered.indexOf(10);
        if (end < 0) return;
        request = JSON.parse(buffered.subarray(0, end).toString()) as Record<string, unknown>;
        buffered = buffered.subarray(end + 1);
        socket.write(frame(0x10, JSON.stringify({ unit: 'volition-agent-test.service' })));
      }
      while (buffered.length >= 5) {
        const kind = buffered.readUInt8(0);
        const length = buffered.readUInt32BE(1);
        if (buffered.length < 5 + length) break;
        const payload = buffered.subarray(5, 5 + length).toString();
        buffered = buffered.subarray(5 + length);
        if (kind === 0x01) stdin += payload;
        if (kind === 0x02) {
          requests.push({ request, stdin });
          socket.write(frame(0x11, answer(request, stdin)));
          socket.end(frame(0x13, JSON.stringify({ code: 0 })));
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { path, requests };
}

const SOUL = '# You are Coder VOL';
const TOKEN = 'sk-ant-oat01-the-owners-setup-token';

function snapshot(toolDeny: string[] = []): RuntimePolicySnapshot {
  return {
    revision: `sha256:${toolDeny.join(',') || 'none'}`,
    runtimePolicy: {
      files: [{ kind: 'instructions', path: 'SOUL.md', content: SOUL }],
      toolDeny,
    },
    skills: [
      {
        id: 7,
        slug: 'plan-7',
        name: 'Release notes',
        description: 'Writes release notes',
        markdown: '---\nname: release-notes\n---\nBody',
        files: [],
      },
    ],
  };
}

// An agent the deployment provisioned: a home of its own, as the catalog script writes it.
async function managed(
  runtime: 'claude' | 'codex',
  options: {
    grant?: CliLogin | null;
    localLogin?: boolean;
    missing?: boolean;
    // Whether Codex' own sandbox starts (`codex sandbox -- true`).
    ownSandbox?: boolean;
    toolDeny?: string[];
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'helena-agent-home-'));
  roots.push(home);
  const statuses: RuntimeStatus[] = [];
  const asked: { work: unknown }[] = [];
  const grant = options.grant ?? null;
  const client: RuntimePolicyClient = {
    runtimePolicy: async () => snapshot(options.toolDeny),
    reportRuntimeStatus: async (status) => {
      statuses.push(structuredClone(status));
    },
    mcpSecrets: async () => ({}),
    webLogins: async () => [],
    runtimeLogin: async (work) => {
      asked.push({ work });
      if (!grant) return null;
      if (work) return grant;
      const { value: _value, ...state } = grant;
      return state satisfies CliLoginState;
    },
  };
  const probes: string[][] = [];
  const program: ShortCommand = async (bin, args) => {
    probes.push([bin, ...args]);
    if (options.missing) return { code: null, stdout: '', missing: true };
    if (args[0] === 'sandbox') {
      return { code: options.ownSandbox ? 0 : 1, stdout: '', missing: false };
    }
    if (args[0] === '--version') {
      return {
        code: 0,
        stdout: runtime === 'claude' ? '2.1.281 (Claude Code)' : 'codex-cli 0.156.1',
        missing: false,
      };
    }
    const loggedIn = options.localLogin === true;
    if (args[0] === 'logout' || args[1] === 'logout') {
      options.localLogin = false;
      return { code: 0, stdout: '', missing: false };
    }
    return runtime === 'claude'
      ? { code: loggedIn ? 0 : 1, stdout: JSON.stringify({ loggedIn }), missing: false }
      : {
          code: loggedIn ? 0 : 1,
          stdout: loggedIn ? 'Logged in' : 'Not logged in',
          missing: false,
        };
  };
  const config: RunnerConfig = {
    name: 'coder-vol',
    url: 'http://127.0.0.1:3000',
    apiKey: 'itp_test_key_for_the_managed_adapter',
    agent: runtime,
    args: [],
    cwd: home,
    env: {
      HELENA_AGENT_HOME: home,
      ...(runtime === 'claude'
        ? { CLAUDE_CONFIG_DIR: join(home, '.claude') }
        : { CODEX_HOME: join(home, '.codex') }),
    },
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutMs: 60_000,
    outputFormat: runtime === 'claude' ? 'claude-stream-json' : 'codex-jsonl',
    models: [],
  };
  // Codex' app-server, as `account/read` answers for the login the options name.
  const appServer = async (method: string) => {
    probes.push(['codex', 'app-server', method]);
    return {
      account: options.localLogin
        ? { type: 'chatgpt', email: 'owner@example.com', planType: 'pro' }
        : null,
      requiresOpenaiAuth: true,
    };
  };
  const adapter = new CliRuntimeAdapter(runtime, config, client, Date.now, program, appServer);
  return { home, statuses, asked, probes, config, adapter, program };
}

describe('a Claude Code agent Helena provisioned', () => {
  it('keeps its skills and its runtime state in its own home', async () => {
    const { adapter, home } = await managed('claude', { localLogin: true });
    const settings = await adapter.runSettings({ runId: 4 });
    const plugin = settings.args![settings.args!.indexOf('--plugin-dir') + 1]!;
    expect(plugin).toBe(join(home, '.helena'));
    expect(await readFile(join(plugin, 'skills/plan-7/SKILL.md'), 'utf8')).toContain('Body');
    expect(settings.env.CLAUDE_CONFIG_DIR).toBe(join(home, '.claude'));
    expect(settings.env.DISABLE_AUTOUPDATER).toBe('1');
    expect((await stat(join(home, '.claude'))).isDirectory()).toBe(true);
  });

  it('hands a granted login to the one command, in its environment only', async () => {
    const grant: CliLogin = {
      credentialId: 9,
      runtime: 'claude',
      method: 'oauth_token',
      value: TOKEN,
    };
    const { adapter, asked, statuses } = await managed('claude', { grant });
    const settings = await adapter.runSettings({ runId: 4 });
    expect(settings.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(TOKEN);
    // Every other login variable is emptied, so none of the runner's own reaches the agent.
    expect(settings.env.ANTHROPIC_API_KEY).toBe('');
    expect(settings.env.CODEX_API_KEY).toBe('');
    expect(settings.args!.join(' ')).not.toContain(TOKEN);
    expect(asked.at(-1)).toEqual({ work: { runId: 4 } });
    // The status says a login is granted, never what it is.
    expect(JSON.stringify(statuses)).not.toContain(TOKEN);
    expect(statuses.at(-1)?.issues).toEqual([]);
    expect(statuses.at(-1)?.status).toBe('online');
  });

  it('takes an API key as ANTHROPIC_API_KEY', () => {
    const env = loginEnv(
      'claude',
      { credentialId: 1, runtime: 'claude', method: 'api_key', value: 'sk-ant-api' },
      true,
    );
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-api');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('');
    // An operator's own runner keeps its shell's variables.
    expect(loginEnv('claude', null, false)).toEqual({});
  });

  it('says "not signed in" without a granted login or one of its own', async () => {
    const { adapter, statuses } = await managed('claude', { localLogin: false });
    await adapter.ensure();
    expect(statuses.at(-1)).toMatchObject({
      status: 'degraded',
      version: '2.1.281',
      issues: [{ code: 'not-signed-in', detail: 'missing' }],
    });
  });

  it('counts a login of its own in its home', async () => {
    const { adapter, statuses } = await managed('claude', { localLogin: true });
    await adapter.ensure();
    expect(statuses.at(-1)).toMatchObject({ status: 'online', issues: [] });
  });

  it('says the runtime is missing when its program is not installed', async () => {
    const { adapter, statuses } = await managed('claude', { missing: true });
    await adapter.ensure();
    expect(statuses.at(-1)).toMatchObject({
      status: 'degraded',
      version: null,
      issues: [{ code: 'runtime-missing', detail: 'claude' }],
    });
  });

  it("reports a login the runtime's service refused until a command gets through", async () => {
    const grant: CliLogin = {
      credentialId: 9,
      runtime: 'claude',
      method: 'oauth_token',
      value: TOKEN,
    };
    const { adapter, statuses } = await managed('claude', { grant });
    const failed = await adapter.runSettings({ runId: 5 });
    failed.hooks!.output!(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in"}]},"error":"authentication_failed","is_api_error_message":true}\n',
    );
    failed.hooks!.finished!({ status: 'failed', error: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statuses.at(-1)?.issues).toEqual([
      { code: 'not-signed-in', detail: 'rejected', command: 'claude setup-token' },
    ]);

    const ok = await adapter.runSettings({ runId: 6 });
    ok.hooks!.output!('{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}\n');
    ok.hooks!.finished!({ status: 'success' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statuses.at(-1)?.issues).toEqual([]);
  });

  it('withholds its scheduler and turns off the tools the owner turned off', async () => {
    const { adapter, statuses } = await managed('claude', {
      localLogin: true,
      toolDeny: ['Bash', 'unknown'],
    });
    const settings = await adapter.runSettings();
    const off = settings.args!.filter((_, index, all) => all[index - 1] === '--disallowedTools');
    expect(off).toEqual(
      expect.arrayContaining(['CronCreate', 'CronList', 'ScheduleWakeup', 'Bash']),
    );
    expect(off).not.toContain('unknown');
    expect(off).not.toContain('Read');
    expect(statuses.at(-1)?.inventory?.toolsets).toEqual([...CLAUDE_TOOLS]);
  });
});

describe('an isolated Claude Code agent', () => {
  it("writes its skills and asks for its login through the agent's own unit", async () => {
    const { path, requests } = await fakeLauncher((request) =>
      request.runtime === 'profile-helper'
        ? `${JSON.stringify({ ok: true, result: { written: 2 } })}\n`
        : JSON.stringify({ loggedIn: false }),
    );
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    // The home is the project user's: the runner never opens it, so it need not exist here.
    const home = '/var/lib/volition/hermes/profiles/alpha_21';
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => snapshot(),
      reportRuntimeStatus: async (status) => {
        statuses.push(structuredClone(status));
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
      runtimeLogin: async () => null,
    };
    const config: RunnerConfig = {
      name: '',
      url: 'http://127.0.0.1:3000',
      apiKey: 'itp_isolated_key',
      agent: 'claude',
      args: [],
      cwd: '/srv/volition/workspaces/projects/alpha',
      env: { HELENA_AGENT_HOME: home, CLAUDE_CONFIG_DIR: `${home}/.claude` },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      outputFormat: 'claude-stream-json',
      models: [],
      isolation: { slug: 'alpha', profile: 'alpha_21', agentId: 21 },
    };
    const program: ShortCommand = async () => ({
      code: 0,
      stdout: '2.1.281 (Claude Code)',
      missing: false,
    });
    const adapter = new CliRuntimeAdapter('claude', config, client, Date.now, program);

    const settings = await adapter.runSettings();
    const helper = requests.find((entry) => entry.request.runtime === 'profile-helper')!;
    expect(helper.request).toMatchObject({ slug: 'alpha', profile: 'alpha_21', agentId: 21 });
    expect(JSON.parse(helper.stdin)).toMatchObject({ op: 'cli-files', runtime: 'claude' });
    const login = requests.find((entry) => entry.request.runtime === 'claude')!;
    expect(login.request).toMatchObject({
      args: ['auth', 'status'],
      env: { CLAUDE_CONFIG_DIR: `${home}/.claude` },
      work: { kind: 'helper', id: null },
    });
    expect(statuses.at(-1)?.issues).toEqual([
      { code: 'not-signed-in', detail: 'missing', command: 'claude setup-token' },
    ]);
    expect(settings.args![settings.args!.indexOf('--plugin-dir') + 1]).toBe(`${home}/.helena`);

    // Unchanged skills are not written again: each write starts a unit.
    adapter.inventoryChanged();
    await adapter.ensure();
    expect(
      requests.filter(
        (entry) =>
          entry.request.runtime === 'profile-helper' &&
          (JSON.parse(entry.stdin) as { op?: string }).op === 'cli-files',
      ),
    ).toHaveLength(1);
  });
});

describe('a Codex agent Helena provisioned', () => {
  it("runs in its own sandbox's working folder outside isolation, where that sandbox starts", async () => {
    delete process.env.AGENT_ISOLATION;
    const { adapter, statuses, probes } = await managed('codex', {
      localLogin: true,
      ownSandbox: true,
    });
    const settings = await adapter.runSettings({ runId: 3 });
    expect(settings.hooks?.sandbox).toBe('workspace-write');
    expect(statuses.at(-1)).toMatchObject({
      status: 'online',
      issues: [],
      sandbox: 'workspace-write',
    });
    // Its commands can read the skills' files, so it gets their paths.
    expect(settings.instructions).toContain('SKILL.md)');
    // Probed as the runner's user, with a command in the sandbox.
    expect(probes).toContainEqual([
      'codex',
      'sandbox',
      '-c',
      'sandbox_mode="workspace-write"',
      '--',
      'true',
    ]);
  });

  it("probes Codex' sandbox once per runner, for all its Codex agents", async () => {
    delete process.env.AGENT_ISOLATION;
    const first = await managed('codex', { localLogin: true, ownSandbox: true });
    const second = await managed('codex', { localLogin: true, ownSandbox: false });
    await first.adapter.ensure();
    await second.adapter.ensure();
    first.adapter.inventoryChanged();
    await first.adapter.ensure();
    const sandboxProbes = [...first.probes, ...second.probes].filter((p) => p[1] === 'sandbox');
    expect(sandboxProbes).toHaveLength(1);
    // The one answer holds for both.
    expect(second.adapter.sandbox()).toBe('workspace-write');
  });

  it('runs read-only where its own sandbox does not start, and says why', async () => {
    delete process.env.AGENT_ISOLATION;
    const { adapter, statuses, home } = await managed('codex', {
      localLogin: true,
      ownSandbox: false,
    });
    const settings = await adapter.runSettings({ messageId: 3 });
    expect(settings.hooks?.sandbox).toBe('read-only');
    expect(settings.args).toContain('--ignore-user-config');
    expect(settings.args).toContain('--skip-git-repo-check');
    expect(settings.env.CODEX_HOME).toBe(join(home, '.codex'));
    // Codex does not start without its home.
    expect((await stat(join(home, '.codex'))).isDirectory()).toBe(true);
    expect(statuses.at(-1)).toMatchObject({
      status: 'degraded',
      version: '0.156.1',
      issues: [{ code: 'sandbox-unavailable', detail: 'read-only' }],
      sandbox: 'read-only',
    });
    // It cannot read a SKILL.md without a shell, so it gets the skills' text.
    expect(settings.instructions).toContain('### Release notes');
    expect(settings.instructions).toContain('Body');
    expect(settings.instructions).not.toContain('SKILL.md)');
  });

  it('runs without its sandbox only inside agent isolation', () => {
    const agent = { env: { HELENA_AGENT_HOME: '/var/lib/volition/hermes/profiles/vol_12' } };
    const isolation = { slug: 'vol', profile: 'vol_12', agentId: 12 };
    delete process.env.AGENT_ISOLATION;
    // Outside isolation: its own sandbox where it starts, read-only where it does not or
    // before it was probed; never none.
    expect(codexSandbox(agent, true)).toBe('workspace-write');
    expect(codexSandbox(agent, false)).toBe('read-only');
    expect(codexSandbox(agent)).toBe('read-only');
    expect(codexSandbox({ ...agent, isolation }, true)).toBe('workspace-write');
    // An operator's own runner, on a machine where Codex' sandbox works.
    expect(codexSandbox({ env: {} })).toBe('workspace-write');
    process.env.AGENT_ISOLATION = 'on';
    expect(codexSandbox({ ...agent, isolation })).toBe('danger-full-access');
    expect(codexSandbox({ ...agent, isolation }, false)).toBe('danger-full-access');
  });

  it('takes an API key as CODEX_API_KEY and needs no start gate for it', async () => {
    const grant: CliLogin = {
      credentialId: 2,
      runtime: 'codex',
      method: 'api_key',
      value: 'sk-proj-x',
    };
    const { adapter } = await managed('codex', { grant });
    const settings = await adapter.runSettings({ runId: 1 });
    expect(settings.env.CODEX_API_KEY).toBe('sk-proj-x');
    expect(settings.env.OPENAI_API_KEY).toBe('');
    expect(settings.hooks?.startGate).toBeUndefined();
    // An OAuth token is no Codex login: its ChatGPT login lives in the agent's home.
    expect(
      loginEnv(
        'codex',
        { credentialId: 3, runtime: 'codex', method: 'oauth_token', value: 'x' },
        true,
      ).CODEX_API_KEY,
    ).toBe('');
  });

  it('serializes the starts of commands that share its login file', async () => {
    const { adapter } = await managed('codex', { localLogin: true });
    const settings = await adapter.runSettings({ runId: 1 });
    expect(settings.hooks?.startGate).toBeInstanceOf(LoginStartGate);
  });

  it('turns off the features no agent gets, and the ones the owner turned off', async () => {
    const { adapter, statuses } = await managed('codex', {
      localLogin: true,
      toolDeny: ['web_search', 'shell_tool'],
    });
    const settings = await adapter.runSettings();
    const overrides = settings.args!.filter((_, index, all) => all[index - 1] === '-c');
    expect(overrides).toEqual(
      expect.arrayContaining([
        'features.apps=false',
        'features.plugins=false',
        'features.browser_use=false',
        'features.computer_use=false',
        'features.shell_tool=false',
        'web_search="disabled"',
      ]),
    );
    expect(overrides).not.toContain('features.view_image=false');
    expect(statuses.at(-1)?.inventory?.toolsets).toEqual([...CODEX_TOOLS]);
  });
});

describe("Codex' sandbox", () => {
  const codex = PRESETS.codex;

  it('recognizes every way to run Codex without its sandbox', () => {
    expect(codexWithoutSandbox(['exec', '-c', 'sandbox_mode="danger-full-access"'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '-c', 'sandbox_mode=danger-full-access'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '--dangerously-bypass-approvals-and-sandbox'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '--sandbox', 'danger-full-access'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '-s', 'danger-full-access'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '--config=sandbox_mode="danger-full-access"'])).toBe(true);
    expect(codexWithoutSandbox(['exec', '-c', 'sandbox_mode="read-only"'])).toBe(false);
    expect(codexWithoutSandbox(['exec', '-c', 'model="danger-full-access"'])).toBe(false);
  });

  it('refuses such a command outside agent isolation, whoever asked for it', () => {
    delete process.env.AGENT_ISOLATION;
    const argv = ['exec', '--json', '-c', 'sandbox_mode="danger-full-access"', '-'];
    expect(() => assertCodexSandbox({}, codex, argv)).toThrow(/agent isolation/);
    expect(() =>
      assertCodexSandbox({ isolation: { slug: 'vol', profile: 'vol_1', agentId: 1 } }, codex, argv),
    ).toThrow(/agent isolation/);
    process.env.AGENT_ISOLATION = 'on';
    expect(() => assertCodexSandbox({}, codex, argv)).toThrow(/agent isolation/);
    expect(() =>
      assertCodexSandbox({ isolation: { slug: 'vol', profile: 'vol_1', agentId: 1 } }, codex, argv),
    ).not.toThrow();
    // Only Codex: Hermes' own terminal runs in the unit either way.
    expect(() => assertCodexSandbox({}, PRESETS.hermes, argv)).not.toThrow();
  });

  it('stops a Codex run the operator configured without a sandbox before it starts', async () => {
    delete process.env.AGENT_ISOLATION;
    const dir = await mkdtemp(join(tmpdir(), 'helena-codex-refuse-'));
    roots.push(dir);
    const config: RunnerConfig = {
      name: '',
      url: 'http://127.0.0.1:1',
      apiKey: 'k',
      agent: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox'],
      cwd: dir,
      env: {},
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      outputFormat: 'codex-jsonl',
      models: [],
    };
    await expect(
      execute(config, { prompt: 'hi', systemPrompt: '', env: {}, hooks: { sandbox: 'read-only' } }),
    ).rejects.toThrow(/agent isolation/);
  });

  it("puts Helena's sandbox after the operator's arguments", () => {
    const argv = [
      ...codex.head(null),
      '-c',
      'sandbox_mode="workspace-write"',
      ...(codex.taskArgs?.({ sandbox: 'read-only' }) ?? []),
    ];
    expect(argv.lastIndexOf('sandbox_mode="read-only"')).toBeGreaterThan(
      argv.indexOf('sandbox_mode="workspace-write"'),
    );
  });
});

describe('logins', () => {
  it("reads Claude Code's refusal of a login", () => {
    const reader = new LoginRefusalReader('claude');
    reader.write('{"type":"system","subtype":"init","apiKeySource":"none"}\n');
    reader.write(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Not logged in · Please run /login"}]},"error":"authentication_failed","is_api_error_message":true}\n',
    );
    reader.end();
    expect(reader.refused()).toBe(true);
  });

  it("reads Codex' 401 and forgets one it recovered from", () => {
    const refused = new LoginRefusalReader('codex');
    refused.write(
      '{"type":"error","message":"Reconnecting... 1/5 (unexpected status 401 Unauthorized: Missing bearer)"}\n',
    );
    refused.end();
    expect(refused.refused()).toBe(true);

    const recovered = new LoginRefusalReader('codex');
    recovered.write('{"type":"error","message":"unexpected status 401 Unauthorized"}\n');
    recovered.write('{"type":"item.completed","item":{"type":"agent_message","text":"done"}}');
    recovered.end();
    expect(recovered.refused()).toBe(false);
  });

  it("tells the login state from each runtime's own status command", () => {
    expect(
      localLoginFrom('claude', { code: 1, stdout: '{"loggedIn":false}', missing: false }),
    ).toBe(false);
    expect(localLoginFrom('claude', { code: 0, stdout: '{"loggedIn":true}', missing: false })).toBe(
      true,
    );
    expect(localLoginFrom('codex', { code: 1, stdout: 'Not logged in', missing: false })).toBe(
      false,
    );
    expect(
      localLoginFrom('codex', { code: 0, stdout: 'Logged in using ChatGPT', missing: false }),
    ).toBe(true);
    expect(localLoginFrom('codex', { code: null, stdout: '', missing: true })).toBeNull();
    expect(parseVersion('2.1.281 (Claude Code)')).toBe('2.1.281');
    expect(parseVersion('codex-cli 0.156.1')).toBe('0.156.1');
  });
});

describe("the owner's sign-in command", () => {
  it('names the command that signs the runtime in, as the user the agent runs as', () => {
    const home = '/var/lib/volition/hermes/profiles/vol_12';
    const cwd = '/srv/volition/workspaces/projects/vol';
    const agent = { env: { HELENA_AGENT_HOME: home, CODEX_HOME: `${home}/.codex` }, cwd };
    expect(signInCommand('claude', agent)).toBe('claude setup-token');
    delete process.env.AGENT_ISOLATION;
    expect(signInCommand('codex', agent)).toBe(
      `sudo -u volition-hermes env HOME=${home} CODEX_HOME=${home}/.codex /usr/local/bin/codex login --device-auth`,
    );
    process.env.AGENT_ISOLATION = 'on';
    expect(
      signInCommand('codex', {
        ...agent,
        isolation: { slug: 'vol', profile: 'vol_12', agentId: 12 },
      }),
    ).toBe(
      'sudo -u volition-hermes /usr/bin/python3 -I /usr/local/lib/volition-isolation/launch_client.py ' +
        `run --slug vol --profile vol_12 --runtime codex --kind helper --cwd ${cwd} ` +
        `--env CODEX_HOME=${home}/.codex -- login --device-auth`,
    );
    // An operator's own runner signs in the operator's own Codex.
    expect(signInCommand('codex', { env: {} })).toBe('codex login --device-auth');
  });
});

describe('the start gate of a login file', () => {
  it('lets the next command start once the first one got its first answer', async () => {
    const gate = new LoginStartGate();
    const dir = await mkdtemp(join(tmpdir(), 'helena-gate-'));
    roots.push(dir);
    const config = (command: string): RunnerConfig => ({
      name: '',
      url: 'http://127.0.0.1:1',
      apiKey: 'k',
      command,
      args: [],
      cwd: dir,
      env: {},
      concurrency: 2,
      pollIntervalMs: 1000,
      timeoutMs: 10_000,
      outputFormat: 'text',
      models: [],
    });
    const order: string[] = [];
    const first = execute(
      config(
        `echo start-a >> ${dir}/log; sleep 0.3; echo '{"type":"item.started"}'; sleep 0.5; echo end-a >> ${dir}/log`,
      ),
      { prompt: '', systemPrompt: '', env: {}, hooks: { startGate: gate } },
    ).then(() => order.push('a'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = execute(config(`echo start-b >> ${dir}/log`), {
      prompt: '',
      systemPrompt: '',
      env: {},
      hooks: { startGate: gate },
    }).then(() => order.push('b'));
    await Promise.all([first, second]);
    // b started after a's first answer, and before a ended.
    expect((await readFile(join(dir, 'log'), 'utf8')).trim().split('\n')).toEqual([
      'start-a',
      'start-b',
      'end-a',
    ]);
    expect(order).toEqual(['b', 'a']);
  });
});

describe('tool arguments', () => {
  it("withholds Claude Code's scheduler from every agent", () => {
    expect(claudeToolArgs([])).toContain('CronCreate');
    expect(codexToolArgs([])).toContain('features.apps=false');
  });
});

// The token-like values a login file holds; none may ever leave the runner.
const TOKEN_LIKE =
  /eyJ[A-Za-z0-9_-]{10,}|\brt_[A-Za-z0-9_]{6,}|\bsk-[A-Za-z0-9-]{6,}|refresh_token|access_token|id_token/;

describe("the runtime's own login (Zugänge)", () => {
  it('reports what Codex says about its account, with the command that signs it in', async () => {
    delete process.env.AGENT_ISOLATION;
    const { adapter, statuses, home, probes } = await managed('codex', {
      localLogin: true,
      ownSandbox: true,
    });
    await adapter.ensure();
    const status = statuses.at(-1)!;
    expect(status.account).toMatchObject({
      signedIn: true,
      method: 'chatgpt',
      email: 'owner@example.com',
      plan: 'pro',
      command: `sudo -u volition-hermes env HOME=${home} CODEX_HOME=${home}/.codex /usr/local/bin/codex login --device-auth`,
    });
    expect(status.capabilities).toEqual(expect.arrayContaining(['login', 'logout']));
    // Asked Codex itself, never its file.
    expect(probes).toContainEqual(['codex', 'app-server', 'account/read']);
    expect(JSON.stringify(status)).not.toMatch(TOKEN_LIKE);
  });

  it("takes the login file's time as the last renewal, never its content", async () => {
    delete process.env.AGENT_ISOLATION;
    const { adapter, home } = await managed('codex', { localLogin: true, ownSandbox: true });
    await adapter.ensure();
    await writeFile(
      join(home, '.codex', 'auth.json'),
      JSON.stringify({ tokens: { refresh_token: 'rt_secret_value', id_token: 'eyJabc.def.ghi' } }),
    );
    const when = new Date('2026-09-25T08:00:00.000Z');
    await utimes(join(home, '.codex', 'auth.json'), when, when);
    const account = await adapter.account({ force: true });
    expect(account?.refreshedAt).toBe(when.toISOString());
    expect(JSON.stringify(account)).not.toMatch(TOKEN_LIKE);
  });

  it('signs its own login out with its own command, and looks again', async () => {
    delete process.env.AGENT_ISOLATION;
    const { adapter, statuses, probes } = await managed('codex', {
      localLogin: true,
      ownSandbox: true,
    });
    await adapter.ensure();
    const account = await adapter.signOut();
    expect(probes).toContainEqual(['codex', 'logout']);
    expect(account).toMatchObject({ signedIn: false, email: null, plan: null });
    expect(statuses.at(-1)).toMatchObject({
      issues: [{ code: 'not-signed-in', detail: 'missing' }],
      account: { signedIn: false },
    });
  });

  it("offers no sign-out on an operator's own runner", async () => {
    delete process.env.AGENT_ISOLATION;
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => snapshot(),
      reportRuntimeStatus: async (status) => {
        statuses.push(structuredClone(status));
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
    };
    const dir = await mkdtemp(join(tmpdir(), 'helena-operator-'));
    roots.push(dir);
    const config: RunnerConfig = {
      name: '',
      url: 'http://127.0.0.1:3000',
      apiKey: 'itp_operator_key',
      agent: 'claude',
      args: [],
      cwd: dir,
      // Its user's own Claude Code directory; here a folder of the test's.
      env: { HELENA_RUNTIME_DIR: dir, CLAUDE_CONFIG_DIR: dir },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      outputFormat: 'claude-stream-json',
      models: [],
    };
    const program: ShortCommand = async (_bin, args) =>
      args[0] === '--version'
        ? { code: 0, stdout: '2.1.282 (Claude Code)', missing: false }
        : {
            code: 0,
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: 'claude.ai',
              email: 'op@example.com',
              subscriptionType: 'max',
            }),
            missing: false,
          };
    const adapter = new CliRuntimeAdapter('claude', config, client, Date.now, program);
    await adapter.ensure();
    expect(statuses.at(-1)?.capabilities).toContain('login');
    expect(statuses.at(-1)?.capabilities).not.toContain('logout');
    expect(statuses.at(-1)?.account).toMatchObject({
      signedIn: true,
      method: 'claude.ai',
      email: 'op@example.com',
      plan: 'max',
    });
    await expect(adapter.signOut()).rejects.toThrow(/operator/);
  });

  it("reads an isolated agent's login in its own unit, and signs it out there", async () => {
    const { path, requests } = await fakeLauncher((request, stdin) => {
      if (request.runtime === 'profile-helper') {
        const op = JSON.parse(stdin) as { op: string; request?: { op: string } };
        if (op.op === 'runtime-request' && op.request?.op === 'login.read') {
          return `${JSON.stringify({
            ok: true,
            result: {
              account: {
                signedIn: true,
                method: 'chatgpt',
                email: 'owner@example.com',
                plan: 'pro',
                organization: null,
                refreshedAt: '2026-09-25T08:00:00.000Z',
                checkedAt: '2026-09-25T10:00:00.000Z',
                command: null,
                // Whatever else a helper sent is dropped.
                refresh_token: 'rt_should_never_leave',
              },
            },
          })}\n`;
        }
        return `${JSON.stringify({ ok: true, result: { written: 1 } })}\n`;
      }
      return '';
    });
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    const home = '/var/lib/volition/hermes/profiles/vol_33';
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => snapshot(),
      reportRuntimeStatus: async (status) => {
        statuses.push(structuredClone(status));
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
      runtimeLogin: async () => null,
    };
    const config: RunnerConfig = {
      name: '',
      url: 'http://127.0.0.1:3000',
      apiKey: 'itp_isolated_codex_key',
      agent: 'codex',
      args: [],
      cwd: '/srv/volition/workspaces/projects/vol',
      env: { HELENA_AGENT_HOME: home, CODEX_HOME: `${home}/.codex` },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      outputFormat: 'codex-jsonl',
      models: [],
      isolation: { slug: 'vol', profile: 'vol_33', agentId: 33, runtime: 'codex' },
    };
    const program: ShortCommand = async () => ({
      code: 0,
      stdout: 'codex-cli 0.156.1',
      missing: false,
    });
    const adapter = new CliRuntimeAdapter('codex', config, client, Date.now, program);
    await adapter.ensure();
    const read = requests.find(
      (entry) =>
        entry.request.runtime === 'profile-helper' &&
        (JSON.parse(entry.stdin) as { op: string }).op === 'runtime-request',
    )!;
    expect(read.request).toMatchObject({ slug: 'vol', profile: 'vol_33', agentId: 33 });
    expect(JSON.parse(read.stdin)).toMatchObject({
      op: 'runtime-request',
      request: { op: 'login.read' },
      runtime: 'codex',
    });
    expect(statuses.at(-1)?.account).toMatchObject({
      signedIn: true,
      email: 'owner@example.com',
      plan: 'pro',
    });
    expect(statuses.at(-1)?.account?.command).toContain('launch_client.py');
    expect(JSON.stringify(statuses)).not.toContain('rt_should_never_leave');

    await adapter.signOut();
    const logout = requests.find(
      (entry) =>
        entry.request.runtime === 'codex' && (entry.request.args as string[])[0] === 'logout',
    )!;
    expect(logout.request).toMatchObject({
      slug: 'vol',
      profile: 'vol_33',
      args: ['logout'],
      env: { CODEX_HOME: `${home}/.codex` },
      work: { kind: 'helper', id: null },
    });
  });
});
