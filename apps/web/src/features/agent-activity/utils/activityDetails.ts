import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { issuePath, workflowRunPath } from '@/utils/paths';

export type ActivityTarget =
  { kind: 'page'; href: string } | { kind: 'chat'; agentId: number; threadId: string };

// The task an entry belongs to, as a link.
export function activityTask(entry: AgentActivityEntry): { href: string; label: string } | null {
  if (!entry.project || !entry.issue) return null;
  return {
    href: issuePath(entry.project.key, entry.issue.sequenceNumber),
    label: `${entry.issue.identifier} ${entry.issue.title}`,
  };
}

// Where an entry's details are: the conversation of a chat answer, the Workflows page
// for a workflow run. A run of an agent has its details on its task.
export function activityDetails(entry: AgentActivityEntry): ActivityTarget | null {
  if (entry.kind === 'chat')
    return entry.agent && entry.threadId
      ? { kind: 'chat', agentId: entry.agent.id, threadId: entry.threadId }
      : null;
  if (entry.project && entry.workflowId && entry.workflowRunId)
    return {
      kind: 'page',
      href: workflowRunPath(entry.project.key, entry.workflowId, entry.workflowRunId),
    };
  return null;
}
