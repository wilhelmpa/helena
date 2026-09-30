import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '@/lib/api/core/client';
import { catalogErrorKey } from './catalogErrors';

describe('catalog error messages', () => {
  it('maps the answers of the catalog API to the plain-language keys', () => {
    const key = (status: number, message: string) => catalogErrorKey(new ApiError(status, message));
    assert.equal(key(409, 'Inspection has blocking findings'), 'blocked');
    assert.equal(key(409, 'Review findings must be acknowledged before adoption'), 'acknowledge');
    assert.equal(key(409, 'Catalog source is disabled'), 'sourceDisabled');
    assert.equal(
      key(409, 'Agent isolation must be enabled before an MCP server can be installed'),
      'isolation',
    );
    assert.equal(key(409, 'No previous version to restore'), 'noPrevious');
    assert.equal(key(409, 'Proposal already decided'), 'decided');
    assert.equal(key(409, 'Pinned source content changed since inspection'), 'changed');
    assert.equal(key(502, 'Catalog source returned 404'), 'unreachable');
    assert.equal(key(502, 'npm package integrity does not match'), 'integrity');
    assert.equal(key(403, 'Forbidden'), 'forbidden');
    assert.equal(key(409, 'Something else'), 'conflict');
    assert.equal(key(500, 'Boom'), 'generic');
  });

  it('treats a network failure as an unreachable source and anything else as generic', () => {
    assert.equal(catalogErrorKey(new TypeError('Failed to fetch')), 'unreachable');
    assert.equal(catalogErrorKey('nope'), 'generic');
  });
});
