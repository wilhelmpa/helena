import { afterEach, expect, it } from 'bun:test';
import {
  NpuDecisionReadoutError,
  npuDecisionTimeoutMs,
  verifyNpuDecisionReadout,
} from '../../npu-eval';
import { GENERIC_EVAL } from '#modules/decisions/evals/generic';
import { fastFlowLmServer } from '../../server-types';
import { npuClassModel } from '../../npu-profile';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('configures timeouts by backend/model with an unchanged 5-second default', () => {
  const configuration = JSON.stringify({
    fastflowlm: { '*': 12_000, 'gemma4-it:e2b': 30_000 },
    lemonade: { 'gemma4-it:e2b': 20_000 },
  });
  expect(npuDecisionTimeoutMs('fastflowlm', 'gemma4-it:e2b', undefined, '')).toBe(5_000);
  expect(npuDecisionTimeoutMs('fastflowlm', 'gemma4-it:e2b', undefined, configuration)).toBe(
    30_000,
  );
  expect(npuDecisionTimeoutMs('lemonade', 'gemma4-it:e2b', undefined, configuration)).toBe(20_000);
  expect(npuDecisionTimeoutMs('fastflowlm', 'other', undefined, configuration)).toBe(12_000);
  expect(npuDecisionTimeoutMs('other', 'gemma4-it:e2b', undefined, configuration)).toBe(5_000);
  expect(npuDecisionTimeoutMs('fastflowlm', 'gemma4-it:e2b', 40_000, configuration)).toBe(40_000);
  for (const value of [0, -1, 1.5, NaN, Infinity])
    expect(() => npuDecisionTimeoutMs('fastflowlm', 'gemma4-it:e2b', value, '')).toThrow(
      'positive integer',
    );
  expect(() =>
    npuDecisionTimeoutMs('fastflowlm', 'bad', undefined, '{"fastflowlm":{"bad":"30000"}}'),
  ).toThrow('positive integer');
});

async function failedReadout(timeoutMs = 5_000) {
  try {
    await verifyNpuDecisionReadout({
      baseUrl: 'http://127.0.0.1:13306/v1',
      key: null,
      model: 'gemma4-it:e2b',
      classId: 'decisions',
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof NpuDecisionReadoutError) return error.report;
    throw error;
  }
  throw new Error('Expected readout failure');
}

it('reports expired requests separately from decision failures and still refuses promotion', async () => {
  globalThis.fetch = (async (_input, init) => {
    const signal = init!.signal!;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  const report = await failedReadout(1);
  expect(report.timeoutMs).toBe(1);
  expect(report.timeouts).toHaveLength(GENERIC_EVAL.cases.length);
  expect(report.failures).toEqual([]);
  expect(report.errors).toEqual([]);
  expect(report.passed).toBe(false);
  expect(report.threshold).toBe(0.85);
  expect(report.coverage).toBe(0);
});

it('counts wrong logprob decisions as decision failures without timeouts', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      choices: [{ logprobs: { content: [{ top_probs: [{ token: 'A', prob: 1 }] }] } }],
    })) as unknown as typeof fetch;
  const report = await failedReadout(30_000);
  expect(report.timeouts).toEqual([]);
  expect(report.errors).toEqual([]);
  expect(report.failures.length).toBeGreaterThan(0);
  expect(report.threshold).toBe(0.85);
  expect(report.passed).toBe(false);
});

it('keeps missing logprobs and socket errors separate from wrong decisions', async () => {
  for (const socketError of [false, true]) {
    globalThis.fetch = (async () => {
      if (socketError) throw new Error('The socket connection was closed unexpectedly.');
      return Response.json({ choices: [{ message: { content: 'A' } }] });
    }) as unknown as typeof fetch;
    const report = await failedReadout();
    expect(report.timeouts).toEqual([]);
    expect(report.failures).toEqual([]);
    expect(report.errors).toHaveLength(GENERIC_EVAL.cases.length);
    expect(report.errors[0]?.error).toContain(
      socketError ? 'socket connection' : 'log probabilities',
    );
    expect(report.passed).toBe(false);
  }
});

it('passes unchanged precision and coverage requirements with correct logprobs', async () => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    const asked = JSON.parse(body.messages[1].content) as {
      evidence: string;
      question: string;
      options: { letter: string; option: string }[];
    };
    const item = GENERIC_EVAL.cases.find((item) => item.context === asked.evidence)!;
    const question = Object.entries(item.questions).find(
      ([, question]) => question.question === asked.question,
    )![0];
    const expected = [item.expected[question]].flat()[0];
    const letter = asked.options.find((option) => option.option.startsWith(`${expected}:`))!.letter;
    await Bun.sleep(5);
    return Response.json({
      choices: [{ logprobs: { content: [{ top_probs: [{ token: letter, prob: 1 }] }] } }],
    });
  }) as unknown as typeof fetch;
  const report = await verifyNpuDecisionReadout({
    baseUrl: 'http://127.0.0.1:13306/v1',
    key: null,
    model: 'gemma4-it:e2b',
    classId: 'decisions',
    timeoutMs: 50,
  });
  expect(report?.passed).toBe(true);
  expect(report?.precision).toBe(1);
  expect(report?.coverage).toBe(1);
  expect(report?.timeouts).toEqual([]);
  expect(report?.failures).toEqual([]);
  expect(report?.errors).toEqual([]);
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
