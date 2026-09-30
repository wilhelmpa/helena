import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MemoryRevision } from '@/lib/api/endpoints/agentRuntime';
import { memoryFilesOf } from './memoryFiles';

const revision = (patch: Partial<MemoryRevision>): MemoryRevision => ({
  id: 1,
  file: 'MEMORY.md',
  content: 'aus der Fassung',
  sha256: 'abc',
  source: 'agent',
  proposalId: null,
  userName: null,
  createdAt: '2026-09-30T08:00:00.000Z',
  ...patch,
});

describe('memoryFilesOf', () => {
  it('prefers what the runtime reported', () => {
    const files = memoryFilesOf(
      [{ file: 'MEMORY.md', content: 'gemeldet', truncated: false, sha256: 'x', chars: 8 }],
      [revision({})],
    );
    assert.equal(files[0].content, 'gemeldet');
  });

  it('falls back to the newest version, then to an empty file', () => {
    const files = memoryFilesOf(undefined, [
      revision({ id: 3, content: 'neu' }),
      revision({ id: 2, content: 'alt' }),
    ]);
    assert.equal(files[0].content, 'neu');
    assert.equal(files[0].chars, 3);
    assert.deepEqual(files[1], { file: 'USER.md', content: '', truncated: false, chars: 0 });
  });
});
