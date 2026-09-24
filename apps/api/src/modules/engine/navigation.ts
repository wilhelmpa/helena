import type { StepDefinition } from './sdk';

// Where a run goes after a step: the lanes of conditions decide it. Pure functions of
// the pinned definition, so a run replayed after a restart takes the same way.

interface Located {
  step: StepDefinition;
  lane: StepDefinition[];
  index: number;
  parent: Located | null;
  branch: 'then' | 'else' | null;
}

export function locate(steps: StepDefinition[], id: string): Located | null {
  const walk = (
    lane: StepDefinition[],
    parent: Located | null,
    branch: Located['branch'],
  ): Located | null => {
    for (const [index, step] of lane.entries()) {
      const here: Located = { step, lane, index, parent, branch };
      if (step.id === id) return here;
      const found =
        (Array.isArray(step.then) ? walk(step.then, here, 'then') : null) ??
        (Array.isArray(step.else) ? walk(step.else, here, 'else') : null);
      if (found) return found;
    }
    return null;
  };
  return walk(steps, null, null);
}

// The step that follows `id` when the step went its usual way: the next one of its lane,
// or once the lane is over the step after the condition that holds it. Null ends the
// run, as does a lane that ends it.
export function stepAfter(steps: StepDefinition[], id: string): string | null {
  const here = locate(steps, id);
  if (!here) throw new Error(`The workflow has no step ${id}`);
  const next = here.lane[here.index + 1];
  if (next) return next.id;
  if (!here.parent) return null;
  const ends = here.branch === 'then' ? here.parent.step.thenEnd : here.parent.step.elseEnd;
  return ends ? null : stepAfter(steps, here.parent.step.id);
}

// Where a condition sends the run: the first step of the lane of its answer.
export function branchStart(steps: StepDefinition[], id: string, matched: boolean): string | null {
  const condition = locate(steps, id)?.step;
  if (!condition) throw new Error(`The workflow has no step ${id}`);
  const lane = (matched ? condition.then : condition.else) ?? [];
  if (lane.length > 0) return lane[0]!.id;
  return (matched ? condition.thenEnd : condition.elseEnd) ? null : stepAfter(steps, id);
}

// A step that failed or was blocked ends the run, unless the step after it branches on
// that outcome.
export function handlesOutcome(steps: StepDefinition[], next: string | null): boolean {
  if (!next) return false;
  const step = locate(steps, next)?.step;
  const condition = step?.condition as { kind?: unknown } | undefined;
  return step?.type === 'condition' && condition?.kind === 'outcome';
}
