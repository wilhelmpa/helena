import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import {
  agentOrderByRole,
  chatAgentTree,
  chatSections,
  foldedChats,
  mixesProjects,
} from './chatSections';

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

const inProject = (id: string, key: string | null) =>
  ({
    id,
    agent: { id: 1, name: 'A', username: 'a' },
    project: key ? { key } : null,
  }) as ChatSummary;

test('a project chip is only needed where the list mixes projects (owner, O100)', () => {
  const one = [inProject('a', 'VOL'), inProject('b', 'VOL')];
  const mixed = [inProject('a', 'VOL'), inProject('b', 'VERVE')];
  const withHome = [inProject('a', 'VOL'), inProject('b', null)];
  assert.equal(mixesProjects(one, false), false);
  assert.equal(mixesProjects(mixed, false), true);
  assert.equal(mixesProjects(withHome, false), true);
  // A project's own sidebar never names its project.
  assert.equal(mixesProjects(mixed, true), false);
  assert.equal(mixesProjects([], false), false);
});

test('a group shows its first chats and folds the rest, unless opened or holding the open chat', () => {
  const chats = ['1', '2', '3', '4', '5', '6', '7'].map((id) => inProject(id, null));
  const holds = (id: string) => (list: ChatSummary[]) => list.some((c) => c.id === id);
  const none = holds('nope');
  assert.deepEqual(foldedChats(chats, 5, false, none).hidden, 2);
  assert.deepEqual(
    foldedChats(chats, 5, false, none).shown.map((c) => c.id),
    ['1', '2', '3', '4', '5'],
  );
  // Opened by the reader: everything.
  assert.equal(foldedChats(chats, 5, true, none).hidden, 0);
  // The open chat is a folded one: it must not disappear.
  assert.equal(foldedChats(chats, 5, false, holds('7')).hidden, 0);
  // The open chat is among the first ones: the fold stays.
  assert.equal(foldedChats(chats, 5, false, holds('2')).hidden, 2);
  // Short lists fold nothing.
  assert.equal(foldedChats(chats.slice(0, 3), 5, false, none).hidden, 0);
});

test('the chats of the agents form the organisation’s tree, without agents that have no chats', () => {
  const sections = chatSections(list, [], [1, 2, 4]).agents;
  const org = [
    { id: 1, name: 'Ava', reportsToAgentId: null },
    { id: 2, name: 'Koordinator', reportsToAgentId: 1 },
    { id: 3, name: 'Ohne Chat', reportsToAgentId: 2 },
    { id: 4, name: 'Spezialist', reportsToAgentId: 3 },
  ];
  const tree = chatAgentTree(sections, org, new Set([1, 2, 3, 4]));
  assert.deepEqual(
    tree.map((entry) => [entry.agent.id, entry.total]),
    [
      [1, 4],
      [9, 1],
    ],
  );
  const coordinator = tree[0]!.children[0]!;
  assert.equal(coordinator.agent.id, 2);
  // Agent 3 has no chats but holds agent 4, so it stays as the row between them.
  assert.deepEqual(
    coordinator.children.map((entry) => [entry.agent.id, entry.chats.length, entry.total]),
    [[3, 0, 2]],
  );
});

test('an agent the place does not offer ends the chain, so a project shows its own branch', () => {
  const sections = chatSections(list, [], [2, 4]).agents;
  const org = [
    { id: 1, name: 'Ava', reportsToAgentId: null },
    { id: 2, name: 'Koordinator', reportsToAgentId: 1 },
    { id: 4, name: 'Spezialist', reportsToAgentId: 2 },
  ];
  const tree = chatAgentTree(sections, org, new Set([2, 4]));
  assert.deepEqual(
    tree.map((entry) => entry.agent.id),
    [2, 1, 9],
  );
  assert.deepEqual(
    tree[0]!.children.map((entry) => entry.agent.id),
    [4],
  );
});

test('a cycle in reportsTo does not loop', () => {
  const sections = chatSections([chat('a', 1), chat('b', 2)], [], []).agents;
  const org = [
    { id: 1, name: 'A', reportsToAgentId: 2 },
    { id: 2, name: 'B', reportsToAgentId: 1 },
  ];
  const tree = chatAgentTree(sections, org, new Set([1, 2]));
  assert.equal(
    tree.reduce((sum, entry) => sum + entry.total, 0),
    2,
  );
});
