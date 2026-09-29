import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { withOpenChat } from './chatListWithOpen';

const chat = (id: string, updatedAt: string, over: Partial<ChatSummary> = {}): ChatSummary =>
  ({
    id,
    title: id,
    agent: { id: 1, name: 'A', username: 'a' },
    teamId: 1,
    project: null,
    issue: null,
    pinned: false,
    running: false,
    archivedAt: null,
    deletedAt: null,
    createdAt: updatedAt,
    updatedAt,
    model: null,
    thinkingLevel: null,
    cliSessionId: null,
    jevFirstStage: 'inherit',
    ...over,
  }) as ChatSummary;

const ids = (chats: ChatSummary[]) => chats.map((entry) => entry.id);

describe('withOpenChat', () => {
  const list = [
    chat('pin', '2026-09-01T00:00:00Z', { pinned: true }),
    chat('new', '2026-09-29T10:00:00Z'),
    chat('old', '2026-09-20T10:00:00Z'),
  ];

  it('adds the open chat of another scope where its time puts it', () => {
    assert.deepEqual(
      ids(withOpenChat(list, chat('open', '2026-09-25T10:00:00Z'), 'active', false)),
      ['pin', 'new', 'open', 'old'],
    );
    assert.deepEqual(
      ids(withOpenChat(list, chat('newest', '2026-09-30T10:00:00Z'), 'active', false)),
      ['pin', 'newest', 'new', 'old'],
    );
    assert.deepEqual(
      ids(withOpenChat(list, chat('ancient', '2026-01-01T00:00:00Z'), 'active', false)),
      ['pin', 'new', 'old', 'ancient'],
    );
  });

  it('puts a pinned open chat with the pinned ones and fills an empty list', () => {
    assert.deepEqual(
      ids(
        withOpenChat(list, chat('mine', '2026-09-30T00:00:00Z', { pinned: true }), 'active', false),
      ),
      ['mine', 'pin', 'new', 'old'],
    );
    assert.deepEqual(ids(withOpenChat([], chat('only', '2026-09-30T00:00:00Z'), 'active', false)), [
      'only',
    ]);
  });

  it('leaves the list alone when it holds the chat, is searched, or shows archive or trash', () => {
    assert.equal(withOpenChat(list, chat('new', '2026-09-29T10:00:00Z'), 'active', false), list);
    assert.equal(withOpenChat(list, chat('x', '2026-09-30T00:00:00Z'), 'active', true), list);
    assert.equal(withOpenChat(list, chat('x', '2026-09-30T00:00:00Z'), 'archived', false), list);
    assert.equal(withOpenChat(list, chat('x', '2026-09-30T00:00:00Z'), 'trash', false), list);
    assert.equal(withOpenChat(list, null, 'active', false), list);
    assert.equal(
      withOpenChat(
        list,
        chat('x', '2026-09-30T00:00:00Z', { deletedAt: '2026-09-30T01:00:00Z' }),
        'active',
        false,
      ),
      list,
    );
  });
});
