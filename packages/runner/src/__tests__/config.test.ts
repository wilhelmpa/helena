import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../config';

// The config is what decides which agents a runner serves and what each one runs, and a
// wrong merge is silent: the runner starts, it just works for the wrong agent or with the
// wrong CLI.

const ITSAPLAN_VARS = Object.keys(process.env).filter((name) => name.startsWith('ITSAPLAN_'));
const saved = Object.fromEntries(ITSAPLAN_VARS.map((name) => [name, process.env[name]]));

let dir: string;

beforeEach(async () => {
  for (const name of Object.keys(process.env).filter((name) => name.startsWith('ITSAPLAN_'))) {
    delete process.env[name];
  }
  dir = await mkdtemp(join(tmpdir(), 'itsaplan-runner-'));
});

afterAll(() => {
  Object.assign(process.env, saved);
});

async function load(file: Record<string, unknown>, overrides = {}) {
  const path = join(dir, 'itsaplan-runner.json');
  await writeFile(path, JSON.stringify(file));
  return loadConfig(path, overrides);
}

const base = { url: 'http://localhost:3000/', agent: 'claude' };

describe('one agent', () => {
  it('reads the file, with no name to put in front of its log lines', async () => {
    const [config] = await load({ ...base, apiKey: 'key-a', concurrency: 4 });
    expect(config).toMatchObject({
      name: '',
      url: 'http://localhost:3000',
      apiKey: 'key-a',
      agent: 'claude',
      concurrency: 4,
    });
  });

  it('takes the key from the environment, so it stays out of the file', async () => {
    process.env.ITSAPLAN_API_KEY = 'key-env';
    const [config] = await load(base);
    expect(config.apiKey).toBe('key-env');
  });

  it('lets a provider come from the file or environment', async () => {
    const [fromFile] = await load({ ...base, apiKey: 'key-a', provider: 'copilot' });
    expect(fromFile.provider).toBe('copilot');

    process.env.ITSAPLAN_PROVIDER = 'custom-provider';
    const [fromEnvironment] = await load({ ...base, apiKey: 'key-a', provider: 'copilot' });
    expect(fromEnvironment.provider).toBe('custom-provider');
  });

  it('validates the model catalog published for chat settings', async () => {
    const [config] = await load({
      ...base,
      apiKey: 'key-a',
      models: [
        {
          id: 'anthropic/claude-opus-4.6',
          name: 'Claude Opus 4.6',
          reasoning: true,
          thinkingLevels: ['low', 'medium', 'high'],
          thinkingDefault: 'medium',
        },
      ],
    });
    expect(config.models).toHaveLength(1);
    expect(config.models[0]?.thinkingDefault).toBe('medium');

    await expect(
      load({
        ...base,
        apiKey: 'key-a',
        models: [
          {
            id: 'model',
            reasoning: true,
            thinkingLevels: ['low'],
            thinkingDefault: 'high',
          },
        ],
      }),
    ).rejects.toThrow('thinkingDefault must be one of thinkingLevels');
  });

  it("reads the Hermes profile's toolsets and MCP servers, which every agent inherits", async () => {
    const hermes = { toolsets: ['file', 'web'], mcpServers: ['itsaplan'] };
    const [first, second] = await load({
      ...base,
      agent: 'hermes',
      hermes,
      agents: [{ apiKey: 'key-a' }, { apiKey: 'key-b' }],
    });
    expect(first.hermes).toEqual(hermes);
    expect(second.hermes).toEqual(hermes);
    expect((await load({ ...base, apiKey: 'key-a' }))[0].hermes).toBeUndefined();

    await expect(
      load({ ...base, apiKey: 'key-a', hermes: { toolsets: ['file'], mcpServers: 'itsaplan' } }),
    ).rejects.toThrow('hermes.mcpServers must be an array of strings');
    await expect(load({ ...base, apiKey: 'key-a', hermes: ['file'] })).rejects.toThrow(
      'hermes must be an object',
    );
  });

  it('refuses to disable Hermes rule loading while Plan policy sync is enabled', async () => {
    await expect(
      load({
        url: base.url,
        apiKey: 'key-a',
        agent: 'hermes',
        cwd: '/work/hermes',
        env: { HERMES_HOME: '/home/hermes' },
        args: ['--ignore-rules'],
      }),
    ).rejects.toThrow('Hermes cannot use --ignore-rules');
  });
});

describe('several agents', () => {
  it('runs the shared setup under each key in apiKeys', async () => {
    const configs = await load({ ...base, cwd: '/work/repo', apiKeys: ['key-a', 'key-b'] });
    expect(configs.map((config) => config.apiKey)).toEqual(['key-a', 'key-b']);
    expect(configs.map((config) => config.name)).toEqual(['#1', '#2']);
    for (const config of configs) {
      expect(config).toMatchObject({ agent: 'claude', cwd: '/work/repo' });
    }
  });

  it('lets an entry replace what it names and inherit the rest', async () => {
    const [shared, own] = await load({
      ...base,
      cwd: '/work/repo',
      concurrency: 2,
      agents: [
        { apiKey: 'key-a', name: 'planner' },
        { apiKey: 'key-b', cwd: '/work/other', concurrency: 1, args: ['--model', 'opus'] },
      ],
    });
    expect(shared).toMatchObject({ name: 'planner', cwd: '/work/repo', concurrency: 2, args: [] });
    expect(own).toMatchObject({
      name: '#2',
      cwd: '/work/other',
      concurrency: 1,
      args: ['--model', 'opus'],
      agent: 'claude',
    });
  });

  it('drops the shared command when an entry names an agent, and the other way round', async () => {
    const [preset, own] = await load({
      url: base.url,
      command: 'my-agent',
      outputFormat: 'text',
      agents: [{ apiKey: 'key-a', agent: 'codex' }, { apiKey: 'key-b' }],
    });
    // The shared format described the command, so the entry that replaced it reads codex's
    // own stream instead of being handed 'text'.
    expect(preset).toMatchObject({
      agent: 'codex',
      command: undefined,
      outputFormat: 'codex-jsonl',
    });
    expect(own).toMatchObject({ agent: undefined, command: 'my-agent', outputFormat: 'text' });

    const [entry] = await load({
      ...base,
      agents: [{ apiKey: 'key-a', command: 'my-agent', outputFormat: 'text' }],
    });
    expect(entry).toMatchObject({ agent: undefined, command: 'my-agent' });
  });

  it('gives an entry priority over the environment, which describes them all', async () => {
    process.env.ITSAPLAN_AGENT = 'codex';
    process.env.ITSAPLAN_API_KEY = 'key-env';
    const [shared, own] = await load({
      url: base.url,
      agents: [{ apiKey: 'key-a' }, { apiKey: 'key-b', agent: 'antigravity' }],
    });
    expect(shared).toMatchObject({ apiKey: 'key-a', agent: 'codex' });
    expect(own).toMatchObject({ apiKey: 'key-b', agent: 'antigravity' });
  });

  it('refuses a config that says both, or that lists no agent at all', async () => {
    await expect(
      load({ ...base, apiKeys: ['key-a'], agents: [{ apiKey: 'key-b' }] }),
    ).rejects.toThrow('either apiKeys or agents');
    await expect(load({ ...base, apiKeys: [] })).rejects.toThrow('cannot be empty');
    // The shared key would be inherited, and both entries would poll as the one agent.
    await expect(
      load({ ...base, apiKey: 'key-shared', agents: [{ name: 'no key' }] }),
    ).rejects.toThrow('each with its own apiKey');
  });
});
