import { expect, test } from 'bun:test';
import { memoryTool } from '../tools/builtin';
import type { HelenaApi } from '../helena-client';

test('normal memory read finds durable facts across chats', async () => {
  let query = '';
  const api = {
    memory: async () => ({ files: [], notes: [], approval: false }),
    searchFacts: async (value: string) => {
      query = value;
      return [{ id: 24, content: 'The Orion bicycle is copper-colored.', project: 'PRIV' }];
    },
  } as unknown as HelenaApi;
  const result = await memoryTool(api).execute(
    { action: 'read', query: 'Orion bicycle' },
    {} as never,
  );
  expect(query).toBe('Orion bicycle');
  expect(result.text).toContain('copper-colored');
  expect(result.text).toContain('24');
});

test('fact answers remain visible within the memory output budget', async () => {
  const api = {
    memory: async () => ({
      files: [{ file: 'MEMORY.md', content: `Orion bicycle ${'notes '.repeat(1200)}`, sha256: '' }],
      notes: [],
      approval: false,
    }),
    searchFacts: async () => [
      {
        id: 24,
        project: 'PRIV',
        content: `Orion bicycle ${'details '.repeat(150)} copper-colored`,
      },
    ],
  } as unknown as HelenaApi;
  const result = await memoryTool(api).execute(
    { action: 'read', query: 'Orion bicycle' },
    {} as never,
  );
  expect(result.text).toContain('copper-colored');
  expect(result.text.length).toBeLessThanOrEqual(6000);
});
