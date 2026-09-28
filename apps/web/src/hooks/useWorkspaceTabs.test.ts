import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  moveWorkspaceTab,
  orderWorkspaceTabs,
  parseWorkspaceTabs,
  syncBrowserTabs,
  workspaceTabsKey,
} from './useWorkspaceTabs';

test('tool and browser tabs can be opened, ordered, closed and restored', () => {
  const open = parseWorkspaceTabs(
    JSON.stringify(['tool:chat', 'tool:terminal', 'browser:b', 'browser:a']),
  );
  assert.deepEqual(open, ['tool:chat', 'tool:terminal', 'browser:b', 'browser:a']);
  const moved = moveWorkspaceTab(open, 'browser:a', 'tool:terminal');
  assert.deepEqual(moved, ['tool:chat', 'browser:a', 'tool:terminal', 'browser:b']);
  const withNewBrowser = syncBrowserTabs(moved, ['a', 'b', 'c']);
  assert.deepEqual(withNewBrowser, [...moved, 'browser:c']);
  const closed = syncBrowserTabs(withNewBrowser, ['a', 'c']);
  assert.deepEqual(closed, ['tool:chat', 'browser:a', 'tool:terminal', 'browser:c']);
  assert.deepEqual(orderWorkspaceTabs(closed, parseWorkspaceTabs(JSON.stringify(closed))), closed);
});

test('tabs have separate project stores and retain plugin tool identifiers', () => {
  assert.notEqual(workspaceTabsKey('TRADE'), workspaceTabsKey('HOME'));
  assert.deepEqual(parseWorkspaceTabs('["tool:plugin:custom:one","tool:chat"]'), [
    'tool:plugin:custom:one',
    'tool:chat',
  ]);
  assert.deepEqual(parseWorkspaceTabs('invalid'), ['tool:chat']);
});
