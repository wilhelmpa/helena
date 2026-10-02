import { expect, test } from 'bun:test';
import { runAgent } from '../agent';
import type { AgentRuntimeConfig } from '../config';
import { scriptedModel } from './fake-model';

test('native text-only digest has no tools, skills, memory or workspace context', async () => {
  const fake = scriptedModel([{ text: '{"summary":"A security update"}' }]);
  const events: unknown[] = [];
  const result = await runAgent({
    config: {
      model: 'test/small',
      servers: [{ provider: 'test', baseUrl: 'http://127.0.0.1:1' }],
      workdir: process.cwd(),
      instructions: 'PRIVATE_SOUL',
      tools: { profile: 'voll', textOnly: true, allowUnsandboxedShell: true },
      memory: { enabled: true },
      skills: [{ name: 'secret', markdown: 'PRIVATE_SKILL', description: 'private' }],
      policy: 'allow',
      limits: { maxTurns: 1 },
    } as AgentRuntimeConfig,
    prompt: 'Release notes',
    runContext: 'Summarize only.',
    helena: {
      memory: () => {
        throw new Error('must not read memory');
      },
    } as never,
    modelFactory: () => fake,
    sink: {
      emit: (event) => {
        events.push(event);
      },
    },
    env: {},
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('success');
  const call = fake.doStreamCalls[0]!;
  expect(call.tools ?? []).toEqual([]);
  const prompt = JSON.stringify(call.prompt);
  expect(prompt).toContain('Summarize only.');
  expect(prompt).not.toContain('PRIVATE_SOUL');
  expect(prompt).not.toContain('PRIVATE_SKILL');
  expect(prompt).not.toContain('AGENTS.md');
  expect(events.some((event) => (event as { type: string }).type === 'result')).toBe(true);
});
