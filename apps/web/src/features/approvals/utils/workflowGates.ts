import type { WorkflowGate, WorkflowGateList } from '@/lib/api/endpoints/approvals';

// A run id is unique within its workflow and project only.
export function gateKey(gate: Pick<WorkflowGate, 'projectKey' | 'workflowId' | 'runId'>): string {
  return `${gate.projectKey}:${gate.workflowId}:${gate.runId}`;
}

// The list after a decision on one gate. Mastra resumes the run after it answers, so a
// read right away can still find the run suspended; the decided gate is dropped here
// instead of being read again.
export function withoutGate(
  list: WorkflowGateList | undefined,
  gate: WorkflowGate,
): WorkflowGateList | undefined {
  if (!list) return list;
  const key = gateKey(gate);
  return { ...list, items: list.items.filter((item) => gateKey(item) !== key) };
}
