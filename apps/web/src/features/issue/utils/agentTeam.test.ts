import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentTeamRun, AgentTeamStage } from '@/lib/api/endpoints/issues';
import { agentTeamTokens, isKnownStatus } from './agentTeam';

const stage = (inputTokens: number | null, outputTokens: number | null): AgentTeamStage => ({
  phase: 'specialize',
  assignmentId: 'assignment-1',
  agentRunId: 1,
  agent: { id: 1, username: 'ext', name: 'Ext Bot' },
  status: 'success',
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  inputTokens,
  outputTokens,
});

const run = (stages: AgentTeamStage[]): AgentTeamRun => ({
  runId: 'run-1',
  status: 'success',
  createdAt: null,
  updatedAt: null,
  steps: [],
  stages,
  result: null,
  error: null,
});

describe('agent-team runs', () => {
  test('adds up what the stages read and wrote', () => {
    assert.deepEqual(agentTeamTokens(run([stage(900, 100), stage(null, null), stage(50, null)])), {
      input: 950,
      output: 100,
    });
  });

  test('has no total when no stage reported counts', () => {
    assert.equal(agentTeamTokens(run([])), null);
    assert.equal(agentTeamTokens(run([stage(null, null)])), null);
  });

  test('labels the statuses of Mastra and of the run queue', () => {
    assert.ok(isKnownStatus('running'));
    assert.ok(isKnownStatus('canceled'));
    assert.ok(!isKnownStatus('bailed'));
  });
});
