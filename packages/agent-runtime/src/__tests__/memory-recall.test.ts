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
  expect(JSON.stringify(result)).toContain('copper-colored');
  expect(JSON.stringify(result)).toContain('24');
});
