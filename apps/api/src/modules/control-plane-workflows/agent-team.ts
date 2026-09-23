import { randomUUID } from 'node:crypto';
import {
  aiAgent,
  db,
  issue,
  issueLabel,
  label,
  organizationAgentAssignment,
  project,
  projectMember,
} from '@repo/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { isWorkflowEnabled, listTaskWorkflowRuns, startWorkflow } from './service';

// The Mastra agent-team workflow started for one issue: the issue is the task, its
// delegate (or the project's only coordinator) leads, and the project's specialists
// are the team.

const CHECKLIST_ITEM = /^\s*[-*]\s+\[[ xX]\]\s+(\S.*?)\s*$/;
const DEFAULT_CRITERION = 'The work item is done as its description asks.';

// The Markdown checklist items of a description, or one default criterion when it has
// none. The bounds are the ones Mastra accepts.
export function acceptanceCriteria(description: string): string[] {
  const items = description
    .split('\n')
    .map((line) => CHECKLIST_ITEM.exec(line)?.[1])
    .filter((item): item is string => item !== undefined)
    .map((item) => item.slice(0, 1_000));
  return items.length > 0 ? items.slice(0, 30) : [DEFAULT_CRITERION];
}

async function issueTask(issueId: number) {
  const [row] = await db
    .select({
      id: issue.id,
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
      description: issue.description,
      delegateUserId: issue.delegateUserId,
      projectId: project.id,
      key: project.key,
      teamId: project.teamId,
    })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(issue.id, issueId));
  if (!row) throw new HttpError(404, 'Issue not found');
  return {
    ...row,
    project: { id: row.projectId, key: row.key, teamId: row.teamId },
    taskRef: `task:${row.key}-${row.sequenceNumber}`,
  };
}

// The external agents of the project that have an agent-team role in their team's
// organization. Hermes runs only external agents.
async function teamMembers(projectId: number) {
  return db
    .select({
      agentId: aiAgent.id,
      userId: aiAgent.userId,
      username: aiAgent.username,
      role: organizationAgentAssignment.role,
      capabilities: organizationAgentAssignment.capabilities,
      pausedAt: aiAgent.pausedAt,
    })
    .from(aiAgent)
    .innerJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, projectId)),
    )
    .where(and(eq(aiAgent.kind, 'external'), isNotNull(organizationAgentAssignment.role)))
    .orderBy(asc(aiAgent.username));
}

type TeamMember = Awaited<ReturnType<typeof teamMembers>>[number];

function member(agent: TeamMember) {
  return {
    agentRef: `agent:${agent.username}`,
    role: agent.role!,
    capabilities: agent.capabilities,
  };
}

// Starts agent-team for the issue. With no specialist in the project the coordinator
// also does the work. A paused agent takes no part: a paused coordinator refuses the
// start, and a paused specialist is left out of the team.
export async function startIssueAgentTeam(
  issueId: number,
  actorUserId: string,
  idempotencyKey: string = randomUUID(),
) {
  const task = await issueTask(issueId);
  const members = await teamMembers(task.projectId);
  const coordinators = members.filter((agent) => agent.role === 'coordinator');
  const coordinator =
    coordinators.find((agent) => agent.userId === task.delegateUserId) ??
    (coordinators.length === 1 ? coordinators[0] : undefined);
  if (!coordinator)
    throw new HttpError(
      409,
      coordinators.length === 0
        ? 'The project has no coordinator agent'
        : 'Delegate the issue to the coordinator that leads the team',
    );
  if (coordinator.pausedAt)
    throw new HttpError(409, `The coordinator @${coordinator.username} is paused`);
  const specialists = members
    .filter(
      (agent) =>
        agent.role === 'specialist' && agent.agentId !== coordinator.agentId && !agent.pausedAt,
    )
    .slice(0, 12)
    .map(member);
  const labels = await db
    .select({ name: label.name })
    .from(issueLabel)
    .innerJoin(label, eq(label.id, issueLabel.labelId))
    .where(eq(issueLabel.issueId, issueId))
    .orderBy(asc(label.name));
  const description = task.description.trim();
  const run = await startWorkflow(task.project, 'agent-team', actorUserId, {
    idempotencyKey,
    correlationId: task.taskRef,
    dryRun: false,
    payload: {
      schemaVersion: 1,
      task: {
        taskRef: task.taskRef,
        title: task.title.slice(0, 300),
        objective: (description || task.title).slice(0, 12_000),
        acceptanceCriteria: acceptanceCriteria(description),
        labels: labels.slice(0, 50).map((item) => item.name.slice(0, 100)),
      },
      coordinator: member(coordinator),
      specialists: specialists.length > 0 ? specialists : [member(coordinator)],
    },
  });
  const started = (run ?? {}) as { runId?: unknown; status?: unknown };
  return {
    runId: String(started.runId ?? idempotencyKey),
    status: String(started.status ?? 'running'),
    taskRef: task.taskRef,
  };
}

// Starts agent-team for an issue delegated to a coordinator, when the project runs the
// workflow. False when it does not apply or the control plane refused the start: the
// caller then queues a run for the agent itself, so the delegation is never lost.
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
  try {
    await startIssueAgentTeam(issueId, actorUserId ?? 'itsaplan');
    return true;
  } catch (error) {
    console.error(
      '[planner] agent-team did not start, queueing a run for the coordinator:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function listIssueAgentTeamRuns(issueId: number) {
  const task = await issueTask(issueId);
  const result = await listTaskWorkflowRuns(task.project, 'agent-team', task.taskRef);
  return (result.runs ?? []).map((value) => {
    const run = record(value);
    const snapshot = record(run.snapshot);
    const error = snapshot.error;
    return {
      runId: String(run.runId),
      status: String(run.status ?? snapshot.status ?? 'unknown'),
      createdAt: text(run.createdAt),
      updatedAt: text(run.updatedAt),
      steps: Object.entries(record(snapshot.context))
        .filter(([id]) => id !== 'input')
        .map(([id, step]) => ({ id, status: String(record(step).status ?? 'unknown') })),
      result: snapshot.result ?? null,
      error: error == null ? null : (text(record(error).message) ?? text(error) ?? 'Run failed'),
    };
  });
}
