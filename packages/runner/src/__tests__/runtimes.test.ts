import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliRuntimeType } from '@helena/sdk';
import { AnswerStream, UsageReader, type AgUiEvent } from '../agui';
import { loadConfig, presetOf } from '../config';
import { loadRunnerPlugins } from '../plugins';
import { PRESETS, PRESET_NAMES } from '../presets';
import { BUILTIN_RUNTIMES_PLUGIN, runtimes } from '../runtimes';

// The presets moved behind the runtime registry (@helena/sdk RuntimeAdapter). The
// built-ins must come out exactly as before, and a plugin must be able to add a runtime,
// with a stream format of its own, without any change here.

describe('built-in runtimes', () => {
  it('registers every preset unchanged, as the internal plugin', () => {
    for (const name of PRESET_NAMES) {
      const adapter = runtimes.get(name);
      expect(adapter?.protocol).toBe('cli');
      expect(adapter?.protocol === 'cli' && adapter.command).toBe(PRESETS[name]);
      expect(runtimes.pluginOf(name)).toBe(BUILTIN_RUNTIMES_PLUGIN);
    }
    expect(presetOf({ agent: 'hermes' })).toBe(PRESETS.hermes);
  });
});

describe('a plugin runtime', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const name of runtimes.ids()) {
      if (runtimes.pluginOf(name) !== BUILTIN_RUNTIMES_PLUGIN)
        runtimes.removePlugin(runtimes.pluginOf(name)!);
    }
  });

  it('is loaded from a plugin folder, named in the config and read with its own parser', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'helena-runner-plugin-'));
    dirs.push(root);
    const plugin = join(root, 'echo');
    await mkdir(plugin);
    await writeFile(
      join(plugin, 'helena.plugin.json'),
      JSON.stringify({
        id: 'acme.echo',
        name: 'Echo runtime',
        version: '1.0.0',
        sdk: '^0.1.0',
        main: { runner: 'runner.mjs' },
        provides: { runtimes: ['echo'] },
      }),
    );
    // The parser reads lines like {"say":"…"} / {"tokens":[in,out]} / {"sid":"…"}.
    await writeFile(
      join(plugin, 'runner.mjs'),
      `export default {
  register(ctx) {
    ctx.runtimes.register({
      id: 'echo',
      label: 'Echo',
      protocol: 'cli',
      capabilities: { sessions: true, chat: true, systemPrompt: false, modelSelection: false, mcp: false, isolation: false },
      command: { bin: 'echo-agent', outputFormat: 'echo-jsonl', promptVia: 'stdin', head: () => [], tail: [] },
      parser: () => ({
        line(value) {
          if (value.sid) return [{ type: 'session', id: value.sid }];
          if (value.say) return [{ type: 'text', delta: value.say }];
          if (value.tokens) return [{ type: 'usage', inputTokens: value.tokens[0], outputTokens: value.tokens[1] }];
          return [];
        },
      }),
    });
  },
};
`,
    );
    const configPath = join(root, 'runner.json');
    await writeFile(
      configPath,
      JSON.stringify({ url: 'http://x', apiKey: 'k', agent: 'echo', plugins: [plugin] }),
    );

    const logs: string[] = [];
    const [loaded] = await loadRunnerPlugins(configPath, (line) => logs.push(line));
    expect(loaded?.status).toBe('loaded');
    expect((runtimes.get('echo') as CliRuntimeType).command.bin).toBe('echo-agent');

    const [config] = await loadConfig(configPath);
    expect(config?.agent).toBe('echo');
    expect(config?.outputFormat).toBe('echo-jsonl');

    const sent: AgUiEvent[] = [];
    const stream = new AnswerStream(
      'echo-jsonl',
      't',
      '1',
      async (events) => void sent.push(...events),
    );
    stream.write('{"sid":"s-1"}\n{"say":"Hallo "}\n{"say":"Welt"}\n{"tokens":[120,7]}\n');
    await stream.finish('');
    expect(stream.startedSession()).toBe('s-1');
    expect(stream.contextUsage()).toEqual({ inputTokens: 120, outputTokens: 7 });
    const text = sent
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => (event as { delta: string }).delta)
      .join('');
    expect(text).toBe('Hallo Welt');

    const usage = new UsageReader('echo-jsonl');
    usage.write('{"tokens":[5,6]}\n');
    expect(usage.value()).toEqual({ inputTokens: 5, outputTokens: 6 });
  });

  it('refuses a runtime nobody registered', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'helena-runner-'));
    const configPath = join(root, 'runner.json');
    await writeFile(configPath, JSON.stringify({ url: 'http://x', apiKey: 'k', agent: 'nobody' }));
    await expect(loadConfig(configPath)).rejects.toThrow(/agent must be one of .*hermes/);
  });
});
