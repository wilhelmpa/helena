import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextAgents, newChatScopeKey } from './contextAgents';

const agent = (
  id: number,
  username: string,
  projects: string[],
  role: 'home' | 'agent' = 'agent',
  scope: 'selected' | 'all' = 'selected',
) => ({
  id,
  username,
  agentRole: role,
  projectScope: scope,
  projects: projects.map((key, index) => ({
    id: index + 1,
    key,
    name: key,
    roleId: null,
    roleName: null,
    instructions: '',
  })),
});

const home = agent(1, 'home', [], 'home', 'all');
const research = agent(2, 'markt-research-trade', ['TRADE']);
const coordinator = agent(3, 'trade-coordinator', ['TRADE']);
const vol = agent(4, 'coder-vol', ['VOL']);
const list = [home, research, coordinator, vol];

describe('chat agents by context', () => {
  it('puts the project coordinator first and Helena right after it', () => {
    assert.deepEqual(
      contextAgents(list, 'TRADE', 'trade-coordinator').map((entry) => entry.id),
      [3, 1, 2, 4],
    );
  });

  it('falls back to the first agent working in the project', () => {
    assert.deepEqual(
      contextAgents(list, 'VOL', 'vol-coordinator').map((entry) => entry.id),
      [4, 1, 2, 3],
    );
  });

  it('leads with Helena outside a project', () => {
    assert.deepEqual(
      contextAgents([research, home], null, '').map((entry) => entry.id),
      [1, 2],
    );
  });

  it('starts a new chat with a single-project agent in that project', () => {
    assert.equal(newChatScopeKey('team:1', coordinator), 'TRADE');
    assert.equal(newChatScopeKey('team:1', home), 'team:1');
    assert.equal(newChatScopeKey('team:1', agent(5, 'x', ['A', 'B'])), 'team:1');
    assert.equal(newChatScopeKey('VOL', coordinator), 'VOL');
    assert.equal(newChatScopeKey('team:1', null), 'team:1');
  });
});
