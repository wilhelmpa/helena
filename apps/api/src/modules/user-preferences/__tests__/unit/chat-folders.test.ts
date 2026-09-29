import { describe, expect, it } from 'bun:test';
import { normalizeChatFolders } from '../../chat-folders';

describe('normalizeChatFolders (O4)', () => {
  it('keeps named folders with unique ids and each chat in one folder only', () => {
    expect(
      normalizeChatFolders([
        { id: 'a', name: ' Arbeit ', threads: ['t1', 't2', 't1'] },
        { id: 'a', name: 'Doppelt', threads: ['t3'] },
        { id: 'b', name: 'Privat', threads: ['t2', 't4', 7] },
        { id: 'c', name: '', threads: [] },
        'junk',
      ]),
    ).toEqual([
      { id: 'a', name: 'Arbeit', threads: ['t1', 't2'] },
      { id: 'b', name: 'Privat', threads: ['t4'] },
    ]);
  });

  it('reads anything else as no folders', () => {
    expect(normalizeChatFolders(undefined)).toBeUndefined();
    expect(normalizeChatFolders({})).toBeUndefined();
  });
});
