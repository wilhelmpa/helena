import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { setDisplayTimezone } from '@/utils/dates';
import { chatGroupKey, groupChats } from './chatGroups';

setDisplayTimezone('Europe/Berlin');

const chat = (id: string, updatedAt: string, pinned = false) =>
  ({ id, updatedAt, pinned }) as ChatSummary;

describe('chat list sections', () => {
  const now = new Date('2026-09-23T10:00:00Z');

  it('sorts a chat into its section by the day it was last written in, in the member zone', () => {
    assert.equal(chatGroupKey('2026-09-23T06:00:00Z', now), 'today');
    // 23:30 UTC on the 22nd is already the 23rd in Berlin.
    assert.equal(chatGroupKey('2026-09-22T23:30:00Z', now), 'today');
    assert.equal(chatGroupKey('2026-09-22T12:00:00Z', now), 'yesterday');
    assert.equal(chatGroupKey('2026-09-17T12:00:00Z', now), 'week');
    assert.equal(chatGroupKey('2026-09-01T12:00:00Z', now), 'month');
    assert.equal(chatGroupKey('2026-07-04T12:00:00Z', now), 'm:2026-07');
  });

  it('puts the pinned chats first and keeps the order the list arrives in', () => {
    const groups = groupChats(
      [
        chat('p', '2026-01-01T00:00:00Z', true),
        chat('a', '2026-09-23T09:00:00Z'),
        chat('b', '2026-09-23T08:00:00Z'),
        chat('c', '2026-09-22T08:00:00Z'),
        chat('d', '2026-06-10T08:00:00Z'),
        chat('e', '2026-05-10T08:00:00Z'),
      ],
      now,
    );
    assert.deepEqual(
      groups.map((group) => [group.key, group.chats.map((c) => c.id)]),
      [
        ['pinned', ['p']],
        ['today', ['a', 'b']],
        ['yesterday', ['c']],
        ['m:2026-06', ['d']],
        ['m:2026-05', ['e']],
      ],
    );
  });
});
