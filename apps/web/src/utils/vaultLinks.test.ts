import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseName,
  childPath,
  docsFileUrl,
  parentPath,
  projectRelativePath,
  vaultProjectKey,
} from './vaultLinks';

describe('vault links', () => {
  it('opens a note in the project file browser', () => {
    assert.equal(
      docsFileUrl('VOL', 'Projects/VOL/Docs/Plan.md'),
      '/project/VOL/files?path=Docs&file=Docs%2FPlan.md',
    );
  });

  it('splits a vault path into its project and the path below it', () => {
    assert.equal(vaultProjectKey('Projects/VOL/Files/a.pdf'), 'VOL');
    assert.equal(vaultProjectKey('Home/a.pdf'), null);
    assert.equal(projectRelativePath('Projects/VOL/Files/a.pdf'), 'Files/a.pdf');
  });

  it('walks paths', () => {
    assert.equal(parentPath('Files/Tasks/a.pdf'), 'Files/Tasks');
    assert.equal(parentPath('a.pdf'), '');
    assert.equal(childPath('', 'a.pdf'), 'a.pdf');
    assert.equal(childPath('Files', 'a.pdf'), 'Files/a.pdf');
    assert.equal(baseName('Files/a.pdf'), 'a.pdf');
  });
});
