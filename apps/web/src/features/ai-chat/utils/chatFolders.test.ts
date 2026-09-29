import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatSummary } from '@/lib/api/endpoints/agentChat';
import { groupChats } from './chatGroups';
import {
  addFolder,
  folderOfThread,
  moveToFolder,
  removeFolder,
  renameFolder,
  withFolders,
} from './chatFolders';

const now = new Date('2026-09-29T12:00:00Z');
const chat = (id: string, updatedAt = '2026-09-29T10:00:00Z') =>
  ({ id, updatedAt, pinned: false, agent: { id: 1, name: 'Helena' } }) as unknown as ChatSummary;

test('folders come first with their chats, which leave the automatic groups (O4)', () => {
  const chats = [chat('a'), chat('b'), chat('c', '2026-09-20T10:00:00Z')];
  const folders = addFolder([], 'Trading', 'f1', 'b');
  const groups = withFolders(groupChats(chats, now), chats, folders);
  assert.deepEqual(
    groups.map((group) => [group.key, group.chats.map((entry) => entry.id)]),
    [
      ['f:f1', ['b']],
      ['today', ['a']],
      ['month', ['c']],
    ],
  );
  assert.equal(groups[0]!.label, 'Trading');
});

test('a chat is in one folder at most; moving, renaming and dissolving', () => {
  let folders = addFolder([], 'Eins', 'f1', 'a');
  folders = addFolder(folders, 'Zwei', 'f2');
  folders = moveToFolder(folders, 'a', 'f2');
  assert.equal(folderOfThread(folders, 'a')?.id, 'f2');
  assert.deepEqual(folders[0]!.threads, []);
  folders = renameFolder(folders, 'f2', ' Neu ');
  assert.equal(folders[1]!.name, 'Neu');
  folders = moveToFolder(folders, 'a', null);
  assert.equal(folderOfThread(folders, 'a'), null);
  assert.deepEqual(
    removeFolder(folders, 'f1').map((folder) => folder.id),
    ['f2'],
  );
});

test('without folders the groups stay as they are', () => {
  const chats = [chat('a')];
  const groups = groupChats(chats, now);
  assert.equal(withFolders(groups, chats, []), groups);
});
