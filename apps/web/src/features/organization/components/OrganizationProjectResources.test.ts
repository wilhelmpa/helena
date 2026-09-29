import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyRequestedResource } from './OrganizationProjectResources';

describe('classifyRequestedResource', () => {
  it('resolves a board resource to its current view name', () => {
    const boardNames = new Map([[9, 'Sprint board']]);
    assert.deepEqual(classifyRequestedResource('board:9', boardNames), {
      kind: 'board',
      resource: 'board:9',
      boardId: 9,
      name: 'Sprint board',
    });
  });

  it('falls back to the id when the board view was deleted', () => {
    const boardNames = new Map([[9, 'Sprint board']]);
    assert.deepEqual(classifyRequestedResource('board:404', boardNames), {
      kind: 'boardDeleted',
      resource: 'board:404',
      boardId: 404,
    });
  });

  it('falls back to the id when no views have loaded yet', () => {
    assert.deepEqual(classifyRequestedResource('board:9', new Map()), {
      kind: 'boardDeleted',
      resource: 'board:9',
      boardId: 9,
    });
  });

  it('leaves every other resource kind unchanged', () => {
    const boardNames = new Map([[9, 'Sprint board']]);
    for (const resource of ['workspace', 'coordinator', 'terminal', 'files', 'browser']) {
      assert.deepEqual(classifyRequestedResource(resource, boardNames), {
        kind: 'other',
        resource,
      });
    }
  });

  it('rejects a malformed board id rather than matching it loosely', () => {
    const boardNames = new Map([[9, 'Sprint board']]);
    for (const resource of ['board:', 'board:0', 'board:09', 'board:-1', 'board:9a']) {
      assert.deepEqual(classifyRequestedResource(resource, boardNames), {
        kind: 'other',
        resource,
      });
    }
  });
});
