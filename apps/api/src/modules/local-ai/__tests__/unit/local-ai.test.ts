import { describe, expect, it } from 'bun:test';
import {
  allowedKeyFile,
  defaultLocalAiPolicy,
  normalizeLocalAiPolicy,
  routeFor,
  type LocalAiPolicy,
  type ModelServerRow,
} from '@repo/db';
import { capacityFromStatus, type PressureStatus } from '../../pressure';
import {
  classEvalVersion,
  classModes,
  isLocalProvider,
  isModelServerSlug,
  localProviderWithoutThinking,
  localModelId,
  localThinkingFields,
  normalizeLocalModel,
  parseLocalModelId,
  type LocalAiEvalContext,
  type LocalModel,
} from '@helena/sdk';
import {
  capabilitiesOf,
  lemonadeLoad,
  lemonadeLoaded,
  lemonadeModel,
  lemonadeNoThinkingBaseUrl,
  unitOf,
} from '../../server-types';
import {
  COORDINATOR_CASES,
  REFLECTION_CASES,
  ROUTINE_CASES,
  TRIAGE_CASES,
  evaluateCoordinatorTriage,
  evaluateReflection,
  evaluateRoutines,
  evaluateTriage,
  firstJson,
  withoutThinking,
} from '../../evals';
import {
  classBlocker,
  effectiveModel,
  localCatalogModels,
  runtimeLocalAi,
  type EvalView,
} from '../../service';
import { atomTags, familyOf, newerInFamily } from '../../integrations';
import { BUILTIN_TASK_CLASSES } from '../../task-classes';
import { openAiEvalContext } from '../../eval-context';

// Local AI's pure parts (docs/helena-decisions/local-ai-platform.md): model ids, what
// Lemonade answers, the policy and its routes, the evals' checking, the update check's
// version reading.

function model(id: string, fields: Partial<LocalModel> = {}): LocalModel {
  return {
    id,
    name: id,
    unit: 'gpu',
    capabilities: ['chat', 'tools'],
    contextLength: 131072,
    sizeBytes: null,
    downloaded: true,
    loaded: false,
    backend: 'llamacpp',
    ...fields,
  };
}

function server(fields: Partial<ModelServerRow> = {}): ModelServerRow {
  return {
    id: 1,
    slug: 'local',
    kind: 'lemonade',
    name: 'Lokale KI',
    baseUrl: 'http://127.0.0.1:13305/api/v1',
    keySource: 'none',
    keyFile: null,
    enabled: true,
    contextLength: 65536,
    options: {},
    models: [
      model('Qwen3.6-35B-A3B-GGUF', { loaded: true }),
      model('Qwen3-Embedding-0.6B-GGUF', { capabilities: ['embeddings'] }),
    ],
    status: { reachable: true, version: '2026.39.1', latencyMs: 3, error: null, loaded: [] },
    checkedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  };
}

describe('device policy for explicitly selected local models', () => {
  const models = [
    model('GPU-model'),
    model('NPU-model', { unit: 'npu', backend: 'flm' }),
    model('CPU-model', { unit: 'cpu', backend: 'cpu' }),
    model('Missing-model', { downloaded: false }),
    model('Embedding-model', { capabilities: ['embeddings'] }),
  ];

  it('keeps enabled devices in the picker, runtime and direct route without mutating policy', () => {
    for (const disabled of ['gpu', 'npu', 'cpu'] as const) {
      const policy = { ...defaultLocalAiPolicy(), enabled: true };
      policy.units[disabled] = false;
      const servers = [server({ models })];
      const before = JSON.stringify({ policy, servers });
      const expected = models.filter(
        (entry) =>
          entry.unit !== disabled &&
          entry.downloaded !== false &&
          entry.capabilities.includes('chat'),
      );
      expect(localCatalogModels(policy, servers).map((entry) => entry.id)).toEqual(
        expected.map((entry) => localModelId('local', entry.id)),
      );
      expect(runtimeLocalAi(policy, servers)?.servers[0]?.models.map((entry) => entry.id)).toEqual(
        expected.map((entry) => entry.id),
      );
      for (const entry of models) {
        const id = localModelId('local', entry.id);
        expect(effectiveModel(id, policy, servers)).toBe(expected.includes(entry) ? id : null);
      }
      expect(effectiveModel('gpt-6-luna', policy, servers)).toBe('gpt-6-luna');
      expect(JSON.stringify({ policy, servers })).toBe(before);
    }
  });

  it('preserves all enabled devices and compatible servers with unknown hardware', () => {
    const policy = { ...defaultLocalAiPolicy(), enabled: true };
    const servers = [server({ models: [...models, model('Remote-compatible', { unit: null })] })];
    expect(localCatalogModels(policy, servers).map((entry) => entry.id)).toEqual(
      ['GPU-model', 'NPU-model', 'CPU-model', 'Remote-compatible'].map((id) =>
        localModelId('local', id),
      ),
    );
    const allOff = { ...policy, units: { gpu: false, npu: false, cpu: false } };
    expect(runtimeLocalAi(allOff, servers)).toBeNull();
    expect(localCatalogModels(allOff, servers)).toEqual([]);
    expect(effectiveModel('helena-local/Remote-compatible', allOff, servers)).toBeNull();
  });

  it('does not replace existing model or class choices when an additional model appears', () => {
    const policy: LocalAiPolicy = {
      ...defaultLocalAiPolicy(),
      enabled: true,
      classes: { summaries: { mode: 'prefer', model: 'helena-local/GPU-model' } },
    };
    const before = JSON.stringify(policy);
    const servers = [server({ models: [...models, model('Qwen3.8-27B-GGUF')] })];
    expect(localCatalogModels(policy, servers).map((entry) => entry.id)).toContain(
      'helena-local/Qwen3.8-27B-GGUF',
    );
    expect(effectiveModel('helena-local/GPU-model', policy, servers)).toBe(
      'helena-local/GPU-model',
    );
    expect(JSON.stringify(policy)).toBe(before);
  });
});

describe('local model ids', () => {
  it('names a local model by its provider and keeps others apart', () => {
    expect(localModelId('local', 'Qwen3.6-35B-A3B-GGUF')).toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
    expect(parseLocalModelId('helena-local/Qwen3.6-35B-A3B-GGUF')).toEqual({
      provider: 'helena-local',
      slug: 'local',
      model: 'Qwen3.6-35B-A3B-GGUF',
    });
    // A HF-style id with a slash of its own stays whole.
    expect(parseLocalModelId('helena-lan/Qwen/Qwen3-8B')?.model).toBe('Qwen/Qwen3-8B');
    for (const other of ['gpt-5.6-luna', 'openai/gpt-oss-120b', 'helena-/x', null, undefined]) {
      expect(parseLocalModelId(other)).toBeNull();
    }
    expect(isLocalProvider('helena-local')).toBe(true);
    expect(isLocalProvider('custom:helena-local')).toBe(true);
    expect(isLocalProvider('openai-codex')).toBe(false);
  });

  it("names a server's provider without thinking at its other address", () => {
    expect(localProviderWithoutThinking('helena-local')).toBe('helena-local--nothink');
    expect(localProviderWithoutThinking('helena-local--nothink')).toBe('helena-local--nothink');
    expect(isLocalProvider(localProviderWithoutThinking('helena-local'))).toBe(true);
    // No slug may end up as another server's provider without thinking.
    expect(isModelServerSlug('local')).toBe(true);
    expect(isModelServerSlug('local--nothink')).toBe(false);
    expect(lemonadeNoThinkingBaseUrl('http://127.0.0.1:13305/api/v1')).toBe(
      'http://127.0.0.1:13305/v1',
    );
    expect(lemonadeNoThinkingBaseUrl('http://127.0.0.1:13305/v1/')).toBe(
      'http://127.0.0.1:13305/api/v1',
    );
    expect(lemonadeNoThinkingBaseUrl('http://lan-box:8080/openai')).toBeNull();
  });

  it('keeps only what a model entry may carry', () => {
    expect(normalizeLocalModel({ id: 'bad id with spaces' })).toBeNull();
    const kept = normalizeLocalModel({
      id: 'm',
      unit: 'tpu',
      capabilities: ['chat', 'chat', 'teleport'],
      contextLength: -1,
      checkpoint: 'unsloth/x:file.gguf',
    });
    expect(kept).toMatchObject({ unit: null, capabilities: ['chat'], contextLength: null });
    expect(kept?.checkpoint).toBe('unsloth/x:file.gguf');
  });
});

describe('what Lemonade answers', () => {
  it('reads models with their engine, unit and abilities', () => {
    const entry = lemonadeModel(
      {
        id: 'Qwen3.6-35B-A3B-GGUF',
        recipe: 'llamacpp',
        labels: ['tool-calling', 'vision', 'hot'],
        size: 23.3,
        downloaded: true,
        context_length: 262144,
        checkpoint: 'unsloth/Qwen3.6-35B-A3B-GGUF:Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf',
      },
      new Set(['Qwen3.6-35B-A3B-GGUF']),
    );
    expect(entry).toMatchObject({
      unit: 'gpu',
      capabilities: ['chat', 'tools', 'vision'],
      sizeBytes: 23_300_000_000,
      loaded: true,
      contextLength: 262144,
    });
    expect(unitOf('flm', null)).toBe('npu');
    expect(unitOf(null, 'npu')).toBe('npu');
    expect(unitOf('llamacpp', 'cpu')).toBe('cpu');
    expect(capabilitiesOf(['embeddings'], 'x')).toEqual(['embeddings']);
    expect(capabilitiesOf([], 'whisper-v3-turbo-FLM')).toEqual(['transcription']);
  });

  it('reads what is loaded and how busy the machine is', () => {
    const loaded = lemonadeLoaded({
      status: 'ok',
      model_loaded: 'embed-gemma-300m-FLM',
      all_models_loaded: [
        { model_name: 'Qwen3.6-35B-A3B-GGUF', recipe: 'llamacpp', device: 'gpu' },
        { model_name: 'embed-gemma-300m-FLM', recipe: 'flm', device: 'npu' },
      ],
    });
    expect(loaded.map((entry) => [entry.id, entry.unit])).toEqual([
      ['Qwen3.6-35B-A3B-GGUF', 'gpu'],
      ['embed-gemma-300m-FLM', 'npu'],
    ]);
    expect(lemonadeLoad({ gpu_percent: 40, npu_percent: 5, vram_gb: 22.1 })).toEqual({
      gpuPercent: 40,
      npuPercent: 5,
      cpuPercent: null,
      vramGb: 22.1,
      memoryGb: null,
    });
    expect(lemonadeLoad({})).toBeNull();
  });
});

describe('the policy and its routes', () => {
  it('drops what a stored policy may not carry', () => {
    const policy = normalizeLocalAiPolicy({
      enabled: true,
      units: { gpu: false, qpu: true },
      classes: {
        triage: { mode: 'prefer', model: 'helena-local/x' },
        'Bad Id': { mode: 'prefer' },
        summaries: { mode: 'always', model: 'gpt-5' },
      },
      preset: 'turbo',
    });
    expect(policy.units).toEqual({ gpu: false, npu: true, cpu: true });
    expect(policy.classes).toEqual({
      triage: { mode: 'prefer', model: 'helena-local/x' },
      summaries: { mode: 'off', model: null },
    });
    expect(policy.preset).toBe('ausgewogen');
    expect(policy.halogenPriority).toEqual(defaultLocalAiPolicy().halogenPriority);
    expect(
      normalizeLocalAiPolicy({ halogenPriority: { voiceReplyMaxTokens: 4_097 } }).halogenPriority
        .voiceReplyMaxTokens,
    ).toBe(512);
    expect(
      normalizeLocalAiPolicy({
        halogenPriority: {
          maxConcurrent: 2,
          reservedInteractive: 3,
          maxBackground: 2,
          queueTimeoutMs: 5_000,
        },
      }).halogenPriority,
    ).toEqual({
      maxConcurrent: 2,
      reservedInteractive: 1,
      maxInteractive: 2,
      maxRealtime: 2,
      maxNormal: 1,
      maxBackground: 1,
      realtimeQueueMs: 750,
      interactiveQueueMs: 5_000,
      agingMs: 15_000,
      healthProbeMs: 3_000,
      healthTimeoutMs: 2_000,
      upstreamIdleMs: 60_000,
      voiceReplyMaxTokens: 512,
      realtimeMaxTokens: 64,
      queueTimeoutMs: 5_000,
      maxQueue: 64,
      maxQueuedInteractive: 16,
      maxQueuedRealtime: 16,
      maxQueuedNormal: 32,
      maxQueuedBackground: 24,
    });
    expect(defaultLocalAiPolicy().enabled).toBe(false);
  });

  it('routes a class only while everything on its way is on', () => {
    const on = {
      ...defaultLocalAiPolicy(),
      enabled: true,
      classes: { 'hermes-helpers': { mode: 'prefer' as const, model: null } },
    };
    const input = { classId: 'hermes-helpers', unit: 'gpu' as const, capability: 'chat' as const };
    const routed = routeFor({ ...input, policy: on, servers: [server()] });
    expect('route' in routed && routed.route.modelId).toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
    const refusal = (policy: LocalAiPolicy, servers = [server()], requireUp?: boolean) => {
      const result = routeFor({ ...input, policy, servers, requireUp });
      return 'refusal' in result ? result.refusal : 'routed';
    };
    expect(refusal({ ...on, enabled: false })).toBe('master-off');
    expect(refusal({ ...on, classes: {} })).toBe('class-off');
    expect(refusal({ ...on, units: { gpu: false, npu: true, cpu: true } })).toBe('unit-off');
    expect(refusal(on, [server({ enabled: false })])).toBe('no-server');
    const down = server({
      status: { reachable: false, version: null, latencyMs: null, error: 'x', loaded: [] },
    });
    expect(refusal(on, [down])).toBe('server-down');
    // Embeddings keep their model while the server is down.
    expect(refusal(on, [down], false)).toBe('routed');
    expect(refusal(on, [server({ models: [model('e', { capabilities: ['embeddings'] })] })])).toBe(
      'no-model',
    );
    // A model whose newest eval failed (after an update) is not used, even with the class on.
    const failed = new Set(['helena-local/Qwen3.6-35B-A3B-GGUF']);
    const gated = routeFor({ ...input, policy: on, servers: [server()], failed });
    expect('refusal' in gated && gated.refusal).toBe('eval-failed');
  });

  it('reads a key file only below /etc/helena', () => {
    expect(allowedKeyFile('/etc/helena/local-ai.key')).toBe('/etc/helena/local-ai.key');
    expect(allowedKeyFile('/etc/volition/plan.env')).toBeNull();
    expect(allowedKeyFile('/etc/helena/../volition/plan.env')).toBeNull();
    expect(allowedKeyFile('/etc/helena')).toBeNull();
    expect(allowedKeyFile(null)).toBeNull();
  });
});

// A fake model: answers each case from a table, so the checking itself is what is tested.
function fakeContext(
  answer: (prompt: string) => {
    text?: string;
    tool?: [string, object];
    tools?: [string, object][];
  },
) {
  return {
    model: 'fake',
    async chat(request) {
      const out = answer(request.prompt);
      const calls = [...(out.tool ? [out.tool] : []), ...(out.tools ?? [])];
      return {
        text: out.text ?? '',
        toolCalls: calls.map(([name, args]) => ({ name, arguments: JSON.stringify(args) })),
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 50,
      };
    },
    async embed() {
      return { vectors: [], latencyMs: 1 };
    },
  } satisfies LocalAiEvalContext;
}

describe('the evals', () => {
  it('reads answers the way models give them', () => {
    expect(withoutThinking('<think>hmm {"label":"x"}</think>{"label":"bug"}')).toBe(
      '{"label":"bug"}',
    );
    expect(firstJson('Sure! {"label": "ops"} done')).toEqual({ label: 'ops' });
    expect(firstJson('no json')).toBeNull();
  });

  it('scores triage by the label, and names what went wrong', async () => {
    const perfect = await evaluateTriage(
      fakeContext((prompt) => ({
        text: JSON.stringify({ label: TRIAGE_CASES.find((c) => c.text === prompt)!.label }),
      })),
    );
    expect(perfect.score).toBe(1);
    expect(perfect.tokensPerSecond).toBeCloseTo(400);
    const wrong = await evaluateTriage(fakeContext(() => ({ text: '{"label":"bug"}' })));
    expect(wrong.score).toBeLessThan(0.5);
    expect(wrong.cases.find((c) => !c.passed)?.detail).toContain('expected');
  });

  it('checks the tool and its arguments', async () => {
    const right = await evaluateRoutines(
      fakeContext((prompt) => {
        const item = ROUTINE_CASES.find((c) => c.prompt === prompt)!;
        const args: Record<string, string> = {
          r1: '{"project":"VOL","title":"Impressum prüfen","due":"2026-10-01"}',
          r2: '{"task":"VOL-12","text":"Backup läuft wieder."}',
          r3: '{"task":"VERVE-7","status":"done"}',
          r4: '{"query":"Retourenregelung"}',
          r5: '{"task":"FAM-3","status":"review"}',
          r6: '{"project":"PRIV","title":"Steuererklärung vorbereiten"}',
          r7: '{"task":"VERVE-21","text":"Texte sind online"}',
          r8: '{"query":"Newsletter-Tool"}',
        };
        return { tool: [item.tool, JSON.parse(args[item.id]!)] };
      }),
    );
    expect(right.score).toBe(1);
    const talking = await evaluateRoutines(fakeContext(() => ({ text: 'I would create a task.' })));
    expect(talking.score).toBe(0);
    expect(talking.cases[0]?.detail).toContain('no tool call');
  });

  it("offers the routines a toolset of an agent's size, not only the four it needs", async () => {
    const offered: number[] = [];
    await evaluateRoutines({
      ...fakeContext(() => ({ text: '' })),
      async chat(request) {
        offered.push(request.tools?.length ?? 0);
        return { text: '', toolCalls: [], inputTokens: 1, outputTokens: 1, latencyMs: 1 };
      },
    });
    expect(offered.every((count) => count === 22)).toBe(true);
  });

  it('keeps the right fact in a reflection, nothing of a trivial task, and never a secret', async () => {
    const byCase = (prompt: string) =>
      [...REFLECTION_CASES]
        .sort((a, b) => b.session.length - a.session.length)
        .find((c) => prompt.includes(c.session))!;
    const baseId = (id: string) => id.split('-trap-')[0]!;
    const keep: Record<string, [string, object][]> = {
      f1: [
        ['memory', { action: 'add', target: 'user', content: 'Berichte auf Deutsch, Stichpunkte' }],
      ],
      f2: [
        [
          'memory',
          {
            action: 'add',
            target: 'memory',
            content: 'Staging: bun run deploy:staging in apps/shop',
          },
        ],
      ],
      f3: [
        [
          'skill_manage',
          { action: 'create', name: 'shopify-bulk-prices', content: 'Use a bulk operation' },
        ],
      ],
      f4: [
        [
          'skill_manage',
          {
            action: 'create',
            name: 'restic-cleanup',
            content: 'restic forget …, then restic prune, then check',
          },
        ],
      ],
      f5: [],
      f6: [
        [
          'memory',
          {
            action: 'add',
            target: 'memory',
            content: 'Newsletter API: key in the X-Api-Key header',
          },
        ],
      ],
    };
    const right = await evaluateReflection(
      fakeContext((prompt) => {
        const tools = keep[baseId(byCase(prompt).id)]!;
        return tools.length ? { tools } : { text: 'Nothing to save.' };
      }),
    );
    expect(right.score).toBe(1);
    // The same, but keeping the key itself and a note of the trivial task.
    const careless = await evaluateReflection(
      fakeContext((prompt) => {
        const item = byCase(prompt);
        if (baseId(item.id) === 'f5')
          return {
            tool: ['memory', { action: 'add', target: 'memory', content: 'FAM-11 renamed' }],
          };
        if (baseId(item.id) === 'f6')
          return {
            tool: [
              'memory',
              { action: 'add', target: 'memory', content: 'X-Api-Key sk-live-4f9a2b7c1d' },
            ],
          };
        return { tools: keep[baseId(item.id)]! };
      }),
    );
    expect(careless.cases.filter((c) => !c.passed).map((c) => [c.id, c.detail])).toEqual([
      ...REFLECTION_CASES.filter((item) => baseId(item.id) === 'f5').map((item) => [
        item.id,
        'kept 1 entries of a trivial task',
      ]),
      ...REFLECTION_CASES.filter((item) => baseId(item.id) === 'f6').map((item) => [
        item.id,
        'kept a secret',
      ]),
    ]);
  });

  it("reads a coordinator's plan with the stage's own parser", async () => {
    const plans: Record<string, object> = {
      k1: {
        summary: 'Fix',
        delegations: [
          assignment('fix', 'agent:coder-verve'),
          assignment('test', 'agent:qa-verve', ['fix']),
        ],
      },
      k2: { summary: 'Texts', delegations: [assignment('texts', 'agent:content-verve')] },
      k3: {
        summary: 'Texts, then page',
        delegations: [
          assignment('texts', 'agent:content-verve'),
          assignment('page', 'agent:coder-verve', ['texts']),
        ],
      },
      k4: {
        summary: 'Export and article',
        delegations: [
          assignment('export', 'agent:coder-verve'),
          assignment('article', 'agent:content-verve', ['export']),
        ],
      },
      k5: { summary: 'Check', delegations: [assignment('check', 'agent:qa-verve')] },
    };
    const title = (prompt: string) =>
      COORDINATOR_CASES.find((c) => prompt.includes(`Task title: ${c.title}`))!;
    const right = await evaluateCoordinatorTriage(
      fakeContext((prompt) => ({
        text: '```json\n' + JSON.stringify(plans[title(prompt).id]) + '\n```',
      })),
    );
    expect(right.score).toBe(1);
    const wrong = await evaluateCoordinatorTriage(
      fakeContext((prompt) => {
        const item = title(prompt);
        // k3 in parallel, k2 to the coder, k5 as prose.
        if (item.id === 'k3')
          return {
            text: JSON.stringify({
              summary: 'x',
              delegations: [
                assignment('a', 'agent:content-verve'),
                assignment('b', 'agent:coder-verve'),
              ],
            }),
          };
        if (item.id === 'k2')
          return {
            text: JSON.stringify({
              summary: 'x',
              delegations: [assignment('a', 'agent:coder-verve')],
            }),
          };
        if (item.id === 'k5') return { text: 'QA should check the iPhone.' };
        return { text: JSON.stringify(plans[item.id]) };
      }),
    );
    expect(wrong.score).toBeCloseTo(0.4);
    expect(wrong.cases.find((c) => c.id === 'k3')?.detail).toContain('does not wait');
    expect(wrong.cases.find((c) => c.id === 'k2')?.detail).toContain('assigned agent:coder-verve');
  });
});

function assignment(id: string, agentRef: string, dependsOn: string[] = []) {
  return {
    assignmentId: id,
    agentRef,
    objective: `Do ${id}.`,
    acceptanceCriteria: ['Done'],
    dependsOn,
  };
}

describe('kinds of work that run as an agent turn', () => {
  const of = (id: string) => BUILTIN_TASK_CLASSES.find((entry) => entry.id === id)!;

  it('offer off and prefer only, since the agent keeps its configured model as fallback', () => {
    for (const id of [
      'hermes-helpers',
      'summaries',
      'routines',
      'reflection',
      'coordinator-triage',
    ]) {
      expect(classModes(of(id))).toEqual(['off', 'prefer']);
    }
    expect(classModes(of('embeddings'))).toEqual(['off', 'prefer', 'only']);
    // `off` is always offered, whatever a plugin's class lists.
    expect(classModes({ modes: ['only'] })).toEqual(['off', 'only']);
  });

  it('keep standalone eval classes outside automatic routing', () => {
    const wired = BUILTIN_TASK_CLASSES.filter((entry) => !entry.wired).map((entry) => entry.id);
    expect(wired).toEqual(['skill-usage', 'skill-learning', 'agentic-coding', 'deutsch-texte']);
  });

  it('need an eval of their current version', () => {
    const entry = of('summaries');
    expect(classEvalVersion(entry)).toBe(2);
    expect(classEvalVersion(of('embeddings'))).toBe(1);
    const view = (evalVersion: number, passed = true): EvalView => ({
      id: 1,
      classId: 'summaries',
      modelId: 'helena-local/Q',
      score: passed ? 1 : 0,
      score100: null,
      threshold: 0.75,
      passed,
      cases: 4,
      details: [],
      latencyMsP50: null,
      tokensPerSecond: null,
      error: null,
      evalVersion,
      status: 'done',
      ranAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    expect(classBlocker(entry, 'helena-local/Q', [view(1)])).toBe('eval-missing');
    expect(classBlocker(entry, 'helena-local/Q', [view(2)])).toBeNull();
    expect(classBlocker(entry, 'helena-local/Q', [view(2, false)])).toBe('eval-failed');
  });
});

describe('thinking', () => {
  it('switches a reasoning model off through the chat template, or on with a level', () => {
    expect(localThinkingFields('off')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(localThinkingFields('low')).toEqual({
      chat_template_kwargs: { enable_thinking: true, reasoning_effort: 'low' },
    });
  });

  it('keeps the helpers and the reflection off, and every chat class declares it', () => {
    const of = (id: string) => BUILTIN_TASK_CLASSES.find((entry) => entry.id === id)?.thinking;
    expect(of('hermes-helpers')).toBe('off');
    // They run as an agent's turn on the local model, which thinks (runner local-ai.ts); the
    // reflection runs on the provider without thinking.
    expect(of('summaries')).toBe('low');
    expect(of('reflection')).toBe('off');
    expect(of('routines')).toBe('low');
    expect(of('coordinator-triage')).toBe('low');
    for (const entry of BUILTIN_TASK_CLASSES) {
      if (entry.capability === 'chat' || entry.capability === 'tools') {
        expect(entry.thinking).toBeDefined();
      }
    }
  });

  it("sends the class's level with every eval call, and a call's own level over it", async () => {
    const bodies: Record<string, unknown>[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: '{}' } }] });
    }) as typeof fetch;
    try {
      const context = openAiEvalContext({
        baseUrl: 'http://127.0.0.1:1/v1',
        key: null,
        model: 'm',
        thinking: 'off',
      });
      await context.chat({ prompt: 'a' });
      await context.chat({ prompt: 'b', thinking: 'high' });
    } finally {
      globalThis.fetch = original;
    }
    expect(bodies[0]?.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[1]?.chat_template_kwargs).toEqual({
      enable_thinking: true,
      reasoning_effort: 'high',
    });
  });
});

describe('the update check', () => {
  it('reads release tags without candidates, and a newer model of the same family', () => {
    const feed = [
      '<link rel="alternate" type="text/html" href="https://github.com/lemonade-sdk/lemonade/releases/tag/candidate-v2026.40.0"/>',
      '<link rel="alternate" type="text/html" href="https://github.com/lemonade-sdk/lemonade/releases/tag/v2026.39.1"/>',
      '<link rel="alternate" type="text/html" href="https://github.com/lemonade-sdk/lemonade/releases/tag/v11.9.0"/>',
    ].join('\n');
    expect(atomTags(feed)).toEqual(['v2026.39.1', 'v11.9.0']);
    expect(familyOf('Qwen3.6-35B-A3B-GGUF')).toEqual({
      head: 'Qwen',
      version: '3.6',
      tail: '-35B-A3B-GGUF',
    });
    expect(
      newerInFamily('unsloth/Qwen3.6-35B-A3B-GGUF', [
        'unsloth/Qwen3.7-35B-A3B-GGUF',
        'unsloth/Qwen3.8-27B-GGUF',
        'other/Qwen3.9-35B-A3B-GGUF',
        'unsloth/Qwen3.5-35B-A3B-GGUF',
      ]),
    ).toBe('unsloth/Qwen3.7-35B-A3B-GGUF');
    expect(newerInFamily('unsloth/Qwen3.6-35B-A3B-GGUF', [])).toBeNull();
  });
});

describe('the key file', () => {
  it('is the one the installer writes', async () => {
    const here = import.meta.dir;
    const service = await Bun.file(`${here}/../../service.ts`).text();
    const installer = await Bun.file(
      `${here}/../../../../../../../deployment/volition-stack/native/local-ai/install.sh`,
    ).text();
    // The preload unit hands the same file over as a credential (HELENA_AI_KEY_FILE).
    expect(installer).toContain('KEY=${HELENA_AI_KEY_FILE:-$ETC/local-ai.key}');
    expect(service).toContain('DEFAULT_KEY_FILE = `${LOCAL_AI_KEY_DIR}/local-ai.key`');
    expect(allowedKeyFile('/etc/helena/local-ai.key')).toBe('/etc/helena/local-ai.key');
  });
});

describe('Halogen start pressure', () => {
  it('defers background starts during chat, full slots, and stalls', () => {
    const status: PressureStatus = {
      healthy: true,
      active: { interactive: 0, realtime: 0, normal: 0, background: 0 },
      queued: { interactive: 0, realtime: 0, normal: 0, background: 0 },
      config: { maxConcurrent: 4, reservedInteractive: 1, maxBackground: 2, maxNormal: 3 },
    };
    expect(capacityFromStatus('background', status)).toBe(true);
    status.active.interactive = 1;
    expect(capacityFromStatus('background', status)).toBe(false);
    status.active.interactive = 0;
    status.active.normal = 3;
    expect(capacityFromStatus('normal', status)).toBe(false);
    status.healthy = false;
    expect(capacityFromStatus('background', status)).toBe(false);
  });
});
