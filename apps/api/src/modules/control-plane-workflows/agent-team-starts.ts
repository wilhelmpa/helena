import { db, organizationAgentAssignment } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { startIssueAgentTeam } from './agent-team';
import { AGENT_TEAM, isWorkflowEnabled } from './service';

// An issue delegated to a coordinator of a project that runs agent teams goes to the
// team instead of a run of the coordinator. The team run is written in the same request
// and handed to the engine; while an earlier team run of the same coordinator still works
// on the issue, the delegation starts nothing new.

export function delegationPrompt(identifier: string, title: string): string {
  return `Work item ${identifier}: "${title}" has been delegated to you. Review it and take the appropriate next step.`;
}

// True when the team took the issue (or already works on it); false when it does not
// apply or cannot start, and the caller queues a run of the agent itself.
export async function startDelegatedAgentTeam(
  issueId: number,
  projectId: number,
  agentId: number,
  actorUserId: string | null,
): Promise<boolean> {
  const [coordinator] = await db
    .select({ agentId: organizationAgentAssignment.agentId })
    .from(organizationAgentAssignment)
    .where(
      and(
        eq(organizationAgentAssignment.agentId, agentId),
        eq(organizationAgentAssignment.role, 'coordinator'),
      ),
    );
  if (!coordinator || !(await isWorkflowEnabled(projectId, AGENT_TEAM))) return false;
  try {
    await startIssueAgentTeam(issueId, actorUserId, undefined, {
      trigger: 'delegation',
      coordinatorAgentId: agentId,
    });
    return true;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) throw error;
    console.error(
      '[engine] agent team did not start, queueing a run for the coordinator:',
      error.message,
    );
    return false;
  }
}
