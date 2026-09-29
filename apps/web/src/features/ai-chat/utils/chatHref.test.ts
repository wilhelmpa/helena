import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatHref } from './chatHref';

test('a chat opens in its place: the project page, or Home', () => {
  assert.equal(
    chatHref('VOL', { agentId: 4, threadId: 'abc' }),
    '/project/VOL/chat?agent=4&thread=abc',
  );
  assert.equal(chatHref(null, { agentId: 3, threadId: 'abc' }), '/?agent=3&thread=abc');
});

test('without a thread it is a new chat that keeps its agent', () => {
  assert.equal(chatHref('VOL', { agentId: 4 }), '/project/VOL/chat?agent=4&new=1');
  assert.equal(chatHref(null, { agentId: 3 }), '/?agent=3&new=1');
  assert.equal(chatHref(null), '/?new=1');
  assert.equal(chatHref('VOL'), '/project/VOL/chat?new=1');
});
