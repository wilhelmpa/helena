import { expect, test } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { normalizeRuntimeInventory } from '../../inventory';
import { runtimeInventory } from '../../model';

test('bounds legacy inventories and skips invalid entries against the response schema', () => {
  const skill = {
    name: 'n'.repeat(150),
    category: 'c'.repeat(150),
    description: 'd'.repeat(389),
    origin: 'agent',
    path: 'p'.repeat(300),
    pinned: 'invalid',
  };
  const result = normalizeRuntimeInventory({
    toolsets: [null, '', 3, ...Array(70).fill('t'.repeat(150))],
    mcpServers: Array(70).fill('m'.repeat(150)),
    skills: [null, {}, { ...skill, origin: 'unknown' }, ...Array(310).fill(skill)],
    memory: [
      null,
      { file: 'other', content: '', truncated: false },
      ...Array(3).fill({
        file: 'MEMORY.md',
        content: 'x'.repeat(17000),
        truncated: false,
        sha256: 'invalid',
        chars: -1,
      }),
    ],
    cronJobs: -1,
  })!;
  expect(Value.Check(runtimeInventory, result)).toBe(true);
  expect(result.toolsets).toHaveLength(64);
  expect(result.mcpServers).toHaveLength(64);
  expect(result.skills).toHaveLength(300);
  expect(result.skills[0]).toEqual({
    name: 'n'.repeat(128),
    category: 'c'.repeat(128),
    description: 'd'.repeat(299) + '…',
    origin: 'agent',
    path: 'p'.repeat(260),
  });
  expect(result.memory).toEqual(
    Array(2).fill({ file: 'MEMORY.md', content: 'x'.repeat(16384), truncated: true }),
  );
  expect(result.cronJobs).toBeUndefined();
});

test('keeps valid memory metadata and cron counts and handles absent inventories', () => {
  expect(normalizeRuntimeInventory(null)).toBeNull();
  expect(normalizeRuntimeInventory([])).toBeNull();
  const memory = [
    {
      file: 'USER.md' as const,
      content: 'owner',
      truncated: false,
      sha256: 'a'.repeat(64),
      chars: 5,
    },
  ];
  expect(normalizeRuntimeInventory({ memory, cronJobs: 0 })).toEqual({
    toolsets: [],
    mcpServers: [],
    skills: [],
    memory,
    cronJobs: 0,
  });
  for (const cronJobs of [1.5, Infinity, '3']) {
    expect(normalizeRuntimeInventory({ cronJobs })?.cronJobs).toBeUndefined();
  }
});
