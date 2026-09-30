import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { locationAfterDeletion, sameChatLocation } from './chatLocation';

describe('locationAfterDeletion', () => {
  it('leaves the open thread for a new chat with the same agent when it is deleted', () => {
    assert.deepEqual(locationAfterDeletion({ agentId: 4, threadId: 't1' }, 't1'), {
      agentId: 4,
      threadId: null,
    });
  });

  it('stays where it is when another thread was deleted', () => {
    assert.equal(locationAfterDeletion({ agentId: 4, threadId: 't1' }, 't2'), null);
    assert.equal(locationAfterDeletion({ agentId: 4, threadId: null }, 't2'), null);
  });
});

describe('sameChatLocation', () => {
  it('compares the agent and the thread, a new chat being a null thread', () => {
    assert.equal(
      sameChatLocation({ agentId: 3, threadId: null }, { agentId: 3, threadId: null }),
      true,
    );
    assert.equal(
      sameChatLocation({ agentId: 3, threadId: 'a' }, { agentId: 3, threadId: 'a' }),
      true,
    );
    assert.equal(
      sameChatLocation({ agentId: 3, threadId: null }, { agentId: 1, threadId: null }),
      false,
    );
    assert.equal(
      sameChatLocation({ agentId: 3, threadId: 'a' }, { agentId: 3, threadId: null }),
      false,
    );
  });
});
