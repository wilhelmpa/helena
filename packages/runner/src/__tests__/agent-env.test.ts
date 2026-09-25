import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretMask } from '@helena/sdk';
import { AnswerStream, type AgUiEvent } from '../agui';
import { acceptedName, deliveredEnv, withEnv } from '../agent-env';
import type { RunnerConfig } from '../config';
import { execute } from '../execute';
import { codexToolEnvArgs, PRESETS } from '../presets';

// Credentials as environment variables (docs/helena-decisions/agent-env.md): what the runner
// takes from Helena, how it reaches the command, and that none of it comes back in what the
// runner reports.

const TOKEN = 'cf-token-0123456789abcdefghijklmnopqrstuv';
const dirs: string[] = [];
const servers: Server[] = [];
const envBefore = { ...process.env };

afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  for (const name of ['AGENT_ISOLATION', 'VOLITION_LAUNCHER_SOCKET']) {
    if (envBefore[name] === undefined) delete process.env[name];
    else process.env[name] = envBefore[name];
  }
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function config(overrides: Partial<RunnerConfig>): RunnerConfig {
  return {
    name: '',
    url: 'http://plan.test',
    apiKey: 'runner-key-abcdefghijkl',
    args: [],
    env: {},
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutMs: 10_000,
    outputFormat: 'text',
    models: [],
    ...overrides,
  };
}

describe('what the runner takes from Helena', () => {
  it('sets the delivered variables, masks only the secret ones, and refuses its own names', () => {
    const delivered = deliveredEnv([
      { id: 1, label: 'VERVE', name: 'CLOUDFLARE_API_TOKEN', value: TOKEN, secret: true, updatedAt: 'a' },
      { id: 2, label: 'Account', name: 'CLOUDFLARE_ACCOUNT_ID', value: '42a48d019d819276f79d3cf42750689b', secret: false, updatedAt: 'a' },
      { id: 3, label: 'x', name: 'ITSAPLAN_API_KEY', value: 'stolen-key-123456', secret: true, updatedAt: 'a' },
      { id: 4, label: 'x', name: 'PATH', value: '/evil', secret: false, updatedAt: 'a' },
      { id: 5, label: 'x', name: 'lower_case', value: 'nope-nope-nope', secret: true, updatedAt: 'a' },
    ]);
    expect(delivered.env).toEqual({
      CLOUDFLARE_API_TOKEN: TOKEN,
      CLOUDFLARE_ACCOUNT_ID: '42a48d019d819276f79d3cf42750689b',
    });
    expect(delivered.names).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(delivered.secrets).toEqual([TOKEN]);
    for (const name of ['GIT_SSH_COMMAND', 'HERMES_HOME', 'TERMINAL_TEMP_DIR', 'LD_PRELOAD', 'NODE_OPTIONS']) {
      expect(acceptedName(name)).toBe(false);
    }
    expect(acceptedName('WRANGLER_SEND_METRICS')).toBe(true);
  });

  it("puts the runner's and the adapter's own variables over a delivered one", () => {
    const delivered = deliveredEnv([
      { id: 1, label: 'x', name: 'CLOUDFLARE_API_TOKEN', value: TOKEN, secret: true, updatedAt: 'a' },
    ]);
    const settings = withEnv(
      { toolsets: null, env: { HERMES_MANAGED_DIR: '/m' } },
      { GIT_SSH_COMMAND: 'ssh -F x' },
      delivered,
    );
    expect(settings?.env).toEqual({
      CLOUDFLARE_API_TOKEN: TOKEN,
      HERMES_MANAGED_DIR: '/m',
      GIT_SSH_COMMAND: 'ssh -F x',
    });
    expect(settings?.delivered).toEqual({ names: ['CLOUDFLARE_API_TOKEN'], secrets: [TOKEN] });
    expect(withEnv(null, {})).toBeNull();
  });
});

describe('how the variables reach the tools', () => {
  it("lets Codex's shell commands have the delivered ones and still hides every other secret name", () => {
    expect(codexToolEnvArgs(null)).toEqual([]);
    expect(
      codexToolEnvArgs({
        delivered: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
        present: ['PATH', 'CLOUDFLARE_API_TOKEN', 'ITSAPLAN_API_KEY', 'ITSAPLAN_MCP_SECRET_4', 'HOME'],
      }),
    ).toEqual([
      '-c',
      'shell_environment_policy.ignore_default_excludes=true',
      '-c',
      'shell_environment_policy.exclude=["ITSAPLAN_API_KEY","ITSAPLAN_MCP_SECRET_4"]',
    ]);
    // The names go on the command line, never a value.
    const argv = PRESETS.codex.taskArgs!({
      toolEnv: { delivered: ['CLOUDFLARE_API_TOKEN'], present: ['CLOUDFLARE_API_TOKEN'] },
    });
    expect(argv.join(' ')).not.toContain(TOKEN);
    expect(argv.at(-1)).toBe('sandbox_mode="workspace-write"');
  });

  it("gives a command the delivered variables in its environment and nowhere on its command line", async () => {
    const cwd = await tempDir('agent-env-local-');
    const outcome = await execute(config({ cwd, command: 'printf "%s|%s" "$CLOUDFLARE_API_TOKEN" "$0"' }), {
      prompt: '',
      systemPrompt: '',
      env: { CLOUDFLARE_API_TOKEN: TOKEN },
      delivered: ['CLOUDFLARE_API_TOKEN'],
    });
    expect(outcome).toMatchObject({ status: 'success', output: `${TOKEN}|sh` });
  });

  it("points Hermes' terminal scratch files at a directory of the run's own and removes it", async () => {
    const bin = await tempDir('agent-env-bin-');
    const record = join(bin, 'seen');
    // A stand-in for `hermes chat`: notes where its terminal would write and what is there.
    await writeFile(
      join(bin, 'hermes'),
      [
        '#!/bin/sh',
        `printf '%s\\n' "$TERMINAL_TEMP_DIR" > '${record}'`,
        `[ -d "$TERMINAL_TEMP_DIR" ] && stat -c %a "$TERMINAL_TEMP_DIR" >> '${record}'`,
        'echo \'{"type":"result","text":"ok","exit_code":0}\'',
        '',
      ].join('\n'),
    );
    await chmod(join(bin, 'hermes'), 0o755);
    const cwd = await tempDir('agent-env-hermes-');
    const outcome = await execute(
      config({
        cwd,
        agent: 'hermes',
        outputFormat: 'hermes-stream-json',
        env: { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}` },
      }),
      { prompt: 'hi', systemPrompt: '', env: { CLOUDFLARE_API_TOKEN: TOKEN }, delivered: ['CLOUDFLARE_API_TOKEN'] },
    );
    expect(outcome.status).toBe('success');
    const [scratch, mode] = (await Bun.file(record).text()).trim().split('\n');
    expect(scratch).toContain('helena-run-');
    expect(mode).toBe('700');
    // Gone with the run: the shell snapshot in it held the delivered variables.
    expect(await readdir(scratch!).catch(() => null)).toBeNull();
  });

  it('hands an isolated command its variables on the launcher header, never as an argument', async () => {
    const dir = await tempDir('agent-env-launcher-');
    const path = join(dir, 'launch.sock');
    let request: Record<string, unknown> | null = null;
    const server = createServer((socket) => {
      let buffered = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (request) return;
        const end = buffered.indexOf(10);
        if (end < 0) return;
        request = JSON.parse(buffered.subarray(0, end).toString()) as Record<string, unknown>;
        const frame = (kind: number, payload: string) => {
          const head = Buffer.alloc(5);
          head.writeUInt8(kind, 0);
          head.writeUInt32BE(Buffer.byteLength(payload), 1);
          return Buffer.concat([head, Buffer.from(payload)]);
        };
        socket.write(frame(0x10, JSON.stringify({ unit: 'u' })));
        socket.write(frame(0x11, '{"type":"result","text":"ok","exit_code":0}\n'));
        socket.end(frame(0x13, JSON.stringify({ code: 0 })));
      });
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(path, done));
    process.env.AGENT_ISOLATION = 'on';
    process.env.VOLITION_LAUNCHER_SOCKET = path;
    const outcome = await execute(
      config({
        cwd: '/srv/volition/workspaces/projects/verve',
        agent: 'hermes',
        outputFormat: 'hermes-stream-json',
        isolation: { slug: 'verve', profile: 'verve', agentId: 6 },
      }),
      { prompt: 'hi', systemPrompt: '', env: { CLOUDFLARE_API_TOKEN: TOKEN }, delivered: ['CLOUDFLARE_API_TOKEN'] },
      { work: { kind: 'run', id: 1 } },
    );
    expect(outcome.status).toBe('success');
    const sent = request as unknown as { env: Record<string, string>; args: string[] };
    expect(sent.env.CLOUDFLARE_API_TOKEN).toBe(TOKEN);
    // The unit's own /tmp, which goes with the unit.
    expect(sent.env.TERMINAL_TEMP_DIR).toBe('/tmp');
    expect(JSON.stringify(sent.args)).not.toContain(TOKEN);
  });
});

describe('what the runner reports', () => {
  function collect() {
    const events: AgUiEvent[] = [];
    return { events, send: async (batch: AgUiEvent[]) => void events.push(...batch) };
  }
  const all = (events: AgUiEvent[]) => JSON.stringify(events);
  const text = (events: AgUiEvent[]) =>
    events
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => (event as { delta: string }).delta)
      .join('');

  it('masks a secret the answer spells out, even split across two flushes', async () => {
    const sink = collect();
    const stream = new AnswerStream('text', 't', '1', sink.send, new SecretMask([TOKEN]));
    stream.write(`The token is ${TOKEN.slice(0, 12)}`);
    await stream.flush();
    // Nothing that could be the start of the token has left yet.
    expect(all(sink.events)).not.toContain(TOKEN.slice(0, 12));
    stream.write(`${TOKEN.slice(12)} and that is all.`);
    await stream.finish('');
    expect(all(sink.events)).not.toContain(TOKEN.slice(0, 12));
    expect(text(sink.events)).toBe('The token is [redacted] and that is all.');
  });

  it('holds back nothing that cannot be a secret, and releases a false start at the end', async () => {
    const sink = collect();
    const stream = new AnswerStream('text', 't', '1', sink.send, new SecretMask([TOKEN]));
    stream.write('cf-tok');
    await stream.flush();
    expect(text(sink.events)).toBe('');
    await stream.finish('');
    expect(text(sink.events)).toBe('cf-tok');
  });

  it('masks tool calls, tool output and the error of a Hermes stream', async () => {
    const sink = collect();
    const stream = new AnswerStream('hermes-stream-json', 't', '1', sink.send, new SecretMask([TOKEN]));
    stream.write(
      [
        JSON.stringify({ type: 'tool_use', name: 'terminal', input: { command: `curl -H "Bearer ${TOKEN}"` } }),
        JSON.stringify({ type: 'tool_result', name: 'terminal', output: `CLOUDFLARE_API_TOKEN=${TOKEN}` }),
        '',
      ].join('\n'),
    );
    await stream.fail(`wrangler failed with ${TOKEN}`);
    expect(all(sink.events)).not.toContain(TOKEN);
    expect(all(sink.events)).toContain('CLOUDFLARE_API_TOKEN=[redacted]');
  });
});
