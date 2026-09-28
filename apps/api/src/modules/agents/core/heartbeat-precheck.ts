export interface HeartbeatCandidate {
  projectId: number;
  issueId: number | null;
  title: string;
  reason: string;
  priority?: string | null;
  dueDate?: string | null;
  candidateCount?: number;
  stateType?: string;
}

// Only a single undated, low-priority backlog item may be suppressed by a model.
// Active work, new comments and due work always reach the agent.
export function isBorderlineHeartbeat(candidate: HeartbeatCandidate): boolean {
  return (
    candidate.reason === 'open task' &&
    candidate.priority === 'low' &&
    !candidate.dueDate &&
    candidate.stateType === 'backlog' &&
    Number(candidate.candidateCount) === 1
  );
}
