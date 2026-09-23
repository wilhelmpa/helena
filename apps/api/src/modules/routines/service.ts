import { aiAgent, db, issue, project, projectMember, teamRole, user } from '@repo/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { getLimits } from '#shared/limits';
import { hasPermission } from '#shared/permissions';
import { canTriggerAgent } from '#modules/agents/core/service';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import {
  controlPlaneRequest,
  controlSchedule,
  createSchedule,
  DEFAULT_TIMEZONE,
  projectWorkflowScope,
  ROUTINE_WORKFLOW,
  updateSchedule,
} from '#modules/control-plane-workflows/service';
import { minCronIntervalSeconds } from './cron';

// A routine is a Mastra schedule of the agent-routine workflow. Every fire creates a
// task in the project and delegates it to the routine's agent, or reopens the task the
// routine names; Mastra skips a fire while the routine's task is still open. Plan
// stores nothing of a routine itself.

export type RoutineMode = 'new' | 'reopen';

interface RoutineProject {
  id: number;
  key: string;
  name: string;
  teamId: number;
}

// The schedule as mastra-control answers it: the stored input carries the routine, and
// `lastRun` is its newest fire with the output of that run.
interface RoutineSchedule {
  id: string;
  cron: string;
  timezone?: string;
  status: 'active' | 'paused';
  nextFireAt?: number;
  inputData?: { payload?: Record<string, unknown> };
  requestContext?: { projectRef?: unknown };
  lastRun?: {
    status?: string;
    firedAt?: number | null;
    result?: Record<string, unknown> | null;
    error?: string | null;
  } | null;
  createdAt: number;
  updatedAt: number;
}

export interface RoutineRow {
  id: string;
  projectKey: string;
  projectName: string;
  // Null when the agent no longer works in the project.
  agent: { id: number; name: string } | null;
  title: string;
  instructions: string;
  mode: RoutineMode;
  task: { id: number; number: number; title: string } | null;
  cron: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRun: {
    status: string;
    outcome: 'created' | 'reopened' | 'skipped' | null;
    skipReason: 'task-open' | 'missed' | null;
    taskNumber: number | null;
    error: string | null;
    firedAt: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineInput {
  agentId: number;
  title: string;
  instructions: string;
  mode: RoutineMode;
  taskId?: number | null;
  cron: string;
  timezone?: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// The number of `task:KEY-12` when it is a task of the project.
function taskNumber(taskRef: unknown, projectKey: string): number | null {
  const match = /^task:(.+)-(\d+)$/.exec(text(taskRef));
  return match && match[1] === projectKey ? Number(match[2]) : null;
}

function lastRunOf(schedule: RoutineSchedule, projectKey: string): RoutineRow['lastRun'] {
  const run = schedule.lastRun;
  if (!run) return null;
  const output = run.result ?? {};
  const outcome =
    output.status === 'created' || output.status === 'reopened' || output.status === 'skipped'
      ? output.status
      : null;
  const skipReason =
    output.skipReason === 'task-open' || output.skipReason === 'missed' ? output.skipReason : null;
  return {
    status: run.status ?? 'pending',
    outcome,
    skipReason,
    taskNumber: taskNumber(output.taskRef, projectKey),
    error: run.error ?? null,
    firedAt: run.firedAt ? iso(new Date(run.firedAt)) : null,
  };
}

// The routines of the schedules, newest first, with their agents and the tasks they
// reopen resolved in the projects they belong to.
async function routineRows(
  schedules: RoutineSchedule[],
  projects: RoutineProject[],
): Promise<RoutineRow[]> {
  const byRef = new Map(projects.map((item) => [projectWorkflowScope(item).projectRef, item]));
  const entries = schedules.flatMap((schedule) => {
    const owner = byRef.get(text(schedule.requestContext?.projectRef));
    return owner ? [{ schedule, owner, payload: schedule.inputData?.payload ?? {} }] : [];
  });
  const usernames = [
    ...new Set(entries.map((entry) => text(entry.payload.agentRef).slice('agent:'.length))),
  ].filter(Boolean);
  const agents =
    usernames.length === 0
      ? []
      : await db
          .select({
            id: aiAgent.id,
            username: aiAgent.username,
            name: user.name,
            projectId: projectMember.projectId,
          })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
          .where(
            and(
              inArray(aiAgent.username, usernames),
              inArray(
                projectMember.projectId,
                projects.map((item) => item.id),
              ),
            ),
          );
  const targets = entries.flatMap((entry) => {
    const number = taskNumber(entry.payload.taskRef, entry.owner.key);
    return number === null ? [] : [{ projectId: entry.owner.id, number }];
  });
  const tasks =
    targets.length === 0
      ? []
      : await db
          .select({
            id: issue.id,
            projectId: issue.projectId,
            number: issue.sequenceNumber,
            title: issue.title,
          })
          .from(issue)
          .where(
            or(
              ...targets.map((target) =>
                and(eq(issue.projectId, target.projectId), eq(issue.sequenceNumber, target.number)),
              ),
            ),
          );
  return entries
    .sort((a, b) => b.schedule.createdAt - a.schedule.createdAt)
    .map(({ schedule, owner, payload }) => {
      const agent = agents.find(
        (row) => row.projectId === owner.id && `agent:${row.username}` === text(payload.agentRef),
      );
      const number = taskNumber(payload.taskRef, owner.key);
      const task = tasks.find((row) => row.projectId === owner.id && row.number === number);
      return {
        id: schedule.id,
        projectKey: owner.key,
        projectName: owner.name,
        agent: agent ? { id: agent.id, name: agent.name } : null,
        title: text(payload.title),
        instructions: text(payload.instructions),
        mode: payload.mode === 'reopen' ? 'reopen' : 'new',
        task: task ? { id: task.id, number: task.number, title: task.title } : null,
        cron: schedule.cron,
        timezone: schedule.timezone ?? DEFAULT_TIMEZONE,
        enabled: schedule.status === 'active',
        nextRunAt:
          schedule.status === 'active' && schedule.nextFireAt
            ? iso(new Date(schedule.nextFireAt))
            : null,
        lastRun: lastRunOf(schedule, owner.key),
        createdAt: iso(new Date(schedule.createdAt)),
        updatedAt: iso(new Date(schedule.updatedAt)),
      };
    });
}

async function routineSchedules(projects: RoutineProject[]): Promise<RoutineSchedule[]> {
  const result = await controlPlaneRequest<{ schedules?: RoutineSchedule[] }>({
    operation: 'schedules',
    workflowId: ROUTINE_WORKFLOW,
    projectRefs: projects.map((item) => projectWorkflowScope(item).projectRef),
  });
  return result.schedules ?? [];
}

async function routineSchedule(owner: RoutineProject, routineId: string) {
  try {
    return await controlPlaneRequest<RoutineSchedule>({
      operation: 'schedule',
      workflowId: ROUTINE_WORKFLOW,
      scheduleId: routineId,
      projectRef: projectWorkflowScope(owner).projectRef,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404)
      throw new HttpError(404, 'Routine not found');
    throw error;
  }
}

// The projects whose routines the member may read: every membership whose role grants
// ai_agents read (an owner holds every permission).
async function readableProjects(userId: string): Promise<RoutineProject[]> {
  const rows = await db
    .select({
      id: project.id,
      key: project.key,
      name: project.name,
      teamId: project.teamId,
      role: projectMember.role,
      permissions: teamRole.permissions,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .where(eq(projectMember.userId, userId));
  return rows
    .filter((row) =>
      hasPermission(
        toMemberContext(row.role as MemberRole, row.permissions).permissions,
        'ai_agents',
        'read',
      ),
    )
    .map(({ id, key, name, teamId }) => ({ id, key, name, teamId }));
}

function page(rows: RoutineRow[], window: { limit: number; offset: number }) {
  return { items: rows.slice(window.offset, window.offset + window.limit), total: rows.length };
}

export async function listProjectRoutines(
  owner: RoutineProject,
  window: { limit: number; offset: number },
) {
  return page(await routineRows(await routineSchedules([owner]), [owner]), window);
}

// The routines of every project the member may read them in, for Home.
export async function listMemberRoutines(
  userId: string,
  window: { limit: number; offset: number },
) {
  const projects = await readableProjects(userId);
  if (projects.length === 0) return { items: [], total: 0 };
  return page(await routineRows(await routineSchedules(projects), projects), window);
}

export async function getRoutine(owner: RoutineProject, routineId: string): Promise<RoutineRow> {
  const [row] = await routineRows([await routineSchedule(owner, routineId)], [owner]);
  if (!row) throw new HttpError(404, 'Routine not found');
  return row;
}

// Refuses a cron that fires more often than the team's floor allows.
async function assertCadence(teamId: number, cron: string, timezone: string): Promise<void> {
  const shortest = minCronIntervalSeconds(cron, timezone);
  const { minScheduleIntervalSeconds } = await getLimits({ teamId });
  if (minScheduleIntervalSeconds > 0 && shortest < minScheduleIntervalSeconds) {
    const minutes = Math.ceil(minScheduleIntervalSeconds / 60);
    throw new HttpError(400, `A schedule runs at most once every ${minutes} minutes`);
  }
}

// The input of the agent-routine workflow. The agent has to work in the project and
// take delegated tasks, and a routine is a trigger like a mention: an agent scoped to
// its owner takes tasks from that member only.
async function routinePayload(owner: RoutineProject, userId: string, input: RoutineInput) {
  const [agent] = await db
    .select({
      id: aiAgent.id,
      username: aiAgent.username,
      triggerOnAssign: aiAgent.triggerOnAssign,
    })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, owner.id)),
    )
    .where(eq(aiAgent.id, input.agentId));
  if (!agent) throw new HttpError(400, 'Select an agent of this project');
  if (!agent.triggerOnAssign) throw new HttpError(400, 'The agent does not take delegated tasks');
  if (!(await canTriggerAgent(agent.id, userId)))
    throw new HttpError(403, 'This agent only takes tasks from its owner');
  const title = input.title.trim();
  const instructions = input.instructions.trim();
  if (!title || !instructions) throw new HttpError(400, 'Title and instructions are required');
  let taskRef: string | undefined;
  if (input.mode === 'reopen') {
    if (input.taskId == null) throw new HttpError(400, 'Select the task to reopen');
    const [task] = await db
      .select({ number: issue.sequenceNumber })
      .from(issue)
      .where(and(eq(issue.id, input.taskId), eq(issue.projectId, owner.id)));
    if (!task) throw new HttpError(400, 'Select a task of this project');
    taskRef = `task:${owner.key}-${task.number}`;
  }
  return {
    projectRef: projectWorkflowScope(owner).projectRef,
    agentRef: `agent:${agent.username}`,
    title,
    instructions,
    mode: input.mode,
    ...(taskRef ? { taskRef } : {}),
  };
}

export async function createRoutine(
  owner: RoutineProject,
  userId: string,
  input: RoutineInput & { idempotencyKey: string },
): Promise<RoutineRow> {
  const cron = input.cron.trim();
  const timezone = input.timezone ?? DEFAULT_TIMEZONE;
  const payload = await routinePayload(owner, userId, input);
  await assertCadence(owner.teamId, cron, timezone);
  const created = await createSchedule(owner, ROUTINE_WORKFLOW, userId, {
    cron,
    timezone,
    scheduleKey: input.idempotencyKey.toLowerCase(),
    capabilityRefs: [],
    payload,
  });
  return getRoutine(owner, text((created as { id?: unknown } | null)?.id));
}

// The ids behind the stored references, for a change that leaves them as they are.
async function storedIds(owner: RoutineProject, payload: Record<string, unknown>) {
  const username = text(payload.agentRef).slice('agent:'.length);
  const number = taskNumber(payload.taskRef, owner.key);
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(
      projectMember,
      and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, owner.id)),
    )
    .where(eq(aiAgent.username, username));
  const [task] =
    number === null
      ? []
      : await db
          .select({ id: issue.id })
          .from(issue)
          .where(and(eq(issue.projectId, owner.id), eq(issue.sequenceNumber, number)));
  return { agentId: agent?.id, taskId: task?.id };
}

// Changes a routine. A change to what it does or when makes the member who saved it
// the one its runs act for; switching it on or off does not.
export async function updateRoutine(
  owner: RoutineProject,
  userId: string,
  routineId: string,
  patch: Partial<RoutineInput> & { enabled?: boolean },
): Promise<RoutineRow> {
  const schedule = await routineSchedule(owner, routineId);
  const { enabled, ...changes } = patch;
  if (Object.values(changes).some((value) => value !== undefined)) {
    const stored = schedule.inputData?.payload ?? {};
    const ids = await storedIds(owner, stored);
    const cron = (changes.cron ?? schedule.cron).trim();
    const timezone = changes.timezone ?? schedule.timezone ?? DEFAULT_TIMEZONE;
    const payload = await routinePayload(owner, userId, {
      agentId: changes.agentId ?? ids.agentId ?? 0,
      title: changes.title ?? text(stored.title),
      instructions: changes.instructions ?? text(stored.instructions),
      mode: changes.mode ?? (stored.mode === 'reopen' ? 'reopen' : 'new'),
      taskId: changes.taskId !== undefined ? changes.taskId : ids.taskId,
      cron,
      timezone,
    });
    await assertCadence(owner.teamId, cron, timezone);
    await updateSchedule(owner, ROUTINE_WORKFLOW, routineId, {
      cron,
      timezone,
      change: { actorUserId: userId, capabilityRefs: [], payload },
    });
  }
  if (enabled !== undefined && enabled !== (schedule.status === 'active')) {
    await controlSchedule(
      owner,
      ROUTINE_WORKFLOW,
      routineId,
      enabled ? 'resume-schedule' : 'pause-schedule',
    );
  }
  return getRoutine(owner, routineId);
}

export async function deleteRoutine(owner: RoutineProject, routineId: string): Promise<void> {
  await routineSchedule(owner, routineId);
  await controlSchedule(owner, ROUTINE_WORKFLOW, routineId, 'delete-schedule');
}

// Fires the routine now and answers the id of the run. The run acts for the member who
// saved the routine, so the caller has to be allowed to send its agent a task as well.
export async function runRoutine(
  owner: RoutineProject,
  userId: string,
  routineId: string,
): Promise<{ runId: string }> {
  const routine = await getRoutine(owner, routineId);
  if (!routine.agent) throw new HttpError(409, 'The agent of this routine left the project');
  if (!(await canTriggerAgent(routine.agent.id, userId)))
    throw new HttpError(403, 'This agent only takes tasks from its owner');
  const fired = await controlSchedule(owner, ROUTINE_WORKFLOW, routineId, 'run-schedule');
  return { runId: text((fired as { claimId?: unknown } | null)?.claimId) };
}
