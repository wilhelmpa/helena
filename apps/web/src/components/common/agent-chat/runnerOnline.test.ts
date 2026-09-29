import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRunnerOnline } from './runnerOnline';

describe('isRunnerOnline', () => {
  it('treats an agent without a project as offline despite a recent heartbeat', () => {
    assert.equal(
      isRunnerOnline({
        lastSeenAt: new Date().toISOString(),
        runtimeState: { detail: 'Agent no longer belongs to a project' },
      }),
      false,
    );
  });

  it('accepts a recent heartbeat for an assigned agent', () => {
    assert.equal(isRunnerOnline({ lastSeenAt: new Date().toISOString() }), true);
  });
});
