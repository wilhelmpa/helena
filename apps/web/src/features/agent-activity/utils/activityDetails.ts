import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { aiTeamPath, issuePath, workflowRunPath, workflowsPath } from '@/utils/paths';

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

// Where an entry's details are: the conversation of a chat answer, the agent-team run on
// the Workflows page, a routine's on the Schedules page and a workflow's on the
// Workflows page. A run of an agent has its details on its task.
export function activityDetails(entry: AgentActivityEntry): ActivityTarget | null {
  if (entry.kind === 'chat')
    return entry.agent && entry.threadId
      ? { kind: 'chat', agentId: entry.agent.id, threadId: entry.threadId }
      : null;
  if (!entry.project || !entry.workflowRunId) return null;
  if (entry.workflowId === 'agent-team')
    return {
      kind: 'page',
      href: workflowRunPath(entry.project.key, entry.workflowId, entry.workflowRunId),
    };
  if (entry.workflowId === 'routine')
    return { kind: 'page', href: aiTeamPath(entry.project.key, 'schedules') };
  if (entry.workflowId) return { kind: 'page', href: workflowsPath(entry.project.key) };
  return null;
}
