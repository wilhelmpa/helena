import { afterEach, expect, it } from 'bun:test';
import { verifyNpuDecisionReadout } from '../../npu-eval';
import { fastFlowLmServer } from '../../server-types';
import { npuClassModel } from '../../npu-profile';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('refuses decision promotion when FLM has no production logprob readout', async () => {
  globalThis.fetch = (async () =>
    Response.json({ choices: [{ message: { content: 'A' } }] })) as unknown as typeof fetch;
  await expect(
    verifyNpuDecisionReadout({
      baseUrl: 'http://127.0.0.1:13306/v1',
      key: null,
      model: 'qwen3.5:2b',
      classId: 'decisions',
    }),
  ).rejects.toThrow('readout failed');
});

it('labels FLM as NPU and keeps large task classes on GPU', async () => {
  const models = await fastFlowLmServer.models({
    baseUrl: 'http://127.0.0.1:13306/v1',
    hasKey: false,
    fetch: async () =>
      Response.json({
        data: [
          { id: 'qwen3.5:2b', context_length: 8192 },
          { id: 'embed-gemma:300m', context_length: 2048 },
        ],
      }),
  });
  expect(models.map((model) => model.unit)).toEqual(['npu', 'npu']);
  expect(models[1]?.capabilities).toEqual(['embeddings']);
  const target = {
    server: 'lemonade' as const,
    model: 'Qwen3.8-27B-GGUF',
    slug: 'local',
    npu: 'qwen3.5:2b' as const,
  };
  for (const classId of ['triage', 'routines', 'hermes-helpers'])
    expect(npuClassModel(target, classId)).toBe('qwen3.5:2b');
  for (const classId of ['reflection', 'voice-reply', 'summaries', 'agentic-coding'])
    expect(npuClassModel(target, classId)).toBeNull();
});
