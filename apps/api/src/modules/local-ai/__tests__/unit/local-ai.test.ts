import { describe, expect, it } from 'bun:test';
import {
  allowedKeyFile,
  defaultLocalAiPolicy,
  normalizeLocalAiPolicy,
  routeFor,
  type ModelServerRow,
} from '@repo/db';
import {
  isLocalProvider,
  localModelId,
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
  unitOf,
} from '../../server-types';
import {
  ROUTINE_CASES,
  TRIAGE_CASES,
  evaluateRoutines,
  evaluateTriage,
  firstJson,
  withoutThinking,
} from '../../evals';
import { atomTags, familyOf, newerInFamily } from '../../integrations';

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
    const refusal = (policy: typeof on, servers = [server()], requireUp?: boolean) => {
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
function fakeContext(answer: (prompt: string) => { text?: string; tool?: [string, object] }) {
  return {
    model: 'fake',
    async chat(request) {
      const out = answer(request.prompt);
      return {
        text: out.text ?? '',
        toolCalls: out.tool ? [{ name: out.tool[0], arguments: JSON.stringify(out.tool[1]) }] : [],
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
