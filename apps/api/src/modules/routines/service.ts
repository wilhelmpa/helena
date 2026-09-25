import { randomUUID } from 'node:crypto';
import {
  aiAgent,
  db,
  helenaSchedule,
  issue,
  pipelineRun,
  project,
  projectMember,
  teamRole,
  user,
} from '@repo/db';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { getLimits } from '#shared/limits';
import { hasPermission } from '#shared/permissions';
import { canTriggerAgent, type MentionRefusal } from '#modules/agents/core/service';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { startRunSoon } from '#modules/engine/runs';
import { defaultTimezone } from '#modules/engine/settings';
import {
  assertCron,
  nextFireTime,
  recordScheduleRun,
  type ScheduleRow,
} from '#modules/engine/schedules';
import { runDtos } from '#modules/pipelines/runs';
import { minCronIntervalSeconds } from './cron';
import { routineMentions } from './mentions';

// A routine hands an agent work on a cron: every fire creates a task in the project and
// delegates it to the routine's agent, or reopens the task the routine names, and is
// skipped while the routine's task is still open. Helena keeps it in helena_schedule;
// the engine fires it (modules/engine/schedules.ts) and records every fire as a run.
// The agents its instructions @mention start on the task too, as the mentions of the
// member it acts for (mentions.ts, docs/helena-decisions/routine-mentions.md).

export type RoutineMode = 'new' | 'reopen';
export type CatchUp = 'skip' | 'once';

export interface RoutineProject {
  id: number;
  key: string;
  name: string;
  teamId: number;
}

// An agent the instructions @mention besides the routine's own, and whether a fire starts
// it; `reason` says why not.
export interface RoutineMention {
  agent: { id: number; name: string; username: string };
  starts: boolean;
  reason: MentionRefusal | null;
}

export interface RoutineRow {
  id: string;
  projectKey: string;
  projectName: string;
  // Null when the agent no longer works in the project.
  agent: { id: number; name: string } | null;
  title: string;
  instructions: string;
  // For the member the routine acts for.
  mentions: RoutineMention[];
  mode: RoutineMode;
  task: { id: number; number: number; title: string } | null;
  cron: string;
  timezone: string;
  catchUp: CatchUp;
  enabled: boolean;
  nextRunAt: string | null;
  lastRun: {
    id: string;
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
  catchUp?: CatchUp;
}

interface RunResult {
  outcome?: unknown;
  skipReason?: unknown;
}

// The newest run of each schedule.
async function lastRuns(scheduleIds: string[]) {
  if (scheduleIds.length === 0)
    return new Map<string, typeof pipelineRun.$inferSelect & { number: number | null }>();
  const rows = await db
    .selectDistinctOn([pipelineRun.scheduleId], {
      run: pipelineRun,
      number: issue.sequenceNumber,
    })
    .from(pipelineRun)
    .leftJoin(issue, eq(issue.id, pipelineRun.issueId))
    .where(inArray(pipelineRun.scheduleId, scheduleIds))
    .orderBy(pipelineRun.scheduleId, desc(pipelineRun.scheduledFor), desc(pipelineRun.createdAt));
  return new Map(rows.map((row) => [row.run.scheduleId!, { ...row.run, number: row.number }]));
}

async function routineRows(
  schedules: ScheduleRow[],
  projects: RoutineProject[],
): Promise<RoutineRow[]> {
  const byId = new Map(projects.map((item) => [item.id, item]));
  const agentIds = [
    ...new Set(schedules.map((row) => row.agentId).filter((id): id is number => id !== null)),
  ];
  const agents =
    agentIds.length === 0
      ? []
      : await db
          .select({ id: aiAgent.id, name: user.name, projectId: projectMember.projectId })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
          .where(inArray(aiAgent.id, agentIds));
  const taskIds = [
    ...new Set(schedules.map((row) => row.taskId).filter((id): id is number => id !== null)),
  ];
  const tasks =
    taskIds.length === 0
      ? []
      : await db
          .select({ id: issue.id, number: issue.sequenceNumber, title: issue.title })
          .from(issue)
          .where(inArray(issue.id, taskIds));
  const runs = await lastRuns(schedules.map((row) => row.id));
  const mentions = new Map(
    await Promise.all(
      schedules.map(async (row) => {
        const owner = byId.get(row.projectId);
        const found = owner
          ? await routineMentions(owner, row.instructions, row.actorUserId, row.agentId)
          : [];
        return [row.id, found.map(mentionRow)] as const;
      }),
    ),
  );
  return schedules.flatMap((row) => {
    const owner = byId.get(row.projectId);
    if (!owner) return [];
    const agent = agents.find(
      (item) => item.id === row.agentId && item.projectId === row.projectId,
    );
    const task = tasks.find((item) => item.id === row.taskId);
    const run = runs.get(row.id);
    const result = (run?.result ?? {}) as RunResult;
    const next = row.enabled ? nextFireTime(row.cron, row.timezone) : null;
    return [
      {
        id: row.id,
        projectKey: owner.key,
        projectName: owner.name,
        agent: agent ? { id: agent.id, name: agent.name } : null,
        title: row.title,
        instructions: row.instructions,
        mentions: mentions.get(row.id) ?? [],
        mode: row.mode === 'reopen' ? 'reopen' : 'new',
        task: task ?? null,
        cron: row.cron,
        timezone: row.timezone,
        catchUp: row.catchUp === 'once' ? 'once' : 'skip',
        enabled: row.enabled,
        nextRunAt: next ? iso(next) : null,
        lastRun: run
          ? {
              id: run.id,
              status: run.status,
              outcome:
                result.outcome === 'created' ||
                result.outcome === 'reopened' ||
                result.outcome === 'skipped'
                  ? result.outcome
                  : null,
              skipReason:
                result.skipReason === 'task-open' || result.skipReason === 'missed'
                  ? result.skipReason
                  : null,
              taskNumber: run.number,
              error: run.error,
              firedAt: run.scheduledFor ? iso(run.scheduledFor) : iso(run.createdAt),
            }
          : null,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      } satisfies RoutineRow,
    ];
  });
}

function mentionRow(agent: Awaited<ReturnType<typeof routineMentions>>[number]): RoutineMention {
  return {
    agent: { id: agent.id, name: agent.name, username: agent.username },
    starts: agent.refused === null,
    reason: agent.refused,
  };
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

async function page(projects: RoutineProject[], window: { limit: number; offset: number }) {
  if (projects.length === 0) return { items: [], total: 0 };
  const where = and(
    eq(helenaSchedule.kind, 'routine'),
    inArray(
      helenaSchedule.projectId,
      projects.map((item) => item.id),
    ),
  );
  const [rows, [total]] = await Promise.all([
    db
      .select()
      .from(helenaSchedule)
      .where(where)
      .orderBy(desc(helenaSchedule.createdAt), desc(helenaSchedule.id))
      .limit(window.limit)
      .offset(window.offset),
    db.select({ value: count() }).from(helenaSchedule).where(where),
  ]);
  return { items: await routineRows(rows, projects), total: total?.value ?? 0 };
}

export function listProjectRoutines(
  owner: RoutineProject,
  window: { limit: number; offset: number },
) {
  return page([owner], window);
}

// The routines of every project the member may read them in, for Home.
export async function listMemberRoutines(
  userId: string,
  window: { limit: number; offset: number },
) {
  return page(await readableProjects(userId), window);
}

async function routineSchedule(owner: RoutineProject, routineId: string): Promise<ScheduleRow> {
  const [row] = await db
    .select()
    .from(helenaSchedule)
    .where(
      and(
        eq(helenaSchedule.id, routineId),
        eq(helenaSchedule.projectId, owner.id),
        eq(helenaSchedule.kind, 'routine'),
      ),
    );
  if (!row) throw new HttpError(404, 'Routine not found');
  return row;
}

export async function getRoutine(owner: RoutineProject, routineId: string): Promise<RoutineRow> {
  const [row] = await routineRows([await routineSchedule(owner, routineId)], [owner]);
  if (!row) throw new HttpError(404, 'Routine not found');
  return row;
}

// Refuses a cron that fires more often than the team's floor allows.
async function assertCadence(teamId: number, cron: string, timezone: string): Promise<void> {
  assertCron(cron, timezone);
  const shortest = minCronIntervalSeconds(cron, timezone);
  const { minScheduleIntervalSeconds } = await getLimits({ teamId });
  if (minScheduleIntervalSeconds > 0 && shortest < minScheduleIntervalSeconds) {
    const minutes = Math.ceil(minScheduleIntervalSeconds / 60);
    throw new HttpError(400, `A schedule runs at most once every ${minutes} minutes`);
  }
}

// Refuses a routine whose instructions @mention an agent that takes work only from its
// owner, for a member other than that owner: saving it would hand the agent work from
// them. An agent that is paused, or does not react to mentions, is only reported
// (RoutineRow.mentions), since that can change before the next fire.
async function assertMentions(
  owner: RoutineProject,
  userId: string,
  instructions: string,
  agentId: number | null,
): Promise<void> {
  const refused = (await routineMentions(owner, instructions, userId, agentId)).filter(
    (agent) => agent.refused === 'owner-only',
  );
  if (refused.length > 0)
    throw new HttpError(
      403,
      `Only its owner can hand this agent work: ${refused.map((agent) => '@' + agent.username).join(', ')}`,
    );
}

// What the routine does. The agent has to work in the project and take delegated tasks,
// and a routine is a trigger like a mention: an agent scoped to its owner takes tasks
// from that member only. The same holds for the agents its instructions mention.
async function routineFields(owner: RoutineProject, userId: string, input: RoutineInput) {
  const [agent] = await db
    .select({ id: aiAgent.id, triggerOnAssign: aiAgent.triggerOnAssign })
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
  await assertMentions(owner, userId, instructions, agent.id);
  let taskId: number | null = null;
  if (input.mode === 'reopen') {
    if (input.taskId == null) throw new HttpError(400, 'Select the task to reopen');
    const [task] = await db
      .select({ id: issue.id })
      .from(issue)
      .where(and(eq(issue.id, input.taskId), eq(issue.projectId, owner.id)));
    if (!task) throw new HttpError(400, 'Select a task of this project');
    taskId = task.id;
  }
  return { agentId: agent.id, title, instructions, mode: input.mode, taskId };
}

// A routine starts switched on; a setup that only proposes one (a project blueprint) creates
// it switched off with `enabled: false`, so it never fires before the owner turns it on.
export async function createRoutine(
  owner: RoutineProject,
  userId: string,
  input: RoutineInput & { idempotencyKey: string; enabled?: boolean },
): Promise<RoutineRow> {
  const scheduleKey = input.idempotencyKey.toLowerCase();
  const [existing] = await db
    .select({ id: helenaSchedule.id })
    .from(helenaSchedule)
    .where(
      and(eq(helenaSchedule.projectId, owner.id), eq(helenaSchedule.scheduleKey, scheduleKey)),
    );
  if (existing) return getRoutine(owner, existing.id);
  const cron = input.cron.trim();
  const timezone = input.timezone ?? (await defaultTimezone());
  const fields = await routineFields(owner, userId, input);
  await assertCadence(owner.teamId, cron, timezone);
  const id = randomUUID();
  const [created] = await db
    .insert(helenaSchedule)
    .values({
      id,
      projectId: owner.id,
      kind: 'routine',
      ...fields,
      cron,
      timezone,
      catchUp: input.catchUp ?? 'skip',
      enabled: input.enabled ?? true,
      firedThrough: new Date(),
      actorUserId: userId,
      scheduleKey,
      createdBy: userId,
    })
    .onConflictDoNothing()
    .returning({ id: helenaSchedule.id });
  if (!created) return createRoutine(owner, userId, input);
  await bumpControlPlaneRevision(owner.id);
  return getRoutine(owner, id);
}

// Changes a routine. A change to what it does or when makes the member who saved it
// the one its runs act for; switching it on or off does not.
export async function updateRoutine(
  owner: RoutineProject,
  userId: string,
  routineId: string,
  patch: Partial<RoutineInput> & { enabled?: boolean },
): Promise<RoutineRow> {
  const row = await routineSchedule(owner, routineId);
  const { enabled, catchUp, ...changes } = patch;
  const values: Partial<typeof helenaSchedule.$inferInsert> = {};
  if (Object.values(changes).some((value) => value !== undefined)) {
    const cron = (changes.cron ?? row.cron).trim();
    const timezone = changes.timezone ?? row.timezone;
    const fields = await routineFields(owner, userId, {
      agentId: changes.agentId ?? row.agentId ?? 0,
      title: changes.title ?? row.title,
      instructions: changes.instructions ?? row.instructions,
      mode: changes.mode ?? (row.mode === 'reopen' ? 'reopen' : 'new'),
      taskId: changes.taskId !== undefined ? changes.taskId : row.taskId,
      cron,
      timezone,
    });
    await assertCadence(owner.teamId, cron, timezone);
    Object.assign(values, fields, { cron, timezone, actorUserId: userId });
  }
  if (catchUp !== undefined) values.catchUp = catchUp;
  if (enabled !== undefined) values.enabled = enabled;
  // Switched on again or given another time, the routine starts afresh: the times that
  // passed meanwhile do not fire.
  if (
    (enabled === true && !row.enabled) ||
    (values.cron !== undefined && values.cron !== row.cron) ||
    (values.timezone !== undefined && values.timezone !== row.timezone)
  )
    values.firedThrough = new Date();
  if (Object.keys(values).length > 0) {
    await db
      .update(helenaSchedule)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(helenaSchedule.id, routineId));
    await bumpControlPlaneRevision(owner.id);
  }
  return getRoutine(owner, routineId);
}

export async function deleteRoutine(owner: RoutineProject, routineId: string): Promise<void> {
  await routineSchedule(owner, routineId);
  await db.delete(helenaSchedule).where(eq(helenaSchedule.id, routineId));
  await bumpControlPlaneRevision(owner.id);
}

// Runs the routine now and answers the id of the run. The run acts for the member who
// saved the routine, so the caller has to be allowed to send its agent a task as well.
export async function runRoutine(
  owner: RoutineProject,
  userId: string,
  routineId: string,
): Promise<{ runId: string }> {
  const row = await routineSchedule(owner, routineId);
  const routine = await getRoutine(owner, routineId);
  if (!routine.agent) throw new HttpError(409, 'The agent of this routine left the project');
  if (!(await canTriggerAgent(routine.agent.id, userId)))
    throw new HttpError(403, 'This agent only takes tasks from its owner');
  await assertMentions(owner, userId, row.instructions, routine.agent.id);
  const { runId } = await recordScheduleRun(row, new Date(), 'manual');
  await startRunSoon(runId);
  return { runId };
}

// The agents the instructions would start, for the member writing them, while the
// routine is edited: the same answer RoutineRow.mentions gives once it is saved.
export async function previewRoutineMentions(
  owner: RoutineProject,
  userId: string,
  input: { instructions: string; agentId?: number | null },
): Promise<RoutineMention[]> {
  return (await routineMentions(owner, input.instructions, userId, input.agentId ?? null)).map(
    mentionRow,
  );
}

// The runs of a routine, newest first, with the step each executed.
export async function listRoutineRuns(
  owner: RoutineProject,
  routineId: string,
  window: { limit: number; offset: number },
) {
  await routineSchedule(owner, routineId);
  const where = eq(pipelineRun.scheduleId, routineId);
  const [items, [total]] = await Promise.all([
    runDtos(where, window),
    db.select({ value: count() }).from(pipelineRun).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
}

// The schedules of a project that is going away stop firing.
export async function stopProjectSchedules(projectId: number): Promise<void> {
  await db
    .update(helenaSchedule)
    .set({ enabled: false, updatedAt: sql`now()` })
    .where(eq(helenaSchedule.projectId, projectId));
}
