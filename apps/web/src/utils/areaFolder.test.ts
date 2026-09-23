import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { areaFolderProblem, defaultAreaFolder } from './areaFolder';

describe('defaultAreaFolder', () => {
  it('derives lowercase letters, digits and hyphens from the name', () => {
    assert.equal(defaultAreaFolder('Design & UX / Q4', new Set()), 'design-ux-q4');
    assert.equal(defaultAreaFolder('Größe & Übergänge', new Set()), 'groesse-uebergaenge');
    assert.equal(defaultAreaFolder('Café', new Set()), 'cafe');
    assert.equal(defaultAreaFolder('!!!', new Set()), 'area');
  });

  it('numbers a folder another area uses or the provisioning service manages', () => {
    assert.equal(defaultAreaFolder('Design', new Set(['design', 'design-2'])), 'design-3');
    assert.equal(defaultAreaFolder('Docs', new Set()), 'docs-2');
  });
});

describe('areaFolderProblem', () => {
  it('accepts one lowercase path segment of up to 64 characters', () => {
    assert.equal(areaFolderProblem('backend-2', new Set()), null);
    assert.equal(areaFolderProblem('a'.repeat(64), new Set()), null);
  });

  it('names what is wrong with a folder', () => {
    for (const folder of ['Backend', 'back/end', '..', '-x', 'a b', '', 'a'.repeat(65)]) {
      assert.equal(areaFolderProblem(folder, new Set()), 'invalid');
    }
    assert.equal(areaFolderProblem('inbox', new Set()), 'reserved');
    assert.equal(areaFolderProblem('backend', new Set(['backend'])), 'taken');
  });
});
