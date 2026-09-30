import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Followup } from '@/lib/api/endpoints/agentFollowups';
import type { PlanUIMessage } from './chatMessages';
import {
  defaultFollowupMode,
  followupTargetOf,
  hasWaiting,
  orderedModes,
  queuedAnswers,
  visibleFollowups,
} from './followups';

const message = (id: string, role: 'user' | 'assistant', agentId?: number): PlanUIMessage => ({
  id,
  role,
  parts: [],
  ...(agentId != null && { metadata: { agentId } }),
});
const item = (over: Partial<Followup>): Followup => ({
  id: 'a',
  mode: 'inject',
  state: 'pending',
  prompt: 'x',
  nextId: null,
  ...over,
});

describe('follow-up modes', () => {
  it('offers inject first, then after, then replace, only what the runtime supports', () => {
    assert.deepEqual(orderedModes(['replace', 'after', 'inject']), ['inject', 'after', 'replace']);
    assert.deepEqual(orderedModes(['after']), ['after']);
    assert.equal(defaultFollowupMode(['after']), 'after');
    assert.equal(defaultFollowupMode(['replace', 'inject']), 'inject');
    assert.equal(defaultFollowupMode([]), null);
  });
});

describe('followupTargetOf', () => {
  it('is the newest answer once it has its number', () => {
    const target = followupTargetOf('VOL', 4, [
      message('10', 'user'),
      message('11', 'assistant', 7),
    ]);
    assert.deepEqual(target, { scopeKey: 'VOL', agentId: 7, kind: 'chat', id: 11 });
  });
  it('is nothing while the newest message is a question or still has the browser’s own id', () => {
    assert.equal(followupTargetOf('VOL', 4, [message('10', 'user')]), null);
    assert.equal(followupTargetOf('VOL', 4, [message('c1f0-uuid', 'assistant')]), null);
    assert.equal(followupTargetOf('VOL', 4, []), null);
  });
  it('falls back to the chat’s agent', () => {
    assert.equal(followupTargetOf('team:1', 4, [message('5', 'assistant')])?.agentId, 4);
  });
});

describe('what the transcript shows', () => {
  it('hides an "after" instruction once it became the next turn', () => {
    const items = [
      item({ id: '1', mode: 'inject', state: 'applied' }),
      item({ id: '2', mode: 'after', state: 'pending' }),
      item({ id: '3', mode: 'after', state: 'queued', nextId: 12 }),
      item({ id: '4', mode: 'replace', state: 'applied' }),
    ];
    assert.deepEqual(
      visibleFollowups(items).map((entry) => entry.id),
      ['1', '2', '4'],
    );
  });
  it('lists queued answers the chat does not hold yet, and whether something still waits', () => {
    const items = [
      item({ id: '1', mode: 'after', state: 'queued', nextId: 12 }),
      item({ id: '2', mode: 'after', state: 'queued', nextId: 14 }),
      item({ id: '3', mode: 'after', state: 'pending' }),
    ];
    assert.deepEqual(queuedAnswers(items, [message('12', 'assistant')]), [14]);
    assert.equal(hasWaiting(items), true);
    assert.equal(hasWaiting(items.slice(0, 2)), false);
  });
});
