import { describe, expect, it } from 'bun:test';
import { isRunnerOnline } from './runnerOnline';

describe('isRunnerOnline', () => {
  it('treats an agent without a project as offline despite a recent heartbeat', () => {
    expect(
      isRunnerOnline({
        lastSeenAt: new Date().toISOString(),
        runtimeState: { detail: 'Agent no longer belongs to a project' },
      }),
    ).toBe(false);
  });

  it('accepts a recent heartbeat for an assigned agent', () => {
    expect(isRunnerOnline({ lastSeenAt: new Date().toISOString() })).toBe(true);
  });
});
