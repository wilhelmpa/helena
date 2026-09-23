import { describe, it, expect } from 'bun:test';
import {
  newChatThreadId,
  isChatThreadId,
  isOwnChatThread,
  runThreadId,
} from '../../runtime/thread-ids';

describe('runThreadId', () => {
  const base = { id: 7, agentId: 3, issueId: null };

  it('scopes an issue run to the (issue, agent) pair', () => {
    expect(runThreadId({ ...base, issueId: 42 })).toBe('issue:42:3');
  });

  it('keeps two agents on the same issue apart', () => {
    expect(runThreadId({ ...base, issueId: 42, agentId: 4 })).not.toBe(
      runThreadId({ ...base, issueId: 42 }),
    );
  });

  it('falls back to the run itself without an issue', () => {
    expect(runThreadId(base)).toBe('run:7');
  });
});

describe('chat thread ids', () => {
  it('carries the agent and the user, and a unique id per conversation', () => {
    const first = newChatThreadId(3, 'user-1');
    expect(first.startsWith('chat:3:user-1:')).toBe(true);
    expect(newChatThreadId(3, 'user-1')).not.toBe(first);
  });

  it('recognises its own chat threads and rejects everything else', () => {
    const mine = newChatThreadId(3, 'user-1');
    expect(isOwnChatThread(mine, 3, 'user-1')).toBe(true);
    expect(isOwnChatThread(mine, 4, 'user-1')).toBe(false);
    expect(isOwnChatThread(mine, 3, 'user-2')).toBe(false);
    expect(isOwnChatThread('issue:42:3', 3, 'user-1')).toBe(false);
    expect(isOwnChatThread('run:7', 3, 'user-1')).toBe(false);
  });

  it('separates a chat thread from a run thread', () => {
    expect(isChatThreadId(newChatThreadId(3, 'user-1'))).toBe(true);
    expect(isChatThreadId('issue:42:3')).toBe(false);
    expect(isChatThreadId('run:7')).toBe(false);
  });
});
