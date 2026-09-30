import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeDashboardPath, homeDashboardView } from './views';

test('the projects view is named by the parameter, anything else is the overview', () => {
  assert.equal(homeDashboardView('projects'), 'projects');
  assert.equal(homeDashboardView(null), 'overview');
  assert.equal(homeDashboardView('nonsense'), 'overview');
  assert.equal(homeDashboardView(''), 'overview');
});

test('each view has its address, the overview the plain dashboard address', () => {
  assert.equal(homeDashboardPath('overview'), '/dashboard');
  assert.equal(homeDashboardPath('projects'), '/dashboard?view=projects');
  assert.equal(
    homeDashboardView(new URL(`http://x${homeDashboardPath('projects')}`).searchParams.get('view')),
    'projects',
  );
});
