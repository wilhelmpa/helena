import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addFolder, folderOfThread, moveToFolder, removeFolder, renameFolder } from './chatFolders';

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
