import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { globalInboxPath } from './paths';

describe('Home inbox address', () => {
  it('opens on the mail, and on the updates when asked (O82)', () => {
    assert.equal(globalInboxPath(), '/inbox');
    assert.equal(globalInboxPath('updates'), '/inbox?tab=updates');
  });
});
