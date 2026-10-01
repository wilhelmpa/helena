import { describe, expect, it, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimePolicySnapshot } from '@helena/sdk';
import {
  AnswerStream,
  EscalationReader,
  FinalAnswerReader,
  UsageReader,
  type AgUiEvent,
} from '../agui';
import { presetOf, type RunnerConfig } from '../config';
import { commandFor, execute } from '../execute';
import { helenaAgentConfig, HelenaRuntimeAdapter, localServers } from '../helena-runtime';
import type { RuntimePolicyClient, RuntimeStatus } from '../policy';
import { presetArgv, PRESETS } from '../presets';
import { runtimes } from '../runtimes';
import { SpendReader } from '../spend';
import { modelChain } from '@helena/agent-runtime';

// The runtime `helena`: Helena's own loop (packages/agent-runtime), run as `cli.js
// helena-agent` with its configuration inside the task's JSON on stdin, read back as
// helena-jsonl.

const lines = (...events: object[]) =>
  `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;

test('carries each local model context and output limit into native model resolution', () => {
  const servers = localServers({
    revision: 'small-local-fixture',
    runtimePolicy: { files: [] },
    skills: [],
    localAi: {
      helpers: [],
      servers: [
        {
          provider: 'helena-volition-npu',
          baseUrl: 'http://127.0.0.1:1/v1',
          keyEnv: null,
          contextLength: 65536,
          models: [{ id: 'small', contextLength: 8192, vision: false, maxOutputTokens: 1024 }],
        },
      ],
    },
  });
  const resolved = modelChain('helena-volition-npu/small', [], servers, null, {}).chain[0]!;
  expect(resolved.contextLength).toBe(8192);
  expect(resolved.maxOutputTokens).toBe(1024);
});

const snapshot: RuntimePolicySnapshot = {
  revision: 'r1',
  model: 'helena-halogen/halogen-qwen3.8-flash-next',
  runtimePolicy: { files: [{ kind: 'instructions', path: 'SOUL.md', content: 'Du bist Helena.' }] },
  skills: [
    {
      id: 1,
      slug: 'release-notes',
      name: 'Release notes',
      description: 'Writes release notes',
      markdown: '# Release notes',
      files: [],
    },
  ],
  localAi: {
    servers: [
      {
        provider: 'helena-halogen',
        baseUrl: 'http://127.0.0.1:8731/v1',
        keyEnv: null,
        contextLength: 262144,
        models: [{ id: 'halogen-qwen3.8-flash-next', contextLength: 262144, vision: false }],
      },
    ],
    helpers: [],
  },
  helena: {
    toolProfile: 'recherche',
    escalation: { target: 'runtime:claude', taskKinds: ['recht'] },
  },
};

test('native configuration truncates SOUL with a model-sized limit and reports the cut', () => {
  const long = 'A'.repeat(70_000);
  const modified: RuntimePolicySnapshot = {
    ...snapshot,
    contextLimits: { soul: 20_000, skillDescription: 60, loadedSkills: 2 },
    runtimePolicy: { files: [{ kind: 'instructions', path: 'SOUL.md', content: long }] },
    localAi: {
      servers: [
        {
          ...snapshot.localAi!.servers[0]!,
          contextLength: 256_000,
          models: [
            { id: 'halogen-qwen3.8-flash-next', contextLength: 256_000, vision: false },
            { id: 'halogen-27b', contextLength: 32_768, vision: false },
          ],
        },
      ],
      helpers: [],
    },
  };
  const config = helenaAgentConfig(modified, [], { url: 'http://localhost:3001', cwd: '/tmp' });
  expect(config.instructions!.length).toBeLessThanOrEqual(61_440);
  expect(config.instructions).toContain('Context truncated');
  expect(config.contextWarnings?.[0]).toContain('70000 to');
  const smaller = helenaAgentConfig({ ...modified, model: 'helena-halogen/halogen-27b' }, [], {
    url: 'http://localhost:3001',
    cwd: '/tmp',
  });
  expect(smaller.instructions!.length).toBeLessThanOrEqual(20_000);
  const overridden = helenaAgentConfig(
    {
      ...modified,
      runtimePolicy: {
        ...modified.runtimePolicy,
        contextLimits: { soul: 1000 },
      },
    },
    [],
    { url: 'http://localhost:3001', cwd: '/tmp' },
  );
  expect(overridden.instructions!.length).toBeLessThanOrEqual(1000);
});

describe('the helena runtime', () => {
  it('delivers only configured local server keys and refreshes them for each answer', async () => {
    let supplied = 'synthetic-first';
    const local = {
      ...snapshot,
      localAi: {
        ...snapshot.localAi!,
        servers: [{ ...snapshot.localAi!.servers[0]!, keyEnv: 'VOLITION_BATTLE_MODEL_KEY' }],
      },
    };
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => local,
      reportRuntimeStatus: async () => {},
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
      modelServerKeys: async () => ({
        VOLITION_BATTLE_MODEL_KEY: supplied,
        VOLITION_UNCONFIGURED_MODEL_KEY: 'synthetic-unconfigured',
      }),
    };
    const runner = {
      name: 'volition-battle',
      url: 'http://localhost:3001',
      apiKey: 'synthetic-test-key',
      agent: 'helena',
      outputFormat: 'helena-jsonl',
      timeoutMs: 1000,
      cwd: '/tmp',
      env: {},
    } as RunnerConfig;
    const adapter = new HelenaRuntimeAdapter(runner, client);
    const settings = await adapter.runSettings();
    const config = settings.input!.config as ReturnType<typeof helenaAgentConfig>;
    expect(settings.env.VOLITION_BATTLE_MODEL_KEY).toBe('synthetic-first');
    expect(settings.env.VOLITION_UNCONFIGURED_MODEL_KEY).toBeUndefined();
    expect(
      modelChain(config.model, config.fallbackModels, config.servers, null, settings.env).chain,
    ).toHaveLength(1);
    supplied = '';
    const revoked = await adapter.runSettings();
    expect(revoked.env.VOLITION_BATTLE_MODEL_KEY).toBe('');
    expect(
      modelChain(config.model, config.fallbackModels, config.servers, null, revoked.env).chain,
    ).toHaveLength(0);
  });

  it('uses the host priority proxy and preserves the forwarded sandbox addresses', () => {
    const isolation = process.env.AGENT_ISOLATION;
    try {
      delete process.env.AGENT_ISOLATION;
      expect(localServers(snapshot).map((server) => server.baseUrl)).toEqual([
        'http://127.0.0.1:8741/v1',
        'http://127.0.0.1:8741/v1',
      ]);
      process.env.AGENT_ISOLATION = 'on';
      expect(localServers(snapshot).map((server) => server.baseUrl)).toEqual([
        'http://127.0.0.1:8731/v1',
        'http://127.0.0.1:8731/v1',
      ]);
    } finally {
      if (isolation === undefined) delete process.env.AGENT_ISOLATION;
      else process.env.AGENT_ISOLATION = isolation;
    }
  });

  it('is a built-in runtime that reads its own event lines', () => {
    const type = runtimes.get('helena');
    expect(type?.protocol).toBe('cli');
    expect(presetOf({ agent: 'helena' })).toBe(PRESETS.helena);
    const stream: AgUiEvent[] = [];
    const answer = new AnswerStream('helena-jsonl', 't', '1', async (events) => {
      stream.push(...events);
    });
    answer.write(
      lines(
        { type: 'session', id: 's-1' },
        { type: 'model', id: 'helena-halogen/flash' },
        { type: 'thinking', delta: 'hm' },
        { type: 'tool-call', id: 'c1', name: 'list_issues', input: '{}' },
        { type: 'tool-result', id: 'c1', output: '[]' },
        { type: 'text', delta: 'Nichts offen.' },
        { type: 'usage', inputTokens: 1200, outputTokens: 40 },
        {
          type: 'spend',
          model: 'helena-halogen/flash',
          provider: 'helena-halogen',
          inputTokens: 2400,
          outputTokens: 80,
        },
        { type: 'result', text: 'Nichts offen.', exitCode: 0 },
      ),
    );
    expect(answer.startedSession()).toBe('s-1');
    expect(answer.model()).toBe('helena-halogen/flash');
  });

  it('preserves neutral terminal outcomes through the API event stream', async () => {
    const events: AgUiEvent[] = [];
    const answer = new AnswerStream('helena-jsonl', 't', '1', async (batch) => {
      events.push(...batch);
    });
    answer.write(
      lines(
        { type: 'tool-call', id: 'terminal-1', name: 'shell', input: '{}' },
        {
          type: 'tool-result',
          id: 'terminal-1',
          output: 'partial output',
          outcome: 'nonzero_with_output',
          exitCode: 1,
        },
      ),
    );
    await answer.finish('');
    expect(events.find((event) => event.type === 'TOOL_CALL_RESULT')).toMatchObject({
      metadata: { outcome: 'nonzero_with_output', exitCode: 1 },
    });
    expect(JSON.stringify(events)).not.toContain('"isError":true');
  });

  it('builds its command line with the resume flag and the model of the run', () => {
    const argv = presetArgv(PRESETS.helena, 's-9', 'ctx', [], 'task', {
      model: 'halogen-qwen3.8-flash-next',
      provider: 'helena-halogen',
      thinkingLevel: 'none',
      maxTurns: 12,
      runBudgetSeconds: 240,
    });
    expect(argv).toEqual([
      '--stdin-json',
      '--resume',
      's-9',
      '--model',
      'helena-halogen/halogen-qwen3.8-flash-next',
      '--reasoning',
      'none',
      '--max-turns',
      '12',
      '--run-budget',
      '240',
    ]);
  });

  it('reads the session, the answer, the spend and a hand-over', () => {
    const output = lines(
      { type: 'session', id: 's-2' },
      { type: 'model', id: 'helena-halogen/flash' },
      {
        type: 'spend',
        model: 'helena-halogen/flash',
        provider: 'helena-halogen',
        inputTokens: 300,
        outputTokens: 20,
        cacheReadTokens: 100,
        reasoningTokens: 5,
        durationMs: 1234,
      },
      {
        type: 'escalate',
        target: 'runtime:claude',
        reason: 'task-kind',
        detail: 'recht',
        handover: 'Übergabe …',
      },
      { type: 'result', text: 'Übergeben an claude (task-kind).', exitCode: 3 },
    );
    const sessions: string[] = [];
    const answer = new FinalAnswerReader('helena-jsonl', (id) => sessions.push(id));
    answer.write(output);
    answer.end();
    expect(sessions).toEqual(['s-2']);
    expect(answer.text()).toBe('Übergeben an claude (task-kind).');
    const spend = new SpendReader('helena-jsonl', 'helena');
    spend.write(output);
    expect(spend.value()).toMatchObject({
      runtime: 'helena',
      model: 'helena-halogen/flash',
      inputTokens: 300,
      cacheReadTokens: 100,
      reasoningTokens: 5,
      durationMs: 1234,
    });
    const escalation = new EscalationReader('helena-jsonl');
    escalation.write(output);
    expect(escalation.value()).toEqual({
      target: 'runtime:claude',
      reason: 'task-kind',
      detail: 'recht',
      handover: 'Übergabe …',
    });
    const usage = new UsageReader('helena-jsonl');
    usage.write(lines({ type: 'usage', inputTokens: 900, outputTokens: 12 }));
    expect(usage.value()).toEqual({ inputTokens: 900, outputTokens: 12 });
  });

  it("hands the loop the agent's servers, tools, skills and escalation", () => {
    const config = helenaAgentConfig(snapshot, [], {
      url: 'http://127.0.0.1:3000',
      cwd: '/srv/work',
    });
    expect(config.model).toBe('helena-halogen/halogen-qwen3.8-flash-next');
    expect(config.instructions).toBe('Du bist Helena.');
    expect(config.workdir).toBe('/srv/work');
    expect(config.tools?.profile).toBe('recherche');
    expect(config.skills?.[0]?.name).toBe('release-notes');
    expect(config.escalation?.target).toBe('runtime:claude');
    expect(config.servers.map((server) => server.provider)).toEqual([
      'helena-halogen',
      'helena-halogen--nothink',
      'anthropic',
      'openai',
      'openrouter',
    ]);
    expect(localServers(snapshot)[1]!.thinking).toBe(false);
  });

  it('reports its status and hands the configuration in the task input', async () => {
    const statuses: RuntimeStatus[] = [];
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => ({
        ...snapshot,
        actions: [{ id: 5, kind: 'write-memory', file: 'MEMORY.md', content: 'x', baseSha256: '' }],
      }),
      reportRuntimeStatus: async (status) => {
        statuses.push(status);
      },
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
    };
    const runner = {
      name: 'a',
      url: 'http://127.0.0.1:3000',
      apiKey: 'itp_test_key_for_the_adapter',
      agent: 'helena',
      args: [],
      env: {},
      cwd: '/srv/work',
      concurrency: 1,
      pollIntervalMs: 1000,
      timeoutMs: 60_000,
      outputFormat: 'helena-jsonl',
      models: [],
    } satisfies RunnerConfig;
    const adapter = new HelenaRuntimeAdapter(runner, client);
    const settings = await adapter.runSettings();
    expect((settings.input?.config as { model: string }).model).toBe(snapshot.model!);
    expect(statuses[0]).toMatchObject({
      adapter: 'helena',
      status: 'online',
      appliedRevision: 'r1',
    });
    // The loop's memory is Helena's own: an owner's edit needs no file write.
    expect(statuses[0]!.actions).toEqual([{ id: 5, error: null }]);
  });

  it('reads only the configured local server keys before every native answer', async () => {
    let reads = 0;
    const client: RuntimePolicyClient = {
      runtimePolicy: async () => ({
        ...snapshot,
        localAi: {
          ...snapshot.localAi!,
          servers: [{ ...snapshot.localAi!.servers[0]!, keyEnv: 'VOLITION_TEST_MODEL_KEY' }],
        },
      }),
      reportRuntimeStatus: async () => {},
      mcpSecrets: async () => ({}),
      webLogins: async () => [],
      modelServerKeys: async (): Promise<Record<string, string>> => {
        reads++;
        return reads === 1
          ? { VOLITION_TEST_MODEL_KEY: 'test-only-model-key', UNRELATED_KEY: 'test-only-unrelated' }
          : {};
      },
    };
    const adapter = new HelenaRuntimeAdapter(
      {
        name: 'local-key-test',
        url: 'http://127.0.0.1:3000',
        apiKey: 'itp_test_key_for_the_adapter',
        agent: 'helena',
        args: [],
        env: {},
        concurrency: 1,
        pollIntervalMs: 1000,
        timeoutMs: 60_000,
        outputFormat: 'helena-jsonl',
        models: [],
      },
      client,
    );
    const first = await adapter.runSettings();
    expect(first.env?.VOLITION_TEST_MODEL_KEY).toBe('test-only-model-key');
    expect(first.env).not.toHaveProperty('UNRELATED_KEY');
    const revoked = await adapter.runSettings();
    expect(revoked.env?.VOLITION_TEST_MODEL_KEY).toBe('');
    expect(reads).toBe(2);
  });

  it('runs a subcommand of the runner with the task as JSON on stdin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helena-subcommand-'));
    // A stand-in for the runner bundle: it echoes what it was started with as helena-jsonl.
    const script = join(dir, 'fake-runner.mjs');
    await writeFile(
      script,
      `let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({ type: 'session', id: 's-3' }));
  console.log(JSON.stringify({ type: 'result', text: [process.argv[2], task.prompt, task.config.model].join('|'), exitCode: 0 }));
});
`,
    );
    const argv1 = process.argv[1];
    process.argv[1] = script;
    try {
      const chunks: string[] = [];
      const outcome = await execute(
        {
          name: 'a',
          url: 'http://127.0.0.1:3000',
          apiKey: 'itp_test_key_for_the_adapter',
          agent: 'helena',
          args: [],
          env: {},
          cwd: dir,
          concurrency: 1,
          pollIntervalMs: 1000,
          timeoutMs: 20_000,
          outputFormat: 'helena-jsonl',
          models: [],
        },
        { prompt: 'Hallo', systemPrompt: '', env: {}, input: { config: { model: 'x/y' } } },
        { onData: (chunk) => chunks.push(chunk) },
      );
      expect(outcome.status).toBe('success');
      expect(chunks.join('')).toContain('helena-agent|Hallo|x/y');
    } finally {
      process.argv[1] = argv1;
    }
  });
});

test('native configuration preserves all instruction contributions and maps subscription fallback', () => {
  const config = helenaAgentConfig(
    {
      ...snapshot,
      runtimePolicy: {
        files: [
          {
            kind: 'instructions',
            path: 'SOUL.md',
            content: 'Soul\nOrganization\nProject\nContext contract',
          },
          { kind: 'instructions', path: 'AGENTS.md', content: 'Additional instruction' },
        ],
      },
      hermes: {
        fallbackModels: [
          { provider: 'openai-codex', model: 'gpt-6-astra' },
          { provider: 'openai', model: 'api-model' },
        ],
      },
    },
    [],
    { url: 'http://127.0.0.1:3000' },
  );
  expect(config.instructions).toBe(
    'Soul\nOrganization\nProject\nContext contract\n\nAdditional instruction',
  );
  expect(config.runtimeFallback).toBe('runtime:codex/gpt-6-astra');
  expect(config.fallbackModels).toEqual(['openai/api-model']);
});

describe('the command that starts the helena runtime', () => {
  const argv = ['--stdin-json', '--model', 'helena-halogen/flash'];
  it('runs the loop as a subcommand of this runner when it starts the command itself', () => {
    expect(commandFor(PRESETS.helena, argv, false, '/usr/bin/node', '/runner/cli.js')).toEqual([
      '/usr/bin/node',
      ['/runner/cli.js', 'helena-agent', ...argv],
    ]);
  });
  it('sends an isolated command only its own arguments; the launcher adds node, script and subcommand', () => {
    const [bin, args] = commandFor(PRESETS.helena, argv, true, '/usr/bin/node', '/runner/cli.js');
    expect(bin).toBe('helena-agent');
    expect(args).toEqual(argv);
    expect(args).not.toContain('/runner/cli.js');
  });
  it('leaves the other runtimes as they are', () => {
    expect(commandFor(PRESETS.hermes, ['chat'], true)).toEqual(['hermes', ['chat']]);
    expect(commandFor(PRESETS.hermes, ['chat'], false)).toEqual(['hermes', ['chat']]);
  });
});

test('queue limit is carried from the agent snapshot to its native loop config', () => {
  for (const localModelQueueSeconds of [0, 600]) {
    const config = helenaAgentConfig(
      { ...snapshot, helena: { ...snapshot.helena, localModelQueueSeconds } },
      [],
      { url: 'http://fixture.invalid' },
    );
    expect(config.limits?.localModelQueueSeconds).toBe(localModelQueueSeconds);
  }
});

test('native queue status reaches the event stream without entering the answer', async () => {
  const events: AgUiEvent[] = [];
  const stream = new AnswerStream('helena-jsonl', 'thread', 'run', async (batch) => {
    events.push(...batch);
  });
  stream.write(
    lines({
      type: 'status',
      status: 'model-queued',
      model: 'local/flash',
      message: 'Wartet auf freien Modellplatz',
      retryAfterMs: 1000,
      remainingMs: 180000,
    }),
  );
  await stream.flush();
  expect(events.find((event) => event.type === 'REASONING_MESSAGE_CONTENT')).toMatchObject({
    delta: 'Wartet auf freien Modellplatz\n',
  });
  expect(events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toBe(false);
  stream.write(lines({ type: 'text', delta: 'Done' }));
  await stream.finish('Done');
  expect(events.filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')).toEqual([
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-run', delta: 'Done' },
  ]);
});

test('native Home root tool is carried directly through the full profile', () => {
  const config = helenaAgentConfig(
    { ...snapshot, helena: { toolProfile: 'voll', coreTools: ['run_as_root'] } },
    [],
    { url: 'http://localhost:3000' },
  );
  expect(config.tools).toMatchObject({ profile: 'voll', core: ['run_as_root'] });
});

test('chat budget settings survive the API snapshot to native config binding', () => {
  const settings = {
    chatBudgetSeconds: 1200,
    chatBudgetBehavior: 'fail' as const,
    chatSummarySeconds: 30,
  };
  expect(
    helenaAgentConfig({ ...snapshot, helena: { ...snapshot.helena, ...settings } }, [], {
      url: 'http://localhost:3000',
    }).limits,
  ).toMatchObject(settings);
});

test('model step metrics reach the persisted AG-UI run timeline', async () => {
  const events: { type: string; name?: string; value?: unknown }[] = [];
  const stream = new AnswerStream('helena-jsonl', 'thread', '1', async (batch) => {
    events.push(...batch);
  });
  const metric = {
    type: 'usage',
    step: 3,
    model: 'local/w4b',
    inputTokens: 100,
    outputTokens: 20,
    reasoningTokens: 17,
    reasoningDurationMs: 800,
    durationMs: 1200,
  };
  stream.write(lines(metric));
  await stream.finish('');
  expect(
    events.find((event) => event.type === 'CUSTOM' && event.name === 'volition.model-step')?.value,
  ).toEqual(metric);
});
