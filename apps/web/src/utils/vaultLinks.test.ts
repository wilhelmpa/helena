import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  baseName,
  childPath,
  docsFileUrl,
  obsidianUrl,
  parentPath,
  projectRelativePath,
  vaultProjectKey,
} from './vaultLinks';

describe('vault links', () => {
  it('opens a vault file in Obsidian by its encoded path', () => {
    assert.equal(
      obsidianUrl('Volition', 'Projects/VOL/Files/Tasks/VOL-3/Rechnung März.pdf'),
      'obsidian://open?vault=Volition&file=Projects%2FVOL%2FFiles%2FTasks%2FVOL-3%2FRechnung%20M%C3%A4rz.pdf',
    );
  });

  it('opens a note on the Docs page of its project', () => {
    assert.equal(
      docsFileUrl('VOL', 'Projects/VOL/Docs/Plan.md'),
      '/project/VOL/docs?path=Projects%2FVOL%2FDocs%2FPlan.md',
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
