import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { untitledNotePath } from './untitledNote';

describe('untitledNotePath', () => {
  it('takes the first free "Untitled N.md" of the folder', () => {
    const folder = 'Home/Docs';
    assert.equal(untitledNotePath(folder, 'Untitled', new Set()), 'Home/Docs/Untitled.md');
    assert.equal(
      untitledNotePath(
        folder,
        'Untitled',
        new Set(['Home/Docs/Untitled.md', 'Home/Docs/Untitled 2.md', 'Home/Docs/Untitled 4.md']),
      ),
      'Home/Docs/Untitled 3.md',
    );
    assert.equal(untitledNotePath('', 'Unbenannt', new Set(['Unbenannt.md'])), 'Unbenannt 2.md');
  });
});
