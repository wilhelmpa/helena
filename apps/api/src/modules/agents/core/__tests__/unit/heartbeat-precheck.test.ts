import { describe, expect, it } from 'bun:test';
import { isBorderlineHeartbeat, type HeartbeatCandidate } from '../../heartbeat-precheck';

const candidate: HeartbeatCandidate = {
  projectId: 1,
  issueId: 2,
  title: 'Optionales Aufräumen',
  reason: 'open task',
  priority: 'low',
  dueDate: null,
  candidateCount: 1,
  stateType: 'backlog',
};

describe('heartbeat precheck boundary', () => {
  it('checks only a single undated low-priority backlog item', () => {
    expect(isBorderlineHeartbeat(candidate)).toBe(true);
  });

  it('sends active, due, urgent and multiple items to the agent', () => {
    for (const patch of [
      { stateType: 'started' },
      { dueDate: '2026-09-28' },
      { priority: 'high' },
      { candidateCount: 2 },
      { reason: 'new comment' },
    ])
      expect(isBorderlineHeartbeat({ ...candidate, ...patch })).toBe(false);
  });
});
