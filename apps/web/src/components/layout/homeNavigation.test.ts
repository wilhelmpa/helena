import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { homeNavigation } from './homeNavigation';

describe('home sidebar navigation', () => {
  test('without a single team shows what reads across projects and the shared services', () => {
    assert.deepEqual(homeNavigation(null), [
      { id: 'overview', group: 'work', href: '/' },
      { id: 'allWorkItems', group: 'work', href: '/tasks' },
      { id: 'inbox', group: 'work', href: '/inbox' },
      { id: 'approvals', group: 'work', href: '/approvals' },
      { id: 'agentActivity', group: 'agents', href: '/activity' },
      { id: 'schedules', group: 'agents', href: '/schedules' },
      { id: 'connections', group: 'globalSettings', href: '/connections' },
      { id: 'vault', group: 'globalSettings', href: '/vault' },
      { id: 'teamSettings', group: 'globalSettings', href: '/account/teams' },
    ]);
  });

  test('groups a single team into work, agents and global settings', () => {
    assert.deepEqual(homeNavigation(42), [
      { id: 'overview', group: 'work', href: '/' },
      { id: 'allWorkItems', group: 'work', href: '/tasks' },
      { id: 'inbox', group: 'work', href: '/inbox' },
      { id: 'approvals', group: 'work', href: '/approvals' },
      { id: 'agentPool', group: 'agents', href: '/agents' },
      { id: 'organization', group: 'agents', href: '/organization' },
      { id: 'agentActivity', group: 'agents', href: '/activity' },
      { id: 'schedules', group: 'agents', href: '/schedules' },
      { id: 'workflows', group: 'agents', href: '/workflows' },
      { id: 'skills', group: 'globalSettings', href: '/skills' },
      { id: 'tools', group: 'globalSettings', href: '/tools' },
      { id: 'mcps', group: 'globalSettings', href: '/mcps' },
      { id: 'connections', group: 'globalSettings', href: '/connections' },
      { id: 'vault', group: 'globalSettings', href: '/vault' },
      { id: 'teamSettings', group: 'globalSettings', href: '/account/teams' },
    ]);
    const ids = homeNavigation(42).map((item) => item.id) as string[];
    assert.ok(!ids.includes('notifications'));
    assert.ok(!ids.includes('workItems'));
    assert.ok(!ids.includes('apiDocs'));
  });

  test('hides the vault when the runtime disables it', () => {
    assert.ok(!homeNavigation(42, false).some((item) => item.id === 'vault'));
  });
});
