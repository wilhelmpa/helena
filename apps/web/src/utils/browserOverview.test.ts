import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { browserSlug, HOME_BROWSER_SLUG } from './browserOverview';

describe('project browser slugs', () => {
  it('match the deployment: the key in lower case, VERV as verve, Home as home', () => {
    assert.equal(browserSlug('VOL'), 'vol');
    assert.equal(browserSlug('P6BROW26'), 'p6brow26');
    assert.equal(browserSlug('VERV'), 'verve');
    assert.equal(HOME_BROWSER_SLUG, 'home');
  });
});
