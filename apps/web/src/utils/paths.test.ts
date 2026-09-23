import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filesPath, homeFilesPath } from './paths';

describe('Files page paths', () => {
  it('keeps the root, the folder and the open file in the address', () => {
    assert.equal(filesPath('VOL'), '/project/VOL/files');
    assert.equal(filesPath('VOL', 'Files/Tasks'), '/project/VOL/files?path=Files%2FTasks');
    assert.equal(
      filesPath('VOL', 'src', { root: 'code', file: 'src/index.ts' }),
      '/project/VOL/files?root=code&path=src&file=src%2Findex.ts',
    );
  });

  it('addresses a project folder from the Home Files page', () => {
    assert.equal(homeFilesPath(), '/files');
    assert.equal(
      homeFilesPath('Rechnungen', { root: 'project', project: 'FAM' }),
      '/files?root=project&project=FAM&path=Rechnungen',
    );
  });
});
