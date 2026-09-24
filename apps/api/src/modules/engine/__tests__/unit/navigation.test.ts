import { describe, expect, it } from 'bun:test';
import { branchStart, handlesOutcome, locate, stepAfter } from '../../navigation';
import type { StepDefinition } from '../../sdk';

// Where a run goes after each step, as a pure function of the pinned definition: the
// same answer after a restart, so a run replayed by the engine takes the same way.

const step = (id: string, extra: Record<string, unknown> = {}): StepDefinition =>
  ({ id, name: id, type: 'agent', ...extra }) as StepDefinition;

const condition = (
  id: string,
  then: StepDefinition[],
  otherwise: StepDefinition[],
  extra: Record<string, unknown> = {},
): StepDefinition =>
  ({
    id,
    name: id,
    type: 'condition',
    condition: { kind: 'label', label: 'x' },
    then,
    else: otherwise,
    ...extra,
  }) as StepDefinition;

//  a → check ─ then: b → inner ─ then: c ; else: (empty) ─→ d
//               else: e (ends the run)
const steps: StepDefinition[] = [
  step('a'),
  condition('check', [step('b'), condition('inner', [step('c')], [])], [step('e')], {
    elseEnd: true,
  }),
  step('d'),
];

describe('engine navigation', () => {
  it('finds a step in nested lanes with its lane and parent', () => {
    const found = locate(steps, 'c')!;
    expect(found.step.id).toBe('c');
    expect(found.branch).toBe('then');
    expect(found.parent?.step.id).toBe('inner');
    expect(found.parent?.parent?.step.id).toBe('check');
    expect(locate(steps, 'nope')).toBeNull();
  });

  it('goes to the next step of the lane, then back out after the condition', () => {
    expect(stepAfter(steps, 'a')).toBe('check');
    expect(stepAfter(steps, 'b')).toBe('inner');
    // The end of an inner lane continues after the outer condition.
    expect(stepAfter(steps, 'c')).toBe('d');
    expect(stepAfter(steps, 'd')).toBeNull();
    // A lane marked as ending the run ends it.
    expect(stepAfter(steps, 'e')).toBeNull();
    expect(() => stepAfter(steps, 'nope')).toThrow('The workflow has no step nope');
  });

  it('starts the lane of the answer, or goes on after an empty lane', () => {
    expect(branchStart(steps, 'check', true)).toBe('b');
    expect(branchStart(steps, 'check', false)).toBe('e');
    expect(branchStart(steps, 'inner', true)).toBe('c');
    expect(branchStart(steps, 'inner', false)).toBe('d');
    const ending = [condition('only', [], [], { thenEnd: true }), step('z')];
    expect(branchStart(ending, 'only', true)).toBeNull();
    expect(branchStart(ending, 'only', false)).toBe('z');
  });

  it('lets a failed step go on only into a condition on its outcome', () => {
    const flow = [
      step('work'),
      { ...condition('outcome', [step('ok')], [step('fix')]), condition: { kind: 'outcome' } },
      step('plain'),
    ] as StepDefinition[];
    expect(handlesOutcome(flow, 'outcome')).toBe(true);
    expect(handlesOutcome(flow, 'plain')).toBe(false);
    expect(handlesOutcome(steps, 'check')).toBe(false);
    expect(handlesOutcome(flow, null)).toBe(false);
  });
});
