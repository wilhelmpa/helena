import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { agentOrderByRole, chatSections } from './chatSections';

const chat = (id: string, agent: number, pinned = false) =>
  ({
    id,
    pinned,
    agent: { id: agent, name: `Agent ${agent}`, username: `a${agent}` },
  }) as ChatSummary;

const list = [
  chat('s1', 4),
  chat('pin', 2, true),
  chat('h1', 1),
  chat('c1', 2),
  chat('s2', 4),
  chat('other', 9),
];

test('pinned chats first, then the folders, then one section per agent in the place’s order', () => {
  const sections = chatSections(list, [{ id: 'f1', name: 'Trading', threads: ['s2'] }], [1, 2, 4]);
  assert.deepEqual(
    sections.pinned.map((entry) => entry.id),
    ['pin'],
  );
  assert.deepEqual(
    sections.folders.map((entry) => [entry.folder.name, entry.chats.map((c) => c.id)]),
    [['Trading', ['s2']]],
  );
  assert.deepEqual(
    sections.agents.map((entry) => [entry.agent.id, entry.chats.map((c) => c.id)]),
    [
      [1, ['h1']],
      [2, ['c1']],
      [4, ['s1']],
      [9, ['other']],
    ],
  );
});

test('a chat stands in one place: pinned wins over a folder, a folder over its agent', () => {
  const sections = chatSections(
    list,
    [{ id: 'f1', name: 'Alles', threads: ['pin', 'h1', 'c1'] }],
    [],
  );
  assert.deepEqual(
    sections.pinned.map((entry) => entry.id),
    ['pin'],
  );
  assert.deepEqual(
    sections.folders[0]!.chats.map((entry) => entry.id),
    ['h1', 'c1'],
  );
  assert.deepEqual(
    sections.agents.flatMap((entry) => entry.chats.map((c) => c.id)),
    ['s1', 's2', 'other'],
  );
});

test('an empty folder stays, agents outside the order keep the order they first appear in', () => {
  const sections = chatSections(list, [{ id: 'f2', name: 'Leer', threads: [] }], []);
  assert.deepEqual(
    sections.folders.map((entry) => [entry.folder.id, entry.chats.length]),
    [['f2', 0]],
  );
  assert.deepEqual(
    sections.agents.map((entry) => entry.agent.id),
    [4, 1, 2, 9],
  );
});

test('the agents are ordered home agent, coordinators, then the rest (each as the place gave them)', () => {
  const roles = new Map([
    [7, 'coordinator'],
    [9, 'specialist'],
  ]);
  assert.deepEqual(
    agentOrderByRole(
      [
        { id: 4, agentRole: 'agent' },
        { id: 9, agentRole: 'agent' },
        { id: 7, agentRole: 'agent' },
        { id: 1, agentRole: 'home' },
      ],
      (id) => roles.get(id),
    ),
    [1, 7, 4, 9],
  );
});
