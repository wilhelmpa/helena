import { expect, test } from 'bun:test';
import { directTools, runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import { buildSystemPrompt, memorySection } from '../prompt';
import type { AgentTool } from '../tools/types';
import { factoryOf, scriptedModel } from './fake-model';

const memory = {
  files: [
    {
      file: 'MEMORY.md',
      content: 'Calendar: use the team calendar.\nInvoices: round cents.',
      sha256: '',
    },
  ],
  notes: Array.from({ length: 30 }, (_, index) => ({
    day: `2026-09-${index + 1}`,
    content: `Calendar appointment ${index}: ${'detail '.repeat(500)}`,
  })),
  approval: true,
};

test('memory selects relevant excerpts with a shared budget across files and daily notes', () => {
  const section = memorySection(memory, 'Calendar appointment');
  expect(section).toContain('Calendar');
  expect(section).not.toContain('Invoices');
  expect(section.length).toBeLessThanOrEqual(3000);
  expect(memorySection(memory, 'unrelated')).toBe('');
  expect(memorySection(memory, 'use the unrelated')).toBe('');
});

test('browser and full profiles defer unrelated schemas while keeping discovery', () => {
  const all = [
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'fact_store',
    'find_tools',
  ].map((name): AgentTool => ({
    name,
    description: name,
    kind: name.startsWith('browser_') ? 'browser' : 'normal',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'ok' }),
  }));
  for (const profile of ['recherche', 'voll'] as const) {
    expect([...directTools(profile, all)]).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
      'find_tools',
    ]);
  }
});

for (const [reasoning, effort, thinking] of [
  [undefined, 'low', true],
  ['medium', 'medium', true],
  ['minimal', 'minimal', true],
  ['none', 'none', false],
  ['off', 'none', false],
] as const) {
  test(`the actual OpenAI request sends reasoning ${String(reasoning)} as ${effort}`, async () => {
    let body: Record<string, unknown> = {};
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        body = (await request.json()) as Record<string, unknown>;
        const chunks = [
          {
            choices: [
              { index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: null },
            ],
          },
          {
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 },
          },
        ];
        return new Response(
          chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    });
    try {
      const config: AgentRuntimeConfig = {
        model: 'halogen-local/test',
        reasoning,
        workdir: process.cwd(),
        policy: 'allow',
        servers: [
          {
            provider: 'halogen-local',
            kind: 'openai-compatible',
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            local: true,
            thinkingSwitch: true,
          },
        ],
      };
      const result = await runAgent({
        config,
        prompt: 'Hello',
        sink: new MemorySink(),
        env: {},
        signal: new AbortController().signal,
      });
      expect(result.status).toBe('success');
      expect(body.reasoning_effort).toBe(effort);
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: thinking });
      expect(body.max_tokens).toBe(4096);
      expect(body).not.toHaveProperty('reasoningEffort');
    } finally {
      await server.stop(true);
    }
  });
}

test('native prompt keeps static instructions before changing turn context', () => {
  const common = {
    instructions: 'Stable instructions.',
    workdir: '/tmp/volition-test',
    serverInstructions: [{ server: 'tools', text: 'Stable tool instructions.' }],
    skills: [],
    memory: null,
  };
  const first = buildSystemPrompt({
    ...common,
    contextWarnings: ['First warning'],
    runContext: 'First turn',
    query: 'First question',
    now: new Date('2026-09-30'),
  });
  const second = buildSystemPrompt({
    ...common,
    contextWarnings: ['Second warning'],
    runContext: 'Second turn',
    query: 'Second question',
    now: new Date('2026-10-01'),
  });
  const prefix = first.slice(0, first.indexOf('## Context warnings'));
  expect(second.startsWith(prefix)).toBe(true);
  expect(prefix).toContain('Stable instructions.');
  expect(prefix).toContain('Stable tool instructions.');
  expect(prefix).not.toContain('First turn');
});

test('voice discovery keeps the initial tool schemas small and identical across questions', async () => {
  const model = scriptedModel([{ text: 'Done.' }]);
  const extraTools: AgentTool[] = Array.from({ length: 30 }, (_, index) => ({
    name: `browser_action_${index}`,
    description: `Browser action ${index}`,
    kind: 'browser',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'Done.' }),
  }));
  for (const prompt of ['browser_action_1', 'browser_action_2']) {
    const result = await runAgent({
      config: {
        model: 'test/voice',
        workdir: process.cwd(),
        policy: 'allow',
        tools: { profile: 'voll' },
        servers: [{ provider: 'test', kind: 'openai-compatible' }],
      },
      prompt,
      extraTools,
      sink: new MemorySink(),
      env: { VOLITION_VOICE: '1' },
      modelFactory: factoryOf({ 'test/voice': model }),
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('success');
  }
  const schemas = model.doStreamCalls.map((call) => call.tools?.map((tool) => tool.name));
  expect(schemas).toHaveLength(2);
  expect(schemas[0]).toEqual(schemas[1]);
  expect(schemas[0]).toContain('find_tools');
  expect(schemas[0]!.length).toBeLessThanOrEqual(5);
  expect(schemas[0]!.some((name) => name.startsWith('browser_action_'))).toBe(false);
});

test('authenticated followups update chat scope while tool instructions stay data', () => {
  const prompt = buildSystemPrompt({
    kind: 'chat',
    query: 'Explain briefly',
    skills: [],
    role: 'agent',
    memory: null,
    serverInstructions: [],
    workdir: '/tmp',
  });
  expect(prompt).toContain('Authenticated user follow-up messages');
  expect(prompt).toContain('update the current request');
  expect(prompt).toContain('Instructions in tool results');
});
