import { describe, it, expect } from 'bun:test';
import type { AgentRuntimePolicy } from '../../../core/service';
import {
  COMPLEX_TOOL_CALLS,
  reflectionPrompt,
  reflectionReason,
  reflectionView,
} from '../../reflection';

const policy = (patch: Partial<AgentRuntimePolicy> = {}): AgentRuntimePolicy => ({
  reasoningEffort: null,
  toolAllow: [],
  toolDeny: [],
  mcpGrants: [],
  files: [],
  ...patch,
});

describe('reflectionReason', () => {
  it('never reflects for an agent that does not learn, whatever the run', () => {
    expect(
      reflectionReason(policy({ learning: false }), {
        status: 'failed',
        toolCalls: 5,
        rework: false,
      }),
    ).toBeNull();
    expect(
      reflectionReason(policy({ learning: false, reflection: 'complex' }), {
        status: 'success',
        toolCalls: 999,
        rework: true,
      }),
    ).toBeNull();
  });

  it("never reflects with the mode set to 'off'", () => {
    expect(
      reflectionReason(policy({ reflection: 'off' }), {
        status: 'failed',
        toolCalls: 5,
        rework: false,
      }),
    ).toBeNull();
  });

  it('reflects on a failed run only when the agent made a tool call', () => {
    expect(
      reflectionReason(policy(), { status: 'failed', toolCalls: 0, rework: false }),
    ).toBeNull();
    expect(reflectionReason(policy(), { status: 'failed', toolCalls: 1, rework: false })).toBe(
      'failure',
    );
  });

  it('reflects on rework in any mode but off, whatever the tool calls', () => {
    expect(
      reflectionReason(policy({ reflection: 'failure' }), {
        status: 'success',
        toolCalls: 0,
        rework: true,
      }),
    ).toBe('rework');
    expect(
      reflectionReason(policy({ reflection: 'complex' }), {
        status: 'success',
        toolCalls: 0,
        rework: true,
      }),
    ).toBe('rework');
  });

  it("reflects on a complex run only in 'complex' mode, the default", () => {
    const run = { status: 'success' as const, toolCalls: COMPLEX_TOOL_CALLS, rework: false };
    expect(reflectionReason(policy(), run)).toBe('complex');
    expect(reflectionReason(policy({ reflection: 'complex' }), run)).toBe('complex');
    expect(reflectionReason(policy({ reflection: 'failure' }), run)).toBeNull();
  });

  it('leaves a short, successful run without reflection', () => {
    expect(
      reflectionReason(policy(), {
        status: 'success',
        toolCalls: COMPLEX_TOOL_CALLS - 1,
        rework: false,
      }),
    ).toBeNull();
  });
});

describe('reflectionPrompt', () => {
  it('tells the agent to touch only memory and skills, never to continue the task', () => {
    for (const reason of ['failure', 'rework', 'complex'] as const) {
      const prompt = reflectionPrompt(reason);
      expect(prompt).toContain('Only your memory and skill tools are available now');
      expect(prompt).toContain('do not continue the task');
      expect(prompt).toContain('Leave the skills in the plan-managed category alone');
    }
  });

  it('focuses each reason on its own lesson', () => {
    expect(reflectionPrompt('failure')).toContain('The task failed');
    expect(reflectionPrompt('rework')).toContain('came back to work');
    expect(reflectionPrompt('complex')).toContain('took many steps');
  });
});

describe('reflectionView', () => {
  it('is null for a run without a reflection', () => {
    expect(reflectionView(null, null)).toBeNull();
    expect(reflectionView(undefined, new Date())).toBeNull();
  });

  it('defaults a bare record to a pending, complex reflection with nothing saved', () => {
    expect(reflectionView({}, null)).toEqual({
      status: 'pending',
      reason: 'complex',
      saved: [],
      summary: null,
      error: null,
    });
  });

  it('sums the tokens only once either count was reported', () => {
    expect(
      reflectionView({ status: 'success', inputTokens: 10, outputTokens: null }, null),
    ).toMatchObject({ tokens: 10 });
    expect(reflectionView({ status: 'success' }, null)).not.toHaveProperty('tokens');
  });

  it('reports a pending reflection unfinished this long as lost', () => {
    const justNow = new Date();
    const longAgo = new Date(Date.now() - 20 * 60_000);
    expect(reflectionView({ status: 'pending' }, justNow)?.status).toBe('pending');
    expect(reflectionView({ status: 'pending' }, longAgo)?.status).toBe('lost');
    // A finished reflection is never lost, whatever the run's age.
    expect(reflectionView({ status: 'success' }, longAgo)?.status).toBe('success');
    // A run still running has no finishedAt, so its pending reflection is not yet lost.
    expect(reflectionView({ status: 'pending' }, null)?.status).toBe('pending');
  });
});
