import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { RUN_PARAM } from '@/features/agent-runtime/runOverlay';
import {
  agentActivityForAgentPath,
  agentActivityPath,
  globalAgentActivityPath,
  issuePath,
} from '@/utils/paths';

// The statuses of an entry that is still at work.
export const ACTIVE_ACTIVITY_STATUSES = new Set(['running', 'streaming']);

// Where one entry of the timeline leads: its task, a run without a task in the run overlay
// over Helena, else the agent's timeline.
export function activityEntryHref(entry: AgentActivityEntry): string {
  if (entry.issue && entry.project) return issuePath(entry.project.key, entry.issue.sequenceNumber);
  if (entry.kind === 'agent-run' && entry.agent && entry.id.startsWith('run:'))
    return `/?${RUN_PARAM}=${entry.agent.id}.${entry.id.slice(4)}`;
  if (entry.agent) return agentActivityForAgentPath(entry.agent.id, entry.project?.key);
  return globalAgentActivityPath();
}

// "N Agenten arbeiten" as a link (owner, 28.09.): exactly one run opens that run (or its
// task); otherwise the Verlauf of the project, or of Helena, filtered to what is running.
export function runningActivityHref(
  active: AgentActivityEntry[],
  projectKey: string | null,
): string {
  if (active.length === 1) return activityEntryHref(active[0]!);
  const base = projectKey ? agentActivityPath(projectKey) : globalAgentActivityPath();
  return `${base}?status=running`;
}
