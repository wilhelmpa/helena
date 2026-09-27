import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filesPath,
  homeFilesPath,
  vaultMarkdownSourcePath,
  vaultNotePath,
  notesPath,
  notePath,
} from './paths';

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

it('opens Markdown in Docs and keeps other files in the file viewer', () => {
  assert.equal(
    vaultNotePath('Projects/VOL/Docs/Plan.md'),
    '/project/VOL/docs?path=Projects%2FVOL%2FDocs%2FPlan.md',
  );
  assert.equal(
    vaultNotePath('Projects/VOL/Files/Tasks/VOL-1.md'),
    '/project/VOL/docs?path=Projects%2FVOL%2FFiles%2FTasks%2FVOL-1.md',
  );
  assert.equal(vaultNotePath('Private/Steuern.txt'), '/files?root=private&file=Steuern.txt');
  assert.equal(vaultNotePath('Home/Docs/März.md'), '/docs?path=Home%2FDocs%2FM%C3%A4rz.md');
  assert.equal(vaultNotePath('Templates/Brief.md'), '/docs?path=Templates%2FBrief.md');
  assert.equal(
    vaultMarkdownSourcePath('Projects/VOL/Docs/Plan.md'),
    '/project/VOL/files?path=Docs&file=Docs%2FPlan.md&source=1',
  );
  assert.equal(notesPath('VOL'), '/project/VOL/files?view=boards');
  assert.equal(notePath('VOL', 42), '/project/VOL/files?view=boards&board=42');
  assert.equal(
    vaultNotePath('Projects/VOL/Boards/Plan.canvas'),
    '/project/VOL/files?view=boards&canvas=Projects%2FVOL%2FBoards%2FPlan.canvas',
  );
});
