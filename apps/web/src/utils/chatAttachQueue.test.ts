import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  queueChatAttachment,
  resetChatAttachQueueForTest,
  takeQueuedChatAttachments,
} from './chatAttachQueue';

describe('chat attach queue', () => {
  beforeEach(() => resetChatAttachQueueForTest());

  it('hands each queued file out once, in order', () => {
    queueChatAttachment({ path: 'Projects/VOL/Docs/a.md', name: 'a' });
    queueChatAttachment({ path: 'Projects/VOL/Docs/b.md', name: 'b' });
    assert.deepEqual(
      takeQueuedChatAttachments().map((item) => item.name),
      ['a', 'b'],
    );
    assert.deepEqual(takeQueuedChatAttachments(), []);
  });

  it('keeps a file queued twice only once, at the end', () => {
    queueChatAttachment({ path: 'Projects/VOL/Docs/a.md', name: 'a' });
    queueChatAttachment({ path: 'Projects/VOL/Docs/b.md', name: 'b' });
    queueChatAttachment({ path: 'Projects/VOL/Docs/a.md', name: 'a' });
    assert.deepEqual(
      takeQueuedChatAttachments().map((item) => item.name),
      ['b', 'a'],
    );
  });
});
