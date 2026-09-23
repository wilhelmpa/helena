import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { moveTarget } from './fileDrag';

describe('moveTarget', () => {
  it('moves an entry into another folder under its own name', () => {
    assert.equal(moveTarget('Inbox/scan.pdf', 'Rechnungen'), 'Rechnungen/scan.pdf');
    assert.equal(moveTarget('Inbox/scan.pdf', ''), 'scan.pdf');
  });

  it('ignores a drop on the folder the entry is in, and a folder dropped into itself', () => {
    assert.equal(moveTarget('Inbox/scan.pdf', 'Inbox'), null);
    assert.equal(moveTarget('Archiv', 'Archiv'), null);
    assert.equal(moveTarget('Archiv', 'Archiv/2026'), null);
  });
});
