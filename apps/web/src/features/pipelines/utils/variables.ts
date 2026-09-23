import type { PipelineStep } from '@/lib/api/endpoints/pipelines';
import { flattenSteps, type FlatStep } from './editorState';

// The {{…}} variables a step's texts may use, as definition.ts checks them.

export const TASK_VARIABLES = [
  'task.title',
  'task.description',
  'task.identifier',
  'task.status',
] as const;

const RESULT_FIELDS = ['summary', 'outcome', 'note'] as const;

// A condition and a wait only decide where and when the run goes on; the other steps
// leave a result the next steps read.
export function producesResult(step: PipelineStep): boolean {
  return step.type === 'agent' || step.type === 'approval' || step.type === 'action';
}

function descendants(step: PipelineStep): PipelineStep[] {
  return step.type === 'condition'
    ? [...step.then, ...step.else].flatMap((child) => [child, ...descendants(child)])
    : [];
}

// The steps a run may have executed before it reaches the step: its path, and the lanes
// of the earlier conditions on it.
function stepsBefore(entry: FlatStep): PipelineStep[] {
  return entry.path.flatMap((step) =>
    step.type === 'condition' && !entry.ancestors.includes(step)
      ? [step, ...descendants(step)]
      : [step],
  );
}

export interface StepVariables {
  task: string[];
  // Empty when no step before this one leaves a result.
  previous: string[];
  steps: { id: string; name: string; variables: string[] }[];
}

// The variables valid in the texts of the step. A step not in the list yet, being
// added, reads the task only.
export function variablesAt(steps: PipelineStep[], stepId: string): StepVariables {
  const entry = flattenSteps(steps).find((item) => item.step.id === stepId);
  const before = entry ? stepsBefore(entry).filter(producesResult) : [];
  return {
    task: [...TASK_VARIABLES],
    previous: before.length ? RESULT_FIELDS.map((field) => `previous.${field}`) : [],
    steps: before.map((step) => ({
      id: step.id,
      name: step.name,
      variables: RESULT_FIELDS.map((field) => `step.${step.id}.${field}`),
    })),
  };
}

// The text with `{{variable}}` put in at the caret, or in place of the selection.
export function insertVariable(
  text: string,
  variable: string,
  selection: { start: number; end: number },
): { text: string; caret: number } {
  const token = `{{${variable}}}`;
  return {
    text: text.slice(0, selection.start) + token + text.slice(selection.end),
    caret: selection.start + token.length,
  };
}
