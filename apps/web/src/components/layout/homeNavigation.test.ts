import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { homeNavigation } from './homeNavigation';

describe('home sidebar navigation', () => {
  test('shows central services and team management without project-only sections', () => {
    assert.deepEqual(homeNavigation(null), [
      { id: 'connections', href: '/connections' },
      { id: 'vault', href: '/vault' },
      { id: 'manageTeams', href: '/account/teams' },
    ]);
  });

  test('links a single team through persistent global shell routes', () => {
    assert.deepEqual(homeNavigation(42), [
      { id: 'agentPool', href: '/agents' },
      { id: 'connections', href: '/connections' },
      { id: 'vault', href: '/vault' },
      { id: 'mcps', href: '/mcps' },
      { id: 'tools', href: '/tools' },
      { id: 'skills', href: '/skills' },
      { id: 'manageTeams', href: '/account/teams' },
    ]);
    const ids = homeNavigation(42).map((item) => item.id) as string[];
    assert.ok(!ids.includes('notifications'));
    assert.ok(!ids.includes('workItems'));
    assert.ok(!ids.includes('apiDocs'));
  });
});
