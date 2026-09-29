import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_POLICY,
  dependencyWaves,
  parseStage,
  routeTask,
  stagePolicy,
  stagePrompt,
  type Delegation,
  type TeamPayload,
} from '../../builtin/steps/agent-team';

// The pure parts of the agent-team step: routing without a coordinator, the order of the
// assignments, the stage contract and the stage policy. Ported from the unit tests of the
// Mastra agent-team workflow.

const member = (agentRef: string, capabilities: string[] = []) => ({
  agentRef,
  role: 'specialist',
  capabilities,
});

function team(overrides: Partial<TeamPayload> = {}): TeamPayload {
  return {
    schemaVersion: 1,
    task: {
      taskRef: 'task:MKT-1',
      title: 'Launch page',
      objective: 'Build the launch page.',
      acceptanceCriteria: ['The page is live.'],
      labels: [],
    },
    coordinator: { ...member('agent:lead'), role: 'coordinator' },
    specialists: [member('agent:writer', ['copy']), member('agent:coder', ['frontend'])],
    policy: DEFAULT_POLICY,
    execution: {},
    ...overrides,
  };
}

const delegation = (assignmentId: string, dependsOn: string[] = []): Delegation => ({
  assignmentId,
  agentRef: 'agent:writer',
  objective: `Do ${assignmentId}`,
  acceptanceCriteria: ['Done.'],
  dependsOn,
});

describe('agent team routing', () => {
  it('routes to the only specialist, or the one whose capability a label names', () => {
    expect(routeTask(team({ specialists: [member('agent:writer')] }))).toEqual({
      agentRef: 'agent:writer',
      reason: 'the team has one specialist',
    });
    const labelled = team();
    labelled.task.labels = ['Frontend'];
    expect(routeTask(labelled)?.agentRef).toBe('agent:coder');
    // No label, or a label that fits two, needs the coordinator.
    expect(routeTask(team())).toBeNull();
    const both = team({
      specialists: [member('agent:a', ['web']), member('agent:b', ['web'])],
    });
    both.task.labels = ['web'];
    expect(routeTask(both)).toBeNull();
  });
});

describe('agent team dependency order', () => {
  it('runs independent assignments together and dependent ones after', () => {
    const waves = dependencyWaves([
      delegation('copy'),
      delegation('design'),
      delegation('build', ['copy', 'design']),
      delegation('ship', ['build']),
    ]);
    expect(waves.map((wave) => wave.map((item) => item.assignmentId))).toEqual([
      ['copy', 'design'],
      ['build'],
      ['ship'],
    ]);
  });

  it('refuses duplicate ids, unknown dependencies and cycles', () => {
    expect(() => dependencyWaves([delegation('a'), delegation('a')])).toThrow(
      'Assignment a is delegated twice',
    );
    expect(() => dependencyWaves([delegation('a', ['b'])])).toThrow(
      'Assignment a depends on unknown assignment b',
    );
    expect(() => dependencyWaves([delegation('a', ['b']), delegation('b', ['a'])])).toThrow(
      'Assignment dependencies form a cycle',
    );
  });
});

describe('agent team stage contract', () => {
  const coordinate = { phase: 'coordinate' as const, team: team(), agent: team().coordinator };

  it('reads a coordinator plan, alone or in a json fence', () => {
    const plan = {
      summary: 'Two parts.',
      delegations: [
        {
          assignmentId: 'copy',
          agentRef: 'agent:writer',
          objective: 'Write the copy.',
          acceptanceCriteria: ['Copy approved.'],
          dependsOn: [],
        },
      ],
    };
    const parsed = parseStage(coordinate, JSON.stringify(plan));
    expect(parsed).toMatchObject({ summary: 'Two parts.', status: 'completed', evidence: [] });
    expect(parsed.delegations).toHaveLength(1);
    const fenced = parseStage(coordinate, `\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``);
    expect(fenced.delegations[0]?.assignmentId).toBe('copy');
  });

  it('accepts a reasoned plan with no specialist assignments', () => {
    expect(
      parseStage(
        coordinate,
        JSON.stringify({ summary: 'The coordinator can complete this task.', delegations: [] }),
      ),
    ).toMatchObject({
      summary: 'The coordinator can complete this task.',
      delegations: [],
      status: 'completed',
    });
  });

  it('refuses prose, a missing summary, a foreign specialist and bad evidence', () => {
    expect(() => parseStage(coordinate, 'Sure, here is the plan.')).toThrow(
      'The agent did not answer with one JSON object',
    );
    expect(() => parseStage(coordinate, null)).toThrow('The agent returned no usable answer');
    expect(() => parseStage(coordinate, '{"delegations":[]}')).toThrow(
      'The agent answered without a summary',
    );
    const foreign = {
      summary: 'x',
      delegations: [{ ...delegation('a'), agentRef: 'agent:stranger' }],
    };
    expect(() => parseStage(coordinate, JSON.stringify(foreign))).toThrow(
      'The coordinator returned an invalid assignment',
    );
    const specialize = { ...coordinate, phase: 'specialize' as const };
    expect(() =>
      parseStage(specialize, JSON.stringify({ summary: 'x', evidence: [{ kind: 'photo' }] })),
    ).toThrow('The agent returned invalid evidence');
  });

  it('reads a review and marks rejected work for review', () => {
    const review = { ...coordinate, phase: 'review' as const };
    expect(
      parseStage(review, JSON.stringify({ summary: 'ok', review: { accepted: true, notes: '' } })),
    ).toMatchObject({ status: 'completed', review: { accepted: true } });
    expect(
      parseStage(
        review,
        JSON.stringify({ summary: 'no', review: { accepted: false, notes: 'Missing tests.' } }),
      ),
    ).toMatchObject({
      status: 'needs-review',
      review: { accepted: false, notes: 'Missing tests.' },
    });
    expect(() => parseStage(review, JSON.stringify({ summary: 'ok' }))).toThrow(
      'The coordinator returned an invalid review',
    );
  });

  it('tells the coordinator to plan only and names the allowed specialists', () => {
    const prompt = stagePrompt(coordinate, 'project:MKT');
    expect(prompt).toContain('Phase: coordinate');
    expect(prompt).toContain('Only plan assignments. Ava executes each delegation');
    expect(prompt).toContain('If no specialist is needed, return delegations: []');
    expect(prompt).toContain('"agentRef":"agent:writer"');
    expect(prompt).not.toContain('Mastra');
    expect(prompt).not.toContain('already started');
  });

  // A routine's instructions that @mention specialists start them on the task directly; the
  // coordinator the routine delegates to must not hand them their parts again.
  it('tells the coordinator which agents a routine already started on the task', () => {
    const prompt = stagePrompt(coordinate, 'project:MKT', ['writer', 'coder']);
    expect(prompt).toContain(
      'The routine behind this task already started @writer, @coder on it directly',
    );
    expect(prompt).toContain('Do not assign those parts again; plan only the rest.');
  });
});

describe('agent team stage policy', () => {
  it('gives a stage five minutes more than its run budget, up to two hours', () => {
    expect(stagePolicy({}).timeoutSeconds).toBe(900);
    expect(stagePolicy({ runBudgetSeconds: 1_800 }).timeoutSeconds).toBe(2_100);
    expect(stagePolicy({ runBudgetSeconds: 60 }).timeoutSeconds).toBe(900);
    expect(stagePolicy({ runBudgetSeconds: 10_000 }).timeoutSeconds).toBe(7_200);
  });
});
