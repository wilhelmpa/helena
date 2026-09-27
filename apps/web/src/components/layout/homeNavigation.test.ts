import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { homeNavigation } from './homeNavigation';

describe('home sidebar navigation', () => {
  test('without a single team shows what reads across projects and the shared services', () => {
    assert.deepEqual(homeNavigation(null), [
      { id: 'overview', group: 'work', href: '/dashboard' },
      { id: 'allWorkItems', group: 'work', href: '/tasks' },
      { id: 'inbox', group: 'work', href: '/inbox' },
      { id: 'files', group: 'work', href: '/files' },
      { id: 'approvals', group: 'work', href: '/approvals' },
      { id: 'agentActivity', group: 'agents', href: '/activity' },
      { id: 'browser', group: 'agents', href: '/browsers' },
      { id: 'schedules', group: 'agents', href: '/schedules' },
      { id: 'access', group: 'globalSettings', href: '/access' },
      { id: 'devices', group: 'globalSettings', href: '/devices' },
      { id: 'teamSettings', group: 'globalSettings', href: '/account/teams' },
    ]);
  });

  test('groups a single team into work, agents and global settings', () => {
    assert.deepEqual(homeNavigation(42), [
      { id: 'overview', group: 'work', href: '/dashboard' },
      { id: 'allWorkItems', group: 'work', href: '/tasks' },
      { id: 'inbox', group: 'work', href: '/inbox' },
      { id: 'files', group: 'work', href: '/files' },
      { id: 'approvals', group: 'work', href: '/approvals' },
      { id: 'agentPool', group: 'agents', href: '/agents' },
      { id: 'organization', group: 'agents', href: '/organization' },
      { id: 'agentActivity', group: 'agents', href: '/activity' },
      { id: 'browser', group: 'agents', href: '/browsers' },
      { id: 'schedules', group: 'agents', href: '/schedules' },
      { id: 'workflows', group: 'agents', href: '/workflows' },
      { id: 'skills', group: 'globalSettings', href: '/skills' },
      { id: 'tools', group: 'globalSettings', href: '/tools' },
      { id: 'mcps', group: 'globalSettings', href: '/mcps' },
      { id: 'access', group: 'globalSettings', href: '/access' },
      { id: 'decisions', group: 'globalSettings', href: '/decisions' },
      { id: 'devices', group: 'globalSettings', href: '/devices' },
      { id: 'teamSettings', group: 'globalSettings', href: '/account/teams' },
    ]);
    const ids = homeNavigation(42).map((item) => item.id) as string[];
    assert.ok(!ids.includes('notifications'));
    assert.ok(!ids.includes('workItems'));
    assert.ok(!ids.includes('apiDocs'));
    // The Home chat has its own entry in the personal sidebar.
    assert.ok(!ids.includes('chat'));
  });

  test('offers exactly one file entry for owners and members', () => {
    for (const owner of [false, true]) {
      const items = homeNavigation(42, owner);
      assert.equal(items.filter((item) => item.id === 'files').length, 1);
      assert.equal(
        items.some((item) => item.id === 'docs'),
        false,
      );
    }
  });
});
