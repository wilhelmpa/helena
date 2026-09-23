import { randomUUID } from 'node:crypto';
import { agentTeamStart, aiAgent, db, issue, organizationAgentAssignment, project } from '@repo/db';
import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { HttpError, intEnv } from '#shared/lib';
import { enqueueAgentRun } from '#modules/agents/core/run-queue';
import { getAssignTriggerAgent } from '#modules/agents/core/service';
import { startIssueAgentTeam } from './agent-team';
import { controlPlaneRequest, isWorkflowEnabled } from './service';

// An issue delegated to a coordinator starts agent-team through a row of
// agent_team_start. The row is written before Mastra is asked, and a start Mastra did
// not answer is asked for again with the same event id, which Mastra answers with the
// run it already has. So a delegation is neither lost while Mastra is down nor started
// twice after a timeout. A start Mastra refuses queues a run of the coordinator instead.

type StartRow = typeof agentTeamStart.$inferSelect;

export type StartOutcome = 'started' | 'waiting' | 'refused' | 'superseded';

// The statuses of a Mastra run that still works on its issue.
const ACTIVE_RUN = new Set(['pending', 'running', 'waiting', 'suspended', 'paused']);

// Seconds before a start that Mastra did not answer is asked for again: the first wait,
// tripled with each attempt up to five minutes.
const retrySeconds = (attempts: number) =>
  Math.min(300, intEnv('AGENT_TEAM_START_RETRY_SECONDS', 5) * 3 ** attempts);

// How long a start being asked for is left alone by another api process.
const LEASE_SECONDS = 60;

export function delegationPrompt(identifier: string, title: string): string {
  return `Work item ${identifier}: "${title}" has been delegated to you. Review it and take the appropriate next step.`;
}

// Starts agent-team for an issue delegated to a coordinator, when the project runs the
// workflow. False when it does not apply or Mastra refused the start: the caller then
// queues a run for the agent itself. True when the start is made or waits for Mastra.
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
  if (!coordinator || !(await isWorkflowEnabled(projectId, 'agent-team'))) return false;
  return (await requestAgentTeamStart({ issueId, projectId, agentId, actorUserId })) !== 'refused';
}

// Records the start and asks Mastra for it at once. An issue with a start still waiting
// for Mastra gets no second one.
export async function requestAgentTeamStart(input: {
  issueId: number;
  projectId: number;
  agentId: number;
  actorUserId: string | null;
}): Promise<StartOutcome> {
  const row = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`agent-team-start:${input.issueId}`}, 0))`,
    );
    const [waiting] = await tx
      .select({ id: agentTeamStart.id })
      .from(agentTeamStart)
      .where(and(eq(agentTeamStart.issueId, input.issueId), eq(agentTeamStart.status, 'pending')))
      .limit(1);
    if (waiting) return null;
    const [created] = await tx
      .insert(agentTeamStart)
      .values({
        ...input,
        eventId: randomUUID(),
        nextAttemptAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
      })
      .returning();
    return created!;
  });
  return row ? attemptStart(row) : 'waiting';
}

// Asks Mastra again for the starts it did not answer. One refused now queues the run of
// the coordinator the delegation would have queued.
export async function processAgentTeamStarts(): Promise<void> {
  const due = db
    .select({ id: agentTeamStart.id })
    .from(agentTeamStart)
    .where(and(eq(agentTeamStart.status, 'pending'), lte(agentTeamStart.nextAttemptAt, sql`now()`)))
    .orderBy(asc(agentTeamStart.nextAttemptAt))
    .limit(10)
    .for('update', { skipLocked: true });
  const rows = await db
    .update(agentTeamStart)
    .set({ nextAttemptAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})` })
    .where(inArray(agentTeamStart.id, due))
    .returning();
  for (const row of rows) {
    if ((await attemptStart(row)) === 'refused') await queueCoordinatorRun(row);
  }
}

// A 4xx answer is Mastra's or Plan's refusal. Anything else leaves it open whether Mastra
// started the run, and the next attempt with the same event id finds out.
async function attemptStart(row: StartRow): Promise<StartOutcome> {
  let outcome: StartOutcome;
  let error: string | null = null;
  try {
    outcome = await start(row);
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 500);
    outcome = caught instanceof HttpError && caught.status < 500 ? 'refused' : 'waiting';
    if (outcome === 'refused')
      console.error(
        '[planner] agent-team did not start, queueing a run for the coordinator:',
        error,
      );
  }
  const delay = retrySeconds(row.attempts);
  await db
    .update(agentTeamStart)
    .set({
      status: outcome === 'waiting' ? 'pending' : outcome,
      attempts: row.attempts + 1,
      lastError: error,
      startedAt: outcome === 'started' ? new Date() : null,
      nextAttemptAt:
        outcome === 'waiting' ? sql`now() + make_interval(secs => ${delay})` : undefined,
      updatedAt: new Date(),
    })
    .where(eq(agentTeamStart.id, row.id));
  return outcome;
}

// A start is dropped when the issue is no longer delegated to its coordinator, or while
// the agent-team run of an earlier start is still working on it: one agent-team run per
// issue at a time, the way a delegation queues one run per agent and issue.
async function start(row: StartRow): Promise<StartOutcome> {
  const [current] = await db
    .select({ delegateUserId: issue.delegateUserId, agentUserId: aiAgent.userId })
    .from(issue)
    .innerJoin(aiAgent, eq(aiAgent.id, row.agentId))
    .where(eq(issue.id, row.issueId));
  if (!current || current.delegateUserId !== current.agentUserId) return 'superseded';
  if (await earlierRunActive(row)) return 'superseded';
  await startIssueAgentTeam(row.issueId, row.actorUserId ?? 'itsaplan', row.eventId);
  return 'started';
}

async function earlierRunActive(row: StartRow): Promise<boolean> {
  const [earlier] = await db
    .select({ eventId: agentTeamStart.eventId, projectKey: project.key })
    .from(agentTeamStart)
    .innerJoin(project, eq(project.id, agentTeamStart.projectId))
    .where(
      and(
        eq(agentTeamStart.issueId, row.issueId),
        eq(agentTeamStart.status, 'started'),
        ne(agentTeamStart.id, row.id),
      ),
    )
    .orderBy(desc(agentTeamStart.id))
    .limit(1);
  if (!earlier) return false;
  const run = await controlPlaneRequest<{ status?: unknown }>(
    {
      operation: 'run',
      workflowId: 'agent-team',
      runId: earlier.eventId,
      projectRef: `project:${earlier.projectKey}`,
    },
    30_000,
  ).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  return typeof run?.status === 'string' && ACTIVE_RUN.has(run.status);
}

// The run the delegation queues for a coordinator whose team did not start, unless the
// agent no longer takes delegated work.
async function queueCoordinatorRun(row: StartRow): Promise<void> {
  const [target] = await db
    .select({
      key: project.key,
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
      delegateUserId: issue.delegateUserId,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(issue.id, row.issueId));
  if (!target?.delegateUserId) return;
  const agent = await getAssignTriggerAgent(row.projectId, target.delegateUserId, row.actorUserId);
  if (agent?.id !== row.agentId) return;
  await enqueueAgentRun({
    agentId: row.agentId,
    projectId: row.projectId,
    issueId: row.issueId,
    sourceActivityId: null,
    prompt: delegationPrompt(`${target.key}-${target.sequenceNumber}`, target.title),
    delaySeconds: agent.delegationDelaySec,
  });
}

// Starts that wait for Mastra, for the health overview.
export async function countWaitingAgentTeamStarts(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentTeamStart)
    .where(eq(agentTeamStart.status, 'pending'));
  return row?.count ?? 0;
}
