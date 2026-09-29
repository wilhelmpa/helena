import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renamedFileName } from './knowledgeKinds';

describe('renamedFileName', () => {
  it('keeps the extension of a doc, canvas or view typed without it', () => {
    assert.equal(renamedFileName('Plan.md', 'Plan 2027'), 'Plan 2027.md');
    assert.equal(renamedFileName('Karte.canvas', ' Karte neu '), 'Karte neu.canvas');
    assert.equal(renamedFileName('Liste.base', 'Liste 2'), 'Liste 2.base');
  });

  it('takes a name with an extension, and any other file, as typed', () => {
    assert.equal(renamedFileName('Plan.md', 'Plan.txt'), 'Plan.txt');
    assert.equal(renamedFileName('r.pdf', 'Rechnung'), 'Rechnung');
  });
});
