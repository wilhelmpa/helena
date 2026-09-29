import type { PipelineDefinition, PipelineStep } from '@/lib/api/endpoints/pipelines';

// A workflow's steps in the order they run, by name, for a card that shows what the
// workflow does at a glance (owner, O25: the templates were not understandable). A branch
// counts as its own name; its lanes are left out.
export function flowSummary(
  definition: Pick<PipelineDefinition, 'steps'>,
  limit = 6,
): {
  names: string[];
  more: number;
} {
  const names = definition.steps.map((step: PipelineStep) => step.name).filter(Boolean);
  return { names: names.slice(0, limit), more: Math.max(0, names.length - limit) };
}
