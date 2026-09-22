import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchingProjectDestination, safeProjectDestination } from './workspaceNavigation';

test('restores only an internal destination belonging to the selected project', () => {
  assert.equal(safeProjectDestination('VERV', '/project/VERV/view/12'), '/project/VERV/view/12');
  for (const unsafe of [
    'https://evil.test',
    '//evil.test',
    '/project/VERV-other',
    '/project/PRIV/view/1',
    '/project/VERV/../PRIV',
    '/project/VERV/%2e%2e',
    '/project/VERV?token=secret',
    '/project/VERV\\evil',
  ]) {
    assert.equal(safeProjectDestination('VERV', unsafe), '/project/VERV');
  }
});

test('keeps the active project section while switching projects', () => {
  assert.equal(
    matchingProjectDestination('VERV', 'KARR', '/project/VERV/code'),
    '/project/KARR/code',
  );
  assert.equal(
    matchingProjectDestination('VERV', 'KARR', '/project/VERV/settings/git'),
    '/project/KARR/settings/git',
  );
  assert.equal(
    matchingProjectDestination('VERV', 'KARR', '/project/VERV/ai-team/schedules'),
    '/project/KARR/ai-team/schedules',
  );
  assert.equal(
    matchingProjectDestination('VERV', 'KARR', '/project/VERV/view/12'),
    '/project/KARR',
  );
  assert.equal(matchingProjectDestination('VERV', 'KARR', '/project/OTHER/code'), null);
});
