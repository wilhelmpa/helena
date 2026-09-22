import type { WorkflowRun } from '@/lib/api/endpoints/controlPlaneWorkflows';

export function workflowRunRows(value: { runs?: WorkflowRun[] } | WorkflowRun[] | undefined) {
  return Array.isArray(value) ? value : (value?.runs ?? []);
}

export function workflowRunId(run: WorkflowRun) {
  return run.runId ?? run.id ?? '';
}
