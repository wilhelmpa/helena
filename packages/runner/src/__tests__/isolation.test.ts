import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerConfig } from '../config';
import { loadConfig } from '../config';
import { claudeMcpArgs } from '../cli-runtime';
import { execute } from '../execute';
import { isolatedEnv, launch, LaunchError, profileHelper } from '../isolation';
import { IsolatedProfile } from '../policy';

// A stand-in for volition-agent-launcher: it records the request line and the frames it gets
// and answers the way the test tells it to.
interface Seen {
  request: Record<string, unknown> | null;
  stdin: string;
  eof: boolean;
  closed: boolean;
}

type Answer = (socket: Socket, seen: Seen) => void;

function frame(kind: number, payload: string | Buffer): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload) : payload;
  const head = Buffer.alloc(5);
  head.writeUInt8(kind, 0);
  head.writeUInt32BE(body.length, 1);
  return Buffer.concat([head, body]);
}

const dirs: string[] = [];
const servers: Server[] = [];
const saved = process.env.AGENT_ISOLATION;

async function fakeLauncher(answer: Answer): Promise<{ path: string; seen: Seen }> {
  const dir = await mkdtemp(join(tmpdir(), 'itsaplan-launcher-'));
  dirs.push(dir);
  const path = join(dir, 'launch.sock');
  const seen: Seen = { request: null, stdin: '', eof: false, closed: false };
  const server = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    let headerDone = false;
    socket.on('close', () => {
      seen.closed = true;
    });
    socket.on('data', (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (!headerDone) {
        const end = buffered.indexOf(10);
        if (end < 0) return;
        seen.request = JSON.parse(buffered.subarray(0, end).toString()) as Record<string, unknown>;
        buffered = buffered.subarray(end + 1);
        headerDone = true;
        socket.write(
          frame(
            0x10,
            JSON.stringify({ unit: 'volition-agent-alpha--a7-r12-abcdef012345.service' }),
          ),
        );
      }
      while (buffered.length >= 5) {
        const kind = buffered.readUInt8(0);
        const length = buffered.readUInt32BE(1);
        if (buffered.length < 5 + length) break;
        const payload = buffered.subarray(5, 5 + length);
        buffered = buffered.subarray(5 + length);
        if (kind === 0x01) seen.stdin += payload.toString();
        if (kind === 0x02) {
          seen.eof = true;
          answer(socket, seen);
        }
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(path, resolve));
  return { path, seen };
}

beforeEach(() => {
  delete process.env.AGENT_ISOLATION;
});

afterEach(async () => {
  if (saved === undefined) delete process.env.AGENT_ISOLATION;
  else process.env.AGENT_ISOLATION = saved;
  delete process.env.VOLITION_LAUNCHER_SOCKET;
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const request = {
  slug: 'alpha',
  profile: 'alpha_7',
  runtime: 'hermes',
  args: ['chat'],
  env: { ITSAPLAN_RUN_ID: '12' },
  cwd: '/srv/volition/workspaces/projects/alpha',
  agentId: 7,
  work: { kind: 'run' as const, id: 12 },
};

describe('launcher client', () => {
  it('sends one request line with no field of its own and streams the unit', async () => {
    const { path, seen } = await fakeLauncher((socket) => {
      socket.write(frame(0x11, 'out'));
      socket.write(frame(0x12, 'err'));
      socket.write(frame(0x13, JSON.stringify({ code: 3 })));
      socket.end();
    });
    const out: string[] = [];
    const errors: string[] = [];
    const result = await launch(
      request,
      {
        stdin: 'the task',
        onStdout: (chunk) => out.push(chunk.toString()),
        onStderr: (chunk) => errors.push(chunk.toString()),
      },
      path,
    );
    expect(result).toEqual({ code: 3, unit: 'volition-agent-alpha--a7-r12-abcdef012345.service' });
    expect(seen.request).toEqual({ v: 1, op: 'run', ...request });
    expect(seen.stdin).toBe('the task');
    expect(seen.eof).toBe(true);
    expect(out.join('')).toBe('out');
    expect(errors.join('')).toBe('err');
  });

  it("rejects with the launcher's refusal", async () => {
    const { path } = await fakeLauncher(() => {});
    servers[0].removeAllListeners('connection');
    servers[0].on('connection', (socket: Socket) => {
      socket.once('data', () => {
        socket.end(frame(0x14, JSON.stringify({ error: 'profile', message: 'not the project' })));
      });
    });
    const failure = await launch(request, {}, path).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LaunchError);
    expect((failure as LaunchError).code).toBe('profile');
  });

  it('closes the connection when the run is stopped, which stops the unit', async () => {
    const { path, seen } = await fakeLauncher(() => {});
    const stop = new AbortController();
    const running = launch(request, { signal: stop.signal }, path).catch((error: unknown) => error);
    while (!seen.eof) await new Promise((resolve) => setTimeout(resolve, 5));
    stop.abort();
    const failure = await running;
    expect((failure as LaunchError).code).toBe('aborted');
    for (let i = 0; i < 100 && !seen.closed; i++) await new Promise((r) => setTimeout(r, 5));
    expect(seen.closed).toBe(true);
  });

  it('fails when the launcher is not there', async () => {
    const failure = await launch(request, {}, '/nonexistent/launch.sock').catch((error) => error);
    expect((failure as LaunchError).code).toBe('launcher');
  });

  it('reads the answer of the profile helper', async () => {
    const { path, seen } = await fakeLauncher((socket) => {
      socket.write(frame(0x11, `${JSON.stringify({ ok: true, result: { skills: [] } })}\n`));
      socket.end(frame(0x13, JSON.stringify({ code: 0 })));
    });
    const answer = await profileHelper(
      { slug: 'alpha', profile: 'alpha_7', agentId: 7 },
      '/srv/volition/workspaces/projects/alpha',
      { op: 'inventory' },
      path,
    );
    expect(answer).toEqual({ skills: [] });
    expect(seen.request).toMatchObject({ runtime: 'profile-helper', args: [], env: {} });
    expect(seen.request).not.toHaveProperty('agentRuntime');
    expect(JSON.parse(seen.stdin)).toEqual({ op: 'inventory' });
  });

  it('decodes UTF-8 helper output across launcher frames', async () => {
    const { path } = await fakeLauncher((socket) => {
      const output = Buffer.from(JSON.stringify({ ok: true, result: 'ä😀' }));
      for (const byte of output) socket.write(frame(0x11, Buffer.from([byte])));
      socket.end(frame(0x13, JSON.stringify({ code: 0 })));
    });
    expect(
      await profileHelper<string>(
        { slug: 'alpha', profile: 'alpha_7', agentId: 7 },
        '/srv/volition/workspaces/projects/alpha',
        { op: 'inventory' },
        path,
      ),
    ).toBe('ä😀');
  });

  it("tells the launcher the agent's runtime, so a Codex agent's helper keeps its own .codex", async () => {
    const { path, seen } = await fakeLauncher((socket) => {
      socket.write(frame(0x11, `${JSON.stringify({ ok: true, result: { written: 1 } })}\n`));
      socket.end(frame(0x13, JSON.stringify({ code: 0 })));
    });
    await profileHelper(
      { slug: 'alpha', profile: 'alpha_7', agentId: 7, runtime: 'codex' },
      '/srv/volition/workspaces/projects/alpha',
      { op: 'cli-files', runtime: 'codex', files: [] },
      path,
    );
    expect(seen.request).toMatchObject({ runtime: 'profile-helper', agentRuntime: 'codex' });
  });

  it('asks an older launcher again without the field it does not know', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-launcher-'));
    dirs.push(dir);
    const path = join(dir, 'launch.sock');
    const requests: Record<string, unknown>[] = [];
    const server = createServer((socket) => {
      let buffered = Buffer.alloc(0);
      let accepted = false;
      socket.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (!accepted) {
          const end = buffered.indexOf(10);
          if (end < 0) return;
          const request = JSON.parse(buffered.subarray(0, end).toString()) as Record<
            string,
            unknown
          >;
          requests.push(request);
          buffered = buffered.subarray(end + 1);
          if ('agentRuntime' in request) {
            socket.end(
              frame(
                0x14,
                JSON.stringify({
                  error: 'request',
                  message: "unexpected fields: ['agentRuntime']",
                }),
              ),
            );
            return;
          }
          accepted = true;
          socket.write(
            frame(0x10, JSON.stringify({ unit: 'volition-agent-alpha--a7-h-0.service' })),
          );
        }
        if (buffered.includes(Buffer.from([0x02, 0, 0, 0, 0]))) {
          socket.write(frame(0x11, `${JSON.stringify({ ok: true, result: 'fine' })}\n`));
          socket.end(frame(0x13, JSON.stringify({ code: 0 })));
        }
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
    const answer = await profileHelper(
      { slug: 'alpha', profile: 'alpha_7', agentId: 7, runtime: 'codex' },
      '/srv/volition/workspaces/projects/alpha',
      { op: 'inventory' },
      path,
    );
    expect(answer).toBe('fine');
    expect(requests.map((request) => request.agentRuntime ?? null)).toEqual(['codex', null]);
  });

  it('passes on any other refusal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-launcher-'));
    dirs.push(dir);
    const path = join(dir, 'launch.sock');
    const server = createServer((socket) => {
      socket.once('data', () =>
        socket.end(
          frame(0x14, JSON.stringify({ error: 'credentials', message: 'the profile is odd' })),
        ),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
    const failure = await profileHelper(
      { slug: 'alpha', profile: 'alpha_7', agentId: 7, runtime: 'codex' },
      '/srv/volition/workspaces/projects/alpha',
      { op: 'inventory' },
      path,
    ).catch((error: unknown) => error);
    expect((failure as LaunchError).code).toBe('credentials');
  });
});

describe('isolated environment', () => {
  it('keeps what the command needs and nothing the launcher decides', () => {
    const env = isolatedEnv(
      {
        HERMES_HOME: '/var/lib/volition/hermes/profiles/alpha',
        HERMES_SHARED_AUTH_DIR: '/x',
        BROWSER_CDP_URL: 'http://127.0.0.1:19201',
        DISPLAY: ':201',
        XAUTHORITY: '/x',
        PATH: '/bin',
        https_proxy: 'http://evil',
        VOLITION_AGENT_SANDBOX: '0',
        LD_PRELOAD: '/tmp/x.so',
        'BAD-NAME': '1',
      },
      { ITSAPLAN_API_KEY: 'key', ITSAPLAN_URL: 'http://127.0.0.1:3000' },
      {
        ITSAPLAN_RUN_ID: '12',
        HERMES_MANAGED_DIR: '/p/run/itsaplan-managed',
        VOLITION_VAULT_ACCESS: '{}',
      },
    );
    expect(env).toEqual({
      ITSAPLAN_API_KEY: 'key',
      ITSAPLAN_URL: 'http://127.0.0.1:3000',
      ITSAPLAN_RUN_ID: '12',
      HERMES_MANAGED_DIR: '/p/run/itsaplan-managed',
      VOLITION_VAULT_ACCESS: '{}',
    });
  });
});

describe('isolated execution', () => {
  function config(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
    return {
      name: '',
      url: 'http://127.0.0.1:3000',
      apiKey: 'agent-key',
      agent: 'hermes',
      args: [],
      cwd: '/srv/volition/workspaces/projects/alpha',
      env: {
        HERMES_HOME: '/var/lib/volition/hermes/profiles/alpha_7',
        BROWSER_CDP_URL: 'http://x',
      },
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 5000,
      outputFormat: 'hermes-stream-json',
      models: [],
      isolation: { slug: 'alpha', profile: 'alpha_7', agentId: 7 },
      ...overrides,
    };
  }

  for (const failed of [false, true]) {
    it(`reads a native ${failed ? 'error' : 'success'} result through the launcher despite stderr warnings`, async () => {
      const { path } = await fakeLauncher((socket) => {
        socket.write(frame(0x12, 'DeprecationWarning: AI SDK Warning'));
        const result = JSON.stringify({
          type: 'result',
          text: 'Account read.',
          exitCode: failed ? 1 : 0,
          ...(failed && { reason: 'error', error: 'Connection reset' }),
        });
        socket.write(frame(0x11, result.slice(0, 30)));
        socket.write(frame(0x11, result.slice(30)));
        socket.end(frame(0x13, JSON.stringify({ code: failed ? 1 : 0 })));
      });
      process.env.AGENT_ISOLATION = 'on';
      process.env.VOLITION_LAUNCHER_SOCKET = path;
      const outcome = await execute(config({ agent: 'helena', outputFormat: 'helena-jsonl' }), {
        prompt: 'Read only.',
        systemPrompt: '',
        env: {},
      });
      expect(outcome).toEqual({
        status: failed ? 'failed' : 'success',
        output: 'Account read.',
        ...(failed && { error: 'Connection reset' }),
      });
    });
  }

  it('runs the preset through the launcher as the project', async () => {
    const { path, seen } = await fakeLauncher((socket) => {
      socket.write(
        frame(
          0x11,
          `${JSON.stringify({ type: 'result', text: 'done', exit_code: 0, session_id: 's-1' })}\n`,
        ),
      );
      socket.end(frame(0x13, JSON.stringify({ code: 0 })));
    });
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    const sessions: string[] = [];
    const outcome = await execute(
      config(),
      { prompt: 'the task', systemPrompt: '', env: { ITSAPLAN_RUN_ID: '12' } },
      { work: { kind: 'run', id: 12 }, onSessionId: (id) => sessions.push(id) },
    );
    expect(outcome).toMatchObject({ status: 'success', output: 'done', sessionId: 's-1' });
    expect(sessions).toEqual(['s-1']);
    const sent = seen.request as Record<string, unknown>;
    expect(sent).toMatchObject({
      slug: 'alpha',
      profile: 'alpha_7',
      runtime: 'hermes',
      cwd: '/srv/volition/workspaces/projects/alpha',
      agentId: 7,
      work: { kind: 'run', id: 12 },
      limits: { runtimeMaxSec: 65 },
    });
    expect((sent.args as string[])[0]).toBe('chat');
    expect(sent.env).toEqual({
      ITSAPLAN_URL: 'http://127.0.0.1:3000',
      ITSAPLAN_API_KEY: 'agent-key',
      ITSAPLAN_RUN_ID: '12',
      // Hermes' terminal scratch files (its shell snapshot) in the unit's own /tmp.
      TERMINAL_TEMP_DIR: '/tmp',
    });
    expect(seen.stdin).toBe('the task');
  });

  it('passes the isolated Claude key from the environment to the MCP header helper', async () => {
    const { path, seen } = await fakeLauncher((socket) => {
      socket.end(frame(0x13, JSON.stringify({ code: 0 })));
    });
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    const mcpArgs = claudeMcpArgs([
      {
        name: 'itsaplan',
        transport: 'http',
        url: 'http://127.0.0.1:3000/mcp',
        headers: [{ name: 'Authorization', value: { template: 'Bearer ${ITSAPLAN_API_KEY}' } }],
      },
    ]);
    await execute(config({ agent: 'claude', args: mcpArgs, outputFormat: 'text' }), {
      prompt: 'the task',
      systemPrompt: '',
      env: { ITSAPLAN_RUN_ID: '12' },
    });
    const sent = seen.request as { args: string[]; env: Record<string, string> };
    expect(sent.env.ITSAPLAN_API_KEY).toBe('agent-key');
    expect(sent.args.join(' ')).not.toContain('agent-key');
    const mcp = JSON.parse(sent.args[sent.args.indexOf('--mcp-config') + 1]!).mcpServers
      .itsaplan as { headersHelper: string };
    const output = execFileSync('sh', ['-c', mcp.headersHelper], {
      env: { PATH: process.env.PATH, ...sent.env },
      encoding: 'utf8',
    });
    expect(JSON.parse(output)).toEqual({ 'x-api-key': 'agent-key' });
  });

  it('never starts an agent unisolated while isolation is on', async () => {
    process.env.AGENT_ISOLATION = 'on';
    await expect(
      execute(config({ isolation: undefined }), { prompt: '', systemPrompt: '', env: {} }),
    ).rejects.toThrow('no isolated project');
    await expect(
      execute(config({ agent: undefined, command: 'sh -c true' }), {
        prompt: '',
        systemPrompt: '',
        env: {},
      }),
    ).rejects.toThrow('cannot run isolated');
  });

  it('reports a failed exit code as a failure', async () => {
    const { path } = await fakeLauncher((socket) => {
      socket.write(frame(0x12, 'Session not found'));
      socket.end(frame(0x13, JSON.stringify({ code: 1 })));
    });
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    const outcome = await execute(config({ outputFormat: 'text' }), {
      prompt: '',
      systemPrompt: '',
      env: {},
    });
    expect(outcome).toMatchObject({ status: 'failed', error: 'Session not found' });
  });
});

describe('isolation in the config', () => {
  it('reads an agent entry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-config-'));
    dirs.push(dir);
    const file = join(dir, 'runner.json');
    await writeFile(
      file,
      JSON.stringify({
        url: 'http://127.0.0.1:3000',
        agent: 'hermes',
        agents: [
          { apiKey: 'k1', isolation: { slug: 'alpha', profile: 'alpha_7', agentId: 7 } },
          { apiKey: 'k2', isolation: { slug: 'home', profile: 'home', agentId: null } },
        ],
      }),
    );
    const [first, second] = await loadConfig(file);
    // With the agent's runtime, which the launcher needs for the profile helper.
    expect(first.isolation).toEqual({
      slug: 'alpha',
      profile: 'alpha_7',
      agentId: 7,
      runtime: 'hermes',
    });
    expect(second.isolation).toEqual({
      slug: 'home',
      profile: 'home',
      agentId: null,
      runtime: 'hermes',
    });
  });

  it('refuses a malformed one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'itsaplan-config-'));
    dirs.push(dir);
    const file = join(dir, 'runner.json');
    await writeFile(
      file,
      JSON.stringify({
        url: 'http://127.0.0.1:3000',
        agent: 'hermes',
        apiKey: 'k',
        isolation: { slug: '../root', profile: 'x' },
      }),
    );
    await expect(loadConfig(file)).rejects.toThrow('isolation must name');
  });
});

describe('isolated profile', () => {
  it('does every profile operation through the helper, as the project user', async () => {
    const calls: Record<string, unknown>[] = [];
    const answers: Record<string, unknown> = {
      materialize: { revision: 'r1', conflicts: [], restored: [], mcpSecrets: null },
      plugins: ['plugins/plan-approval-guard'],
      actions: [{ id: 1, status: 'done' }],
      inventory: { inventory: { skills: [] }, learned: [{ name: 'x' }] },
      'vault-sync': [['handle-1', 5]],
    };
    const helper = (async (
      _isolation: unknown,
      cwd: string,
      operation: Record<string, unknown>,
    ) => {
      calls.push({ cwd, ...operation });
      return answers[operation.op as string];
    }) as typeof profileHelper;
    const profile = new IsolatedProfile(
      { slug: 'alpha', profile: 'alpha_7', agentId: 7 },
      '/srv/volition/workspaces/projects/alpha',
      '/var/lib/volition/hermes/profiles/alpha_7',
      { toolsets: ['terminal'], mcpServers: [] },
      helper,
    );
    expect(profile.managedDir).toBe(
      '/var/lib/volition/hermes/profiles/alpha_7/run/itsaplan-managed',
    );
    expect(await profile.apply({ revision: 'r1' } as never)).toMatchObject({ revision: 'r1' });
    expect(await profile.ensurePlugins()).toEqual(['plugins/plan-approval-guard']);
    expect(await profile.runActions([])).toEqual([]);
    expect(await profile.runActions([{ id: 1 } as never])).toEqual([
      { id: 1, status: 'done' },
    ] as never);
    expect(await profile.inventory()).toEqual({ skills: [] } as never);
    expect(await profile.learnedSkills()).toEqual([{ name: 'x' }] as never);
    expect(await profile.vault().sync([])).toEqual(new Map([['handle-1', 5]]));
    expect(calls.map((call) => call.op)).toEqual([
      'materialize',
      'plugins',
      'actions',
      'inventory',
      'vault-sync',
    ]);
    expect(calls.every((call) => call.cwd === '/srv/volition/workspaces/projects/alpha')).toBe(
      true,
    );
    expect(calls[0].profile).toEqual({ toolsets: ['terminal'], mcpServers: [] });
  });
});
