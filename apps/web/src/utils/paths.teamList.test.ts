import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentsPath, aiAgentsPath, teamListPath } from './paths';

// The agent pool is the list view of Team (Auftrag 117): its old addresses lead there and
// keep what they named.
describe('team list path', () => {
  it('is Team with the list view, on Helena and in a project', () => {
    assert.equal(agentsPath(), '/organization?orgView=list');
    assert.equal(aiAgentsPath('VOL'), '/project/VOL/organization?orgView=list');
  });

  it('keeps an old deep link’s agent, tab and run', () => {
    assert.equal(
      teamListPath('/organization', 'agent=7&tab=runs&run=3'),
      '/organization?agent=7&tab=runs&run=3&orgView=list',
    );
    // A view named in the old address gives way to the list.
    assert.equal(
      teamListPath('/organization', 'orgView=ring&team=2'),
      '/organization?orgView=list&team=2',
    );
  });
});
