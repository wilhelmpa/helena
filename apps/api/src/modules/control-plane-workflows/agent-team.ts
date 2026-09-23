import { createHash, randomUUID } from 'node:crypto';
import {
  agentRun,
  aiAgent,
  db,
  issue,
  issueLabel,
  label,
  organizationAgentAssignment,
  project,
  projectMember,
  projectSetting,
  user,
} from '@repo/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { notHomeAgent } from '#modules/agents/core/home-agent';
import { listTaskWorkflowRuns, startWorkflow } from './service';

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
// organization. Hermes runs only external agents. The Home agent hands work to the
// team and is not part of it.
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
    .where(
      and(
        eq(aiAgent.kind, 'external'),
        isNotNull(organizationAgentAssignment.role),
        notHomeAgent(),
      ),
    )
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

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export type AgentTeamPhase = 'coordinate' | 'specialize' | 'review';

// The idempotency key the agent-team workflow sends with the Hermes stage of one phase
// (teamIdempotencyKey in the Mastra workflow). Plan stores the run it queued for the
// stage under this key, which is what leads from a stage to its agent_run.
export function stageIdempotencyKey(
  envelope: { eventId: string; correlationId: string },
  phase: AgentTeamPhase,
  subject: string,
): string {
  return createHash('sha256')
    .update(`agent-team\0${envelope.eventId}\0${envelope.correlationId}\0${phase}\0${subject}`)
    .digest('hex');
}

interface StageRef {
  phase: AgentTeamPhase;
  assignmentId: string | null;
  key: string;
}

// The Hermes stages a run can have asked for so far: the coordinator's plan, one stage
// per assignment of that plan, and the coordinator's review. A stage Mastra did not
// run (a task routed without a coordinator, a policy without review) has no stored run
// under its key and is dropped when the runs are read.
function stageRefs(run: Record<string, unknown>): StageRef[] {
  const context = record(record(run.snapshot).context);
  const envelope = record(context.input);
  const eventId = text(envelope.eventId);
  const correlationId = text(envelope.correlationId);
  const taskRef = text(record(record(envelope.payload).task).taskRef);
  if (!eventId || !correlationId || !taskRef) return [];
  const key = (phase: AgentTeamPhase, subject: string) =>
    stageIdempotencyKey({ eventId, correlationId }, phase, subject);
  const delegations = record(record(context.coordinate).output).delegations;
  const assignmentIds = (Array.isArray(delegations) ? delegations : [])
    .map((item) => text(record(item).assignmentId))
    .filter((id): id is string => id !== null);
  return [
    { phase: 'coordinate', assignmentId: null, key: key('coordinate', taskRef) },
    ...assignmentIds.map((id) => ({
      phase: 'specialize' as const,
      assignmentId: id,
      key: key('specialize', id),
    })),
    { phase: 'review', assignmentId: null, key: key('review', taskRef) },
  ];
}

// A run a runner holds stays 'pending' in the queue until the runner reports it. It is
// running while the lease of a claim is open; a run waiting for a retry carries the
// error of the attempt before, and a queued stage asked for again starts at 0 claims.
export function runStatus(run: {
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
}): string {
  return run.status === 'pending' &&
    run.attempts > 0 &&
    !run.lastError &&
    run.nextAttemptAt.getTime() > Date.now()
    ? 'running'
    : run.status;
}

export interface AgentTeamStage {
  phase: AgentTeamPhase;
  assignmentId: string | null;
  agentRunId: number;
  agent: { id: number; username: string; name: string };
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

// The Hermes run behind each stage of the given agent-team runs of one project, by
// Mastra run id, in the order the stages ran.
export async function agentTeamStages(
  projectId: number,
  runs: unknown[],
): Promise<Map<string, AgentTeamStage[]>> {
  const refs = runs.map((value) => {
    const run = record(value);
    return { runId: String(run.runId), stages: stageRefs(run) };
  });
  const keys = refs.flatMap((item) => item.stages.map((stage) => `mastra-agent-run:${stage.key}`));
  const stored =
    keys.length === 0
      ? []
      : await db
          .select({ key: projectSetting.key, value: projectSetting.value })
          .from(projectSetting)
          .where(and(eq(projectSetting.projectId, projectId), inArray(projectSetting.key, keys)));
  const runIdByKey = new Map(
    stored.map((row) => [
      row.key.slice('mastra-agent-run:'.length),
      Number(record(row.value).runId),
    ]),
  );
  const ids = [...runIdByKey.values()].filter((id) => Number.isSafeInteger(id));
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: agentRun.id,
            status: agentRun.status,
            attempts: agentRun.attempts,
            nextAttemptAt: agentRun.nextAttemptAt,
            lastError: agentRun.lastError,
            startedAt: agentRun.startedAt,
            finishedAt: agentRun.finishedAt,
            inputTokens: agentRun.inputTokens,
            outputTokens: agentRun.outputTokens,
            agentId: aiAgent.id,
            username: aiAgent.username,
            name: user.name,
          })
          .from(agentRun)
          .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .where(and(eq(agentRun.projectId, projectId), inArray(agentRun.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return new Map(
    refs.map(({ runId, stages }) => [
      runId,
      stages.flatMap((stage) => {
        const row = byId.get(runIdByKey.get(stage.key) ?? 0);
        if (!row) return [];
        return [
          {
            phase: stage.phase,
            assignmentId: stage.assignmentId,
            agentRunId: row.id,
            agent: { id: row.agentId, username: row.username, name: row.name },
            status: runStatus(row),
            startedAt: row.startedAt ? iso(row.startedAt) : null,
            finishedAt: row.finishedAt ? iso(row.finishedAt) : null,
            durationMs:
              row.startedAt && row.finishedAt
                ? row.finishedAt.getTime() - row.startedAt.getTime()
                : null,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
          },
        ];
      }),
    ]),
  );
}

export async function listIssueAgentTeamRuns(issueId: number) {
  const task = await issueTask(issueId);
  const result = await listTaskWorkflowRuns(task.project, 'agent-team', task.taskRef);
  const runs = result.runs ?? [];
  const stages = await agentTeamStages(task.projectId, runs);
  return runs.map((value) => {
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
      stages: stages.get(String(run.runId)) ?? [],
      result: snapshot.result ?? null,
      error: error == null ? null : (text(record(error).message) ?? text(error) ?? 'Run failed'),
    };
  });
}
