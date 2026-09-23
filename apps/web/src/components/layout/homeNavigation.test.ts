import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { homeNavigation } from './homeNavigation';

describe('home sidebar navigation', () => {
  test('shows central services and team management without project-only sections', () => {
    assert.deepEqual(homeNavigation(null), [
      { id: 'connections', href: '/connections' },
      { id: 'vault', href: '/vault' },
      { id: 'teamSettings', href: '/account/teams' },
    ]);
  });

  test('links a single team through persistent global shell routes', () => {
    assert.deepEqual(homeNavigation(42), [
      { id: 'agentPool', href: '/agents' },
      { id: 'organization', href: '/organization' },
      { id: 'connections', href: '/connections' },
      { id: 'vault', href: '/vault' },
      { id: 'mcps', href: '/mcps' },
      { id: 'tools', href: '/tools' },
      { id: 'skills', href: '/skills' },
      { id: 'teamSettings', href: '/account/teams' },
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
