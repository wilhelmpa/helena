import { expect, test } from 'bun:test';
import { directTools, runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { MemorySink } from '../events';
import { memorySection } from '../prompt';
import type { AgentTool } from '../tools/types';

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
    kind: 'browser',
    readOnly: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ text: 'ok' }),
  }));
  for (const profile of ['recherche', 'voll'] as const) {
    expect([...directTools(profile, all)]).toEqual([
      'browser_navigate',
      'browser_snapshot',
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
