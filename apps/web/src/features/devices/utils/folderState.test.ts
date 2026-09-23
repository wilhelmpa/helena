import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { folderStateKind } from './folderState';

describe('folder state', () => {
  test('groups the waiting and preparing states with their activity', () => {
    assert.equal(folderStateKind('idle', null), 'idle');
    assert.equal(folderStateKind('scanning', null), 'scanning');
    assert.equal(folderStateKind('scan-waiting', null), 'scanning');
    assert.equal(folderStateKind('syncing', null), 'syncing');
    assert.equal(folderStateKind('sync-preparing', null), 'syncing');
    assert.equal(folderStateKind('sync-waiting', null), 'syncing');
  });

  test('reports a folder error whatever the state says', () => {
    assert.equal(folderStateKind('error', null), 'error');
    assert.equal(folderStateKind('idle', 'folder marker missing'), 'error');
  });

  test('leaves an unknown state to be shown as it is', () => {
    assert.equal(folderStateKind('cleaning', null), 'other');
    assert.equal(folderStateKind('', null), 'other');
  });
});
