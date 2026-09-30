import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contextAgents, mainAgentOf, mainChatLocation, newChatScopeKey } from './contextAgents';

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

describe('the main agent of a place (owner, O105)', () => {
  it('is the coordinator in a project and Ava in Home, whatever order the agents arrive in', () => {
    const shuffled = [vol, research, coordinator, home];
    assert.equal(mainAgentOf(contextAgents(shuffled, 'TRADE', 'trade-coordinator'))?.id, 3);
    assert.equal(mainAgentOf(contextAgents(shuffled, null, ''))?.id, 1);
  });

  it('is Ava in a project that has no coordinator of its own', () => {
    assert.equal(mainAgentOf(contextAgents([home, vol], 'NEW', 'new-coordinator'))?.id, 1);
  });

  it('is nobody where no agent exists', () => {
    assert.equal(mainAgentOf([]), null);
  });
});

describe('the chat the logo and the orb open (owner, O99/O105)', () => {
  it('keeps the conversation that is open with the main agent', () => {
    assert.deepEqual(mainChatLocation(3, { agentId: 3, threadId: 'chat:3:a' }), {
      agentId: 3,
      threadId: 'chat:3:a',
    });
  });

  it('never opens another agent’s chat: a new chat with the main agent instead', () => {
    assert.deepEqual(mainChatLocation(3, { agentId: 4, threadId: 'chat:4:b' }), {
      agentId: 3,
      threadId: null,
    });
    assert.deepEqual(mainChatLocation(3, { agentId: null, threadId: null }), {
      agentId: 3,
      threadId: null,
    });
  });

  it('stays a new chat with the main agent when that is what was open', () => {
    assert.deepEqual(mainChatLocation(3, { agentId: 3, threadId: null }), {
      agentId: 3,
      threadId: null,
    });
  });
});
