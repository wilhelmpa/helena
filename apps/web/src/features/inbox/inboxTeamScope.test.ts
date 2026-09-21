import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveInboxTeamId } from './inboxTeamScope';

describe('resolveInboxTeamId', () => {
  it('never falls back to another team while a project is unresolved', () => {
    assert.equal(
      resolveInboxTeamId({
        projectKey: 'PRIV',
        currentTeamId: 2,
        availableTeamIds: [1, 2],
      }),
      null,
    );
  });

  it('uses the project team once resolved', () => {
    assert.equal(
      resolveInboxTeamId({
        projectKey: 'PRIV',
        projectTeamId: 2,
        currentTeamId: 1,
        availableTeamIds: [1, 2],
      }),
      2,
    );
  });

  it('keeps the current available team for the global inbox', () => {
    assert.equal(
      resolveInboxTeamId({
        projectKey: null,
        currentTeamId: 2,
        availableTeamIds: [1, 2],
      }),
      2,
    );
  });
});
