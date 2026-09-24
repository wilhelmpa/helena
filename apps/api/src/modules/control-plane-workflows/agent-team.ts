import { randomUUID } from 'node:crypto';
import {
  agentRun,
  aiAgent,
  db,
  issue,
  issueLabel,
  label,
  organizationAgentAssignment,
  pipelineRun,
  pipelineRunStep,
  project,
  projectMember,
  user,
} from '@repo/db';
import { and, asc, desc, eq, inArray, isNotNull, like } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { notHomeAgent } from '#modules/agents/core/home-agent';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { startRunSoon } from '#modules/engine/runs';
import type { PipelineDefinition } from '#modules/pipelines/definition';
import { agentRunStatus, runFailures } from '#modules/pipelines/runs';
import { AGENT_TEAM, agentTeamPolicy, assignment } from './service';

// The agent team of an issue: the issue is the task, its delegate (or the project's only
// coordinator) leads, and the project's specialists are the team. The Helena engine runs
// it as a run of kind 'agent_team' whose one step is the team (engine/builtin/steps/
// agent-team.ts); this module builds the team and lists the runs.

const CHECKLIST_ITEM = /^\s*[-*]\s+\[[ xX]\]\s+(\S.*?)\s*$/;
const DEFAULT_CRITERION = 'The work item is done as its description asks.';

// The Markdown checklist items of a description, or one default criterion when it has
// none.
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
  return { ...row, taskRef: `task:${row.key}-${row.sequenceNumber}` };
}

// The external agents of the project that have an agent-team role in their team's
// organization. The Home agent hands work to the team and is not part of it.
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

// Writes the agent-team run of the issue and hands it to the engine. With no specialist
// in the project the coordinator also does the work. A paused agent takes no part: a
// paused coordinator refuses the start, and a paused specialist is left out of the team.
// `coordinatorAgentId` names the coordinator of a delegation. A run of the same id is
// answered as it is; a delegated run is refused while an earlier one of the same
// coordinator still works on the issue.
export async function startIssueAgentTeam(
  issueId: number,
  actorUserId: string | null,
  idempotencyKey: string = randomUUID(),
  options: { trigger?: 'manual' | 'delegation'; coordinatorAgentId?: number } = {},
) {
  const task = await issueTask(issueId);
  const [existing] = await db
    .select({ id: pipelineRun.id, status: pipelineRun.status })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, idempotencyKey));
  if (existing) return { runId: existing.id, status: existing.status, taskRef: task.taskRef };
  const settings = await assignment(task.projectId, AGENT_TEAM);
  if (!settings?.enabled) throw new HttpError(409, 'Workflow is not enabled for this project');
  const members = await teamMembers(task.projectId);
  const coordinators = members.filter((agent) => agent.role === 'coordinator');
  const coordinator =
    (options.coordinatorAgentId !== undefined
      ? coordinators.find((agent) => agent.agentId === options.coordinatorAgentId)
      : undefined) ??
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
  const trigger = options.trigger ?? 'manual';
  const definition: PipelineDefinition = {
    schemaVersion: 1,
    trigger: { type: 'delegation' },
    roles: [],
    steps: [
      {
        id: 'team',
        name: 'Agent team',
        type: 'agent_team',
        team: {
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
          policy: agentTeamPolicy(settings.configuration),
          execution: {},
        },
      },
    ],
  };
  const [run] = await db
    .insert(pipelineRun)
    .values({
      id: idempotencyKey,
      kind: 'agent_team',
      definition,
      title: 'Agent team',
      projectId: task.projectId,
      issueId,
      agentId: coordinator.agentId,
      trigger,
      actorUserId,
    })
    .onConflictDoNothing()
    .returning({ id: pipelineRun.id });
  if (!run) {
    // An earlier team of the coordinator still works on the issue: that run answers.
    const [active] = await db
      .select({ id: pipelineRun.id, status: pipelineRun.status })
      .from(pipelineRun)
      .where(
        and(
          eq(pipelineRun.issueId, issueId),
          eq(pipelineRun.agentId, coordinator.agentId),
          eq(pipelineRun.kind, 'agent_team'),
          inArray(pipelineRun.status, ['pending', 'running', 'waiting']),
        ),
      )
      .limit(1);
    if (!active) throw new HttpError(409, 'The agent team could not be started');
    return { runId: active.id, status: active.status, taskRef: task.taskRef };
  }
  await bumpControlPlaneRevision(task.projectId);
  await startRunSoon(run.id);
  return { runId: run.id, status: 'pending', taskRef: task.taskRef };
}

export type AgentTeamPhase = 'coordinate' | 'specialize' | 'review';

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

const PARTS: Record<string, AgentTeamPhase | 'synchronize'> = {
  coordinate: 'coordinate',
  review: 'review',
  sync: 'synchronize',
};

function phaseOf(stepId: string): AgentTeamPhase | 'synchronize' | null {
  const part = stepId.slice(stepId.indexOf('.') + 1);
  if (PARTS[part]) return PARTS[part]!;
  return /^s\d+$/.test(part) ? 'specialize' : null;
}

// The stages of the given agent-team runs: the agent run behind each, in the order they
// ran, by run id.
export async function agentTeamStages(runIds: string[]): Promise<Map<string, AgentTeamStage[]>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      step: pipelineRunStep,
      agentRun: {
        id: agentRun.id,
        status: agentRun.status,
        attempts: agentRun.attempts,
        nextAttemptAt: agentRun.nextAttemptAt,
        lastError: agentRun.lastError,
        startedAt: agentRun.startedAt,
        finishedAt: agentRun.finishedAt,
        inputTokens: agentRun.inputTokens,
        outputTokens: agentRun.outputTokens,
      },
      agentId: aiAgent.id,
      username: aiAgent.username,
      name: user.name,
    })
    .from(pipelineRunStep)
    .innerJoin(agentRun, eq(agentRun.id, pipelineRunStep.agentRunId))
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(and(inArray(pipelineRunStep.runId, runIds), like(pipelineRunStep.stepId, 'team.%')))
    .orderBy(asc(pipelineRunStep.startedAt));
  const stages = new Map<string, AgentTeamStage[]>();
  for (const row of rows) {
    const phase = phaseOf(row.step.stepId);
    if (!phase || phase === 'synchronize') continue;
    const state = (row.step.state ?? {}) as { assignmentId?: string };
    const list = stages.get(row.step.runId) ?? [];
    list.push({
      phase,
      assignmentId: state.assignmentId ?? null,
      agentRunId: row.agentRun.id,
      agent: { id: row.agentId, username: row.username, name: row.name },
      status: agentRunStatus(row.agentRun),
      startedAt: row.agentRun.startedAt ? iso(row.agentRun.startedAt) : null,
      finishedAt: row.agentRun.finishedAt ? iso(row.agentRun.finishedAt) : null,
      durationMs:
        row.agentRun.startedAt && row.agentRun.finishedAt
          ? row.agentRun.finishedAt.getTime() - row.agentRun.startedAt.getTime()
          : null,
      inputTokens: row.agentRun.inputTokens,
      outputTokens: row.agentRun.outputTokens,
    });
    stages.set(row.step.runId, list);
  }
  return stages;
}

// The steps of a team run a person follows, each with where it is.
async function teamSteps(runIds: string[]) {
  if (runIds.length === 0) return new Map<string, { id: string; status: string }[]>();
  const rows = await db
    .select({
      runId: pipelineRunStep.runId,
      stepId: pipelineRunStep.stepId,
      status: pipelineRunStep.status,
    })
    .from(pipelineRunStep)
    .where(and(inArray(pipelineRunStep.runId, runIds), like(pipelineRunStep.stepId, 'team.%')));
  const steps = new Map<string, { id: string; status: string }[]>();
  for (const runId of runIds) {
    const own = rows.filter((row) => row.runId === runId);
    const statusOf = (phase: string) => {
      const matching = own.filter((row) => phaseOf(row.stepId) === phase);
      if (matching.length === 0) return 'pending';
      if (matching.some((row) => row.status === 'failed')) return 'failed';
      if (matching.some((row) => row.status === 'running' || row.status === 'waiting'))
        return 'running';
      return 'succeeded';
    };
    steps.set(
      runId,
      ['coordinate', 'specialize', 'review', 'synchronize'].map((phase) => ({
        id: phase,
        status: statusOf(phase),
      })),
    );
  }
  return steps;
}

export async function listIssueAgentTeamRuns(issueId: number) {
  await issueTask(issueId);
  const runs = await db
    .select()
    .from(pipelineRun)
    .where(and(eq(pipelineRun.issueId, issueId), eq(pipelineRun.kind, 'agent_team')))
    .orderBy(desc(pipelineRun.createdAt))
    .limit(100);
  const ids = runs.map((run) => run.id);
  const [stages, steps, failures] = await Promise.all([
    agentTeamStages(ids),
    teamSteps(ids),
    runFailures(runs.filter((run) => run.status === 'failed').map((run) => run.id)),
  ]);
  return runs.map((run) => ({
    runId: run.id,
    status: run.status,
    createdAt: iso(run.createdAt),
    updatedAt: iso(run.updatedAt),
    steps: steps.get(run.id) ?? [],
    stages: stages.get(run.id) ?? [],
    result: run.result ?? null,
    error: run.error,
    failure: failures.get(run.id) ?? null,
  }));
}
