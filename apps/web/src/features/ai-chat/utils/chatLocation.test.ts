import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { locationAfterDeletion } from './chatLocation';

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
