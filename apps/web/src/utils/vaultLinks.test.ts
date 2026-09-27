import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isolatedNotesUrl,
  baseName,
  childPath,
  docsFileUrl,
  notesFileUrl,
  notesFolderUrl,
  notesVaultFolderUrl,
  notesPageUrl,
  parentPath,
  projectRelativePath,
  vaultProjectKey,
} from './vaultLinks';

describe('vault links', () => {
  it('opens a note or a file in the notes by its page name', () => {
    const base = 'https://helena-home.volition.one:8446';
    assert.equal(
      notesFileUrl(base, 'Projects/VOL/Docs/Belege 2026.md'),
      'https://helena-home.volition.one:8446/Projects/VOL/Docs/Belege%202026',
    );
    assert.equal(
      notesFileUrl(`${base}/`, 'Projects/VOL/Files/Tasks/VOL-3/Rechnung März.pdf'),
      'https://helena-home.volition.one:8446/Projects/VOL/Files/Tasks/VOL-3/Rechnung%20M%C3%A4rz.pdf',
    );
    assert.equal(notesPageUrl(base, 'Verträge & Konten'), `${base}/Vertr%C3%A4ge%20%26%20Konten`);
  });

  it('offers the notes only for what they can open', () => {
    const base = 'https://notes.example.com';
    for (const path of [
      'Private/Tagebuch.md',
      'Projects/VOL/.hidden.md',
      '.trash/Old.md',
      'Projects/VOL/Boards/Plan.canvas',
      'Projects/VOL/Docs/Mail @ Kunde.md',
      'Projects/VOL/Docs/C# Notizen.md',
      '',
    ]) {
      assert.equal(notesFileUrl(base, path), '', path);
    }
    assert.equal(notesFileUrl('', 'Projects/VOL/Docs/a.md'), '');
    assert.equal(notesFileUrl('javascript:alert(1)', 'Projects/VOL/Docs/a.md'), '');
  });

  it('opens the notes on the project’s folder, or Home’s', () => {
    assert.equal(
      notesFolderUrl('https://notes.example.com', 'VOL'),
      'https://notes.example.com/ordner%3AProjects/VOL',
    );
    assert.equal(
      notesFolderUrl('https://notes.example.com', null),
      'https://notes.example.com/ordner%3AHome',
    );
    assert.equal(notesFolderUrl('', 'VOL'), '');
  });

  it('opens an allowed vault folder in SilverBullet, never Private or code', () => {
    const base = 'https://notes.example.com';
    assert.equal(
      notesVaultFolderUrl(base, 'Projects/VOL/Files/Mail'),
      `${base}/ordner%3AProjects/VOL/Files/Mail`,
    );
    assert.equal(notesVaultFolderUrl(base, 'Home/Docs'), `${base}/ordner%3AHome/Docs`);
    for (const path of ['', 'Private', 'Private/Docs', '.git', 'Projects/VOL/.hidden']) {
      assert.equal(notesVaultFolderUrl(base, path), '', path);
    }
  });

  it('opens a note inline in its project Wissen', () => {
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

it('refuses executable notes on the Helena origin or insecure transport', () => {
  assert.equal(isolatedNotesUrl('https://helena.test/notes', 'https://helena.test'), '');
  assert.equal(isolatedNotesUrl('http://notes.test', 'https://helena.test'), '');
  assert.equal(
    isolatedNotesUrl('https://notes.test/a', 'https://helena.test'),
    'https://notes.test/a',
  );
});
