import { describe, expect, it } from 'bun:test';
import { BUILTIN_TEMPLATES } from '../../builtin';
import {
  flattenSteps,
  LIMITS,
  stepsBefore,
  validateDefinition,
  type ActionStep,
  type AgentStep,
  type ApprovalStep,
  type PipelineStep,
} from '../../definition';
import { renderTemplate } from '../../render';
import { wakeTime, zonedTime } from '../../wait';

const agent = (id: string, instruction = 'Do it.', role = 'coder'): AgentStep => ({
  id,
  name: `Agent ${id}`,
  type: 'agent',
  assignee: { role },
  instruction,
  maxTurns: null,
  runBudgetSeconds: null,
  model: null,
  timeoutMinutes: 60,
});

const comment = (id: string, body = 'Done.'): ActionStep => ({
  id,
  name: `Comment ${id}`,
  type: 'action',
  action: { kind: 'comment', body },
});

const condition = (
  id: string,
  then: PipelineStep[],
  otherwise: PipelineStep[] = [],
  ends: { thenEnd?: boolean; elseEnd?: boolean } = {},
): PipelineStep => ({
  id,
  name: `Condition ${id}`,
  type: 'condition',
  condition: { kind: 'outcome', outcomes: ['success'] },
  then,
  else: otherwise,
  thenEnd: ends.thenEnd ?? false,
  elseEnd: ends.elseEnd ?? false,
});

function definition(steps: PipelineStep[], extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    trigger: { type: 'manual' },
    roles: [{ key: 'coder', name: 'Coder', match: { type: 'none' } }],
    steps,
    ...extra,
  };
}

const codes = (raw: unknown, template = true) =>
  validateDefinition(raw, { template }).issues.map((issue) =>
    [issue.code, issue.stepId, issue.field].filter(Boolean).join(':'),
  );

describe('workflow definition', () => {
  it('accepts every step kind and returns the definition it read', () => {
    const steps: PipelineStep[] = [
      agent('implement'),
      {
        id: 'approve',
        name: 'Approve',
        type: 'approval',
        message: 'Approve {{previous.summary}}',
        onReject: { action: 'goto', stepId: 'implement', maxLoops: 3 },
      },
      condition('ok', [comment('report', '{{step.approve.note}}')], [], { elseEnd: true }),
      {
        id: 'pause',
        name: 'Pause',
        type: 'wait',
        wait: { kind: 'until', field: 'dueDate', time: '09:00' },
      },
      {
        id: 'close',
        name: 'Close',
        type: 'action',
        action: { kind: 'set_status', status: 'Done' },
      },
    ];
    const { definition: read, issues } = validateDefinition(definition(steps), { template: true });
    expect(issues).toEqual([]);
    expect(read?.steps).toEqual(steps);
  });

  it('accepts the built-in templates', () => {
    for (const template of BUILTIN_TEMPLATES)
      expect(validateDefinition(template.definition, { template: true }).issues).toEqual([]);
  });

  it('names every missing or out-of-range field with its step', () => {
    expect(codes({ schemaVersion: 2 })).toEqual(['invalid:schemaVersion']);
    expect(
      codes(
        definition([
          { ...agent('a'), name: ' ', instruction: '', timeoutMinutes: 4, maxTurns: 201 },
          { ...comment('b'), action: { kind: 'comment', body: 'x'.repeat(LIMITS.text + 1) } },
          { id: 'c', name: 'Wait', type: 'wait', wait: { kind: 'delay', minutes: 0 } },
          {
            id: 'd',
            name: 'Wait',
            type: 'wait',
            wait: { kind: 'until', field: 'dueDate', time: '25:00' },
          },
        ]),
      ),
    ).toEqual([
      'required:a:name',
      'required:a:instruction',
      'out_of_range:a:maxTurns',
      'out_of_range:a:timeoutMinutes',
      'too_long:b:action.body',
      'out_of_range:c:wait.minutes',
      'invalid:d:wait.time',
    ]);
    expect(codes(definition([]))).toEqual(['no_steps:steps']);
    expect(
      codes(definition(Array.from({ length: LIMITS.steps + 1 }, (_, i) => comment(`s${i}`)))),
    ).toEqual(['too_many:steps']);
  });

  it('refuses duplicate ids, unknown roles and direct agents in a template', () => {
    expect(
      codes(
        definition(
          [agent('a'), agent('a', 'Again', 'writer'), { ...agent('b'), assignee: { agentId: 3 } }],
          {
            roles: [
              { key: 'coder', name: 'Coder', match: { type: 'none' } },
              { key: 'coder', name: 'Coder 2', match: { type: 'coordinator' } },
            ],
          },
        ),
      ),
    ).toEqual([
      'agent_in_template:b:assignee',
      'duplicate_role_key:roles.coder.key',
      'duplicate_step_id:a:id',
      'unknown_role:a:assignee',
    ]);
    expect(codes(definition([{ ...agent('b'), assignee: { agentId: 3 } }]), false)).toEqual([]);
  });

  it('keeps a rework loop on the path to its approval', () => {
    const approval = (target: string): ApprovalStep => ({
      id: 'approve',
      name: 'Approve',
      type: 'approval',
      message: '',
      onReject: { action: 'goto', stepId: target, maxLoops: 2 },
    });
    expect(
      codes(definition([agent('a'), condition('c', [agent('inner')]), approval('a')])),
    ).toEqual([]);
    expect(
      codes(definition([agent('a'), condition('c', [agent('inner')]), approval('inner')])),
    ).toEqual(['invalid_rework_target:approve:onReject.stepId']);
    expect(codes(definition([agent('a'), approval('approve')]))).toEqual([
      'invalid_rework_target:approve:onReject.stepId',
    ]);
    expect(codes(definition([approval('a'), agent('a')]))).toEqual([
      'invalid_rework_target:approve:onReject.stepId',
    ]);
    const loops = definition([
      agent('a'),
      { ...approval('a'), onReject: { action: 'goto', stepId: 'a', maxLoops: 11 } },
    ]);
    expect(codes(loops)).toEqual(['out_of_range:approve:onReject.maxLoops']);
  });

  it('allows only variables that exist before the step', () => {
    expect(
      codes(
        definition([
          agent('first', '{{previous.summary}} {{task.title}}'),
          agent(
            'second',
            '{{step.first.summary}} {{step.third.summary}} {{step.nope.note}} {{task.secret}} {{previous.note}}',
          ),
          agent('third'),
        ]),
      ),
    ).toEqual([
      'no_previous_step:first:instruction',
      'step_variable_not_before:second:instruction',
      'unknown_step_variable:second:instruction',
      'unknown_variable:second:instruction',
    ]);
    // A step in the lane of an earlier condition may have run; one in the other lane of
    // a condition around the step has not.
    expect(
      codes(
        definition([
          condition('c', [agent('yes')], [agent('no', '{{step.yes.summary}}')]),
          agent('after', '{{step.yes.summary}} {{step.no.summary}} {{previous.outcome}}'),
        ]),
      ),
    ).toEqual(['step_variable_not_before:no:instruction']);
  });

  it('finds the steps no run reaches', () => {
    expect(
      codes(
        definition([
          condition('c', [agent('a')], [agent('b')], { thenEnd: true, elseEnd: true }),
          agent('never'),
        ]),
      ),
    ).toEqual(['unreachable_step:never']);
    expect(codes(definition([condition('c', [], [], { thenEnd: true }), agent('after')]))).toEqual(
      [],
    );
  });

  it('limits the depth of conditions', () => {
    const deep = condition('one', [
      condition('two', [condition('three', [condition('four', [])])]),
    ]);
    expect(codes(definition([deep]))).toEqual(['too_deep:four']);
  });

  it('checks a schedule trigger', () => {
    const schedule = (cron: string, timezone: string) =>
      definition([agent('a')], { trigger: { type: 'schedule', cron, timezone, title: 'Weekly' } });
    expect(codes(schedule('0 9 * * 1', 'Europe/Berlin'))).toEqual([]);
    expect(codes(schedule('every monday', 'Europe/Berlin'))).toEqual(['invalid_cron:trigger.cron']);
    expect(codes(schedule('0 9 * * 1', 'Mars/Olympus'))).toEqual([
      'invalid_timezone:trigger.timezone',
    ]);
  });

  it('orders steps as a reader sees them and knows what came before one', () => {
    const steps = [agent('a'), condition('c', [agent('yes')], [agent('no')]), agent('z')];
    const flat = flattenSteps(steps);
    expect(flat.map((entry) => entry.step.id)).toEqual(['a', 'c', 'yes', 'no', 'z']);
    const before = (id: string) =>
      stepsBefore(flat.find((entry) => entry.step.id === id)!).map((step) => step.id);
    expect(before('no')).toEqual(['a', 'c']);
    expect(before('z')).toEqual(['a', 'c', 'yes', 'no']);
  });
});

describe('workflow variables', () => {
  it('fills known values and leaves the ones a run has not produced empty', () => {
    const context = {
      task: { title: 'Launch', description: 'Ship it', identifier: 'MKT-4', status: 'Todo' },
      previous: { summary: 'Built', outcome: 'success', note: '' },
      steps: { approve: { summary: 'Approve?', outcome: 'approved', note: 'Looks good' } },
    };
    expect(
      renderTemplate(
        '{{ task.identifier }}: {{task.title}} / {{previous.summary}} / {{step.approve.note}} / [{{step.other.summary}}]',
        context,
      ),
    ).toBe('MKT-4: Launch / Built / Looks good / []');
  });
});

describe('wait steps', () => {
  it('take the wall-clock time in Berlin, summer and winter', () => {
    expect(zonedTime('2026-07-01', '09:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    );
    expect(zonedTime('2026-12-01', '09:00', 'Europe/Berlin').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
    expect(zonedTime('2026-12-01', '00:30', 'Europe/Berlin').toISOString()).toBe(
      '2026-11-30T23:30:00.000Z',
    );
  });

  it('wait a delay or until the date of the task', () => {
    const now = Date.parse('2026-09-23T10:00:00Z');
    const task = { dueDate: '2026-09-25', startDate: null };
    expect(wakeTime({ kind: 'delay', minutes: 90 }, task, now)?.toISOString()).toBe(
      '2026-09-23T11:30:00.000Z',
    );
    expect(
      wakeTime({ kind: 'until', field: 'dueDate', time: '09:00' }, task, now)?.toISOString(),
    ).toBe('2026-09-25T07:00:00.000Z');
    expect(wakeTime({ kind: 'until', field: 'startDate', time: '09:00' }, task, now)).toBeNull();
  });
});
