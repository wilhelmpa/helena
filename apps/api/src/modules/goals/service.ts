import {
  agentRun,
  aiAgent,
  db,
  helenaGoalNote,
  helenaGoalTask,
  issue,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  projectColumn,
  projectMember,
  user,
} from '@repo/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import {
  departmentsWithAncestors,
  goalPath,
  visibleGoalIds,
  type GoalStatus,
  type ScopedGoal,
  type SoulGoal,
} from './scope';

// Goals made effective (owner, 2026-09-25: "Ziele wirksam machen"): an agent sees the
// goals of its projects and their departments in its context and through Helena's MCP
// tools, links the tasks that serve a goal, and reports progress on it. A goal's status is
// the owner's: an agent proposes a change in a note, a team owner or manager accepts it.
// docs/helena-decisions/agent-context.md §7.

export type { GoalStatus } from './scope';

// Who calls: a person of the team, or one of its agents (the agent's own bot user).
export interface GoalCaller {
  teamId: number;
  userId: string;
}

interface CallerAgent {
  id: number;
  userId: string;
  username: string;
}

async function callerAgent(caller: GoalCaller): Promise<CallerAgent | null> {
  const [row] = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId, username: aiAgent.username })
    .from(aiAgent)
    .where(and(eq(aiAgent.userId, caller.userId), eq(aiAgent.teamId, caller.teamId)));
  return row ?? null;
}

async function teamGoals(teamId: number): Promise<(ScopedGoal & { updatedAt: Date })[]> {
  const rows = await db
    .select({
      id: organizationGoal.id,
      title: organizationGoal.title,
      description: organizationGoal.description,
      status: organizationGoal.status,
      departmentId: organizationGoal.departmentId,
      projectId: organizationGoal.projectId,
      parentGoalId: organizationGoal.parentGoalId,
      targetDate: organizationGoal.targetDate,
      updatedAt: organizationGoal.updatedAt,
    })
    .from(organizationGoal)
    .where(eq(organizationGoal.teamId, teamId))
    .orderBy(asc(organizationGoal.title), asc(organizationGoal.id));
  return rows.map((row) => ({ ...row, status: row.status as GoalStatus }));
}

// The projects an agent works in and their departments with the ones above them.
async function agentReach(
  teamId: number,
  agentUserId: string,
): Promise<{ projectIds: Set<number>; departmentIds: Set<number> }> {
  const projects = await db
    .select({ id: project.id, departmentId: organizationProjectAssignment.departmentId })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(
      organizationProjectAssignment,
      and(
        eq(organizationProjectAssignment.projectId, project.id),
        eq(organizationProjectAssignment.teamId, teamId),
      ),
    )
    .where(and(eq(projectMember.userId, agentUserId), eq(project.teamId, teamId)));
  const departments = await db
    .select({ id: organizationDepartment.id, parentId: organizationDepartment.parentId })
    .from(organizationDepartment)
    .where(eq(organizationDepartment.teamId, teamId));
  return {
    projectIds: new Set(projects.map((row) => row.id)),
    departmentIds: departmentsWithAncestors(
      projects.flatMap((row) => (row.departmentId == null ? [] : [row.departmentId])),
      departments,
    ),
  };
}

// The goals the caller may read: every goal of the team for a person and for the Home
// agent, the goals that concern it (and the ones above them) for any other agent.
async function readableGoals(caller: GoalCaller) {
  const goals = await teamGoals(caller.teamId);
  const agent = await callerAgent(caller);
  if (!agent || isHomeAgent(agent.username)) return { goals, visible: null, agent };
  const reach = await agentReach(caller.teamId, agent.userId);
  return { goals, visible: visibleGoalIds(goals, { all: false, ...reach }), agent };
}

export interface GoalProgress {
  // Linked tasks that are not canceled, and those of them that are done.
  total: number;
  done: number;
  // The agents working on the goal's open tasks (assigned, delegated or running).
  agents: { id: number; username: string; name: string }[];
}

// Progress of the team's goals from their linked tasks.
export async function goalProgress(teamId: number): Promise<Map<number, GoalProgress>> {
  const tasks = await db
    .select({
      goalId: helenaGoalTask.goalId,
      issueId: helenaGoalTask.issueId,
      stateType: projectColumn.stateType,
      assigneeUserId: issue.assigneeUserId,
      delegateUserId: issue.delegateUserId,
    })
    .from(helenaGoalTask)
    .innerJoin(issue, eq(issue.id, helenaGoalTask.issueId))
    .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(and(eq(helenaGoalTask.teamId, teamId), isNull(issue.archivedAt)));
  const open = tasks.filter(
    (task) => task.stateType !== 'completed' && task.stateType !== 'canceled',
  );
  const people = [
    ...new Set(open.flatMap((task) => [task.assigneeUserId, task.delegateUserId])),
  ].filter((id): id is string => !!id);
  const running = open.length
    ? await db
        .select({ issueId: agentRun.issueId, agentId: agentRun.agentId })
        .from(agentRun)
        .where(
          and(
            eq(agentRun.status, 'pending'),
            inArray(
              agentRun.issueId,
              open.map((task) => task.issueId),
            ),
          ),
        )
    : [];
  const agents =
    people.length || running.length
      ? await db
          .select({
            id: aiAgent.id,
            userId: aiAgent.userId,
            username: aiAgent.username,
            name: user.name,
          })
          .from(aiAgent)
          .innerJoin(user, eq(user.id, aiAgent.userId))
          .where(eq(aiAgent.teamId, teamId))
      : [];
  const byUser = new Map(agents.map((agent) => [agent.userId, agent]));
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const progress = new Map<number, GoalProgress>();
  const entry = (goalId: number) => {
    let found = progress.get(goalId);
    if (!found) {
      found = { total: 0, done: 0, agents: [] };
      progress.set(goalId, found);
    }
    return found;
  };
  const addAgent = (
    target: GoalProgress,
    agent: { id: number; username: string; name: string },
  ) => {
    if (!target.agents.some((known) => known.id === agent.id))
      target.agents.push({ id: agent.id, username: agent.username, name: agent.name });
  };
  for (const task of tasks) {
    if (task.stateType === 'canceled') continue;
    const target = entry(task.goalId);
    target.total++;
    if (task.stateType === 'completed') {
      target.done++;
      continue;
    }
    for (const userId of [task.assigneeUserId, task.delegateUserId]) {
      const agent = userId ? byUser.get(userId) : undefined;
      if (agent) addAgent(target, agent);
    }
    for (const run of running) {
      const agent = run.issueId === task.issueId ? byId.get(run.agentId) : undefined;
      if (agent) addAgent(target, agent);
    }
  }
  return progress;
}

export interface GoalSummary {
  id: number;
  title: string;
  description: string;
  status: GoalStatus;
  targetDate: string | null;
  parentGoalId: number | null;
  path: string[];
  project: { id: number; key: string; name: string } | null;
  department: { id: number; name: string } | null;
  progress: GoalProgress;
  updatedAt: string;
}

async function names(teamId: number) {
  const [projects, departments] = await Promise.all([
    db
      .select({ id: project.id, key: project.key, name: project.name })
      .from(project)
      .where(eq(project.teamId, teamId)),
    db
      .select({ id: organizationDepartment.id, name: organizationDepartment.name })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, teamId)),
  ]);
  return {
    projects: new Map(projects.map((row) => [row.id, row])),
    departments: new Map(departments.map((row) => [row.id, row])),
  };
}

function summarize(
  goal: ScopedGoal & { updatedAt: Date },
  byId: Map<number, ScopedGoal>,
  lookup: Awaited<ReturnType<typeof names>>,
  progress: Map<number, GoalProgress>,
): GoalSummary {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    targetDate: goal.targetDate,
    parentGoalId: goal.parentGoalId,
    path: goalPath(goal, byId),
    project: goal.projectId == null ? null : (lookup.projects.get(goal.projectId) ?? null),
    department:
      goal.departmentId == null ? null : (lookup.departments.get(goal.departmentId) ?? null),
    progress: progress.get(goal.id) ?? { total: 0, done: 0, agents: [] },
    updatedAt: goal.updatedAt.toISOString(),
  };
}

// list_goals: the goals the caller may read, of one status (active by default) or all,
// optionally of one project only.
export async function listGoals(
  caller: GoalCaller,
  filter: { status?: GoalStatus | 'all'; projectKey?: string } = {},
): Promise<GoalSummary[]> {
  const { goals, visible } = await readableGoals(caller);
  const status = filter.status ?? 'active';
  const lookup = await names(caller.teamId);
  const projectId = filter.projectKey
    ? [...lookup.projects.values()].find((row) => row.key === filter.projectKey)?.id
    : undefined;
  if (filter.projectKey && projectId === undefined) throw new HttpError(404, 'Project not found');
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const progress = await goalProgress(caller.teamId);
  return goals
    .filter((goal) => !visible || visible.has(goal.id))
    .filter((goal) => status === 'all' || goal.status === status)
    .filter((goal) => projectId === undefined || goal.projectId === projectId)
    .map((goal) => summarize(goal, byId, lookup, progress));
}

async function requireReadableGoal(caller: GoalCaller, goalId: number) {
  const readable = await readableGoals(caller);
  const goal = readable.goals.find((candidate) => candidate.id === goalId);
  if (!goal || (readable.visible && !readable.visible.has(goalId))) {
    throw new HttpError(404, 'Goal not found');
  }
  return { ...readable, goal };
}

export interface GoalTask {
  issueId: number;
  identifier: string;
  title: string;
  stateType: string;
  stateName: string;
  assignee: { name: string; username: string | null; agent: boolean } | null;
  running: boolean;
}

export interface GoalNote {
  id: number;
  body: string;
  author: { name: string; username: string | null; agent: boolean } | null;
  proposedStatus: GoalStatus | null;
  decision: 'accepted' | 'rejected' | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface GoalDetail extends GoalSummary {
  children: { id: number; title: string; status: GoalStatus }[];
  tasks: GoalTask[];
  notes: GoalNote[];
}

const MAX_DETAIL_TASKS = 200;
const MAX_DETAIL_NOTES = 50;

async function goalTasks(goalId: number): Promise<GoalTask[]> {
  const rows = await db
    .select({
      issueId: issue.id,
      key: project.key,
      sequenceNumber: issue.sequenceNumber,
      title: issue.title,
      stateType: projectColumn.stateType,
      stateName: projectColumn.name,
      assigneeUserId: sql<
        string | null
      >`coalesce(${issue.delegateUserId}, ${issue.assigneeUserId})`,
    })
    .from(helenaGoalTask)
    .innerJoin(issue, eq(issue.id, helenaGoalTask.issueId))
    .innerJoin(project, eq(project.id, issue.projectId))
    .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
    .where(and(eq(helenaGoalTask.goalId, goalId), isNull(issue.archivedAt)))
    .orderBy(asc(project.key), asc(issue.sequenceNumber))
    .limit(MAX_DETAIL_TASKS);
  const userIds = [
    ...new Set(rows.flatMap((row) => (row.assigneeUserId ? [row.assigneeUserId] : []))),
  ];
  const people = userIds.length
    ? await db
        .select({ id: user.id, name: user.name, username: aiAgent.username })
        .from(user)
        .leftJoin(aiAgent, eq(aiAgent.userId, user.id))
        .where(inArray(user.id, userIds))
    : [];
  const byUser = new Map(people.map((person) => [person.id, person]));
  const running = rows.length
    ? new Set(
        (
          await db
            .select({ issueId: agentRun.issueId })
            .from(agentRun)
            .where(
              and(
                eq(agentRun.status, 'pending'),
                inArray(
                  agentRun.issueId,
                  rows.map((row) => row.issueId),
                ),
              ),
            )
        ).map((row) => row.issueId),
      )
    : new Set<number | null>();
  return rows.map((row) => {
    const person = row.assigneeUserId ? byUser.get(row.assigneeUserId) : undefined;
    return {
      issueId: row.issueId,
      identifier: `${row.key}-${row.sequenceNumber}`,
      title: row.title,
      stateType: row.stateType,
      stateName: row.stateName,
      assignee: person
        ? { name: person.name, username: person.username, agent: person.username !== null }
        : null,
      running: running.has(row.issueId),
    };
  });
}

async function goalNotes(goalId: number): Promise<GoalNote[]> {
  const rows = await db
    .select({
      note: helenaGoalNote,
      authorName: user.name,
      authorUsername: aiAgent.username,
    })
    .from(helenaGoalNote)
    .leftJoin(user, eq(user.id, helenaGoalNote.authorUserId))
    .leftJoin(aiAgent, eq(aiAgent.userId, helenaGoalNote.authorUserId))
    .where(eq(helenaGoalNote.goalId, goalId))
    .orderBy(desc(helenaGoalNote.createdAt), desc(helenaGoalNote.id))
    .limit(MAX_DETAIL_NOTES);
  return rows.map(({ note, authorName, authorUsername }) =>
    noteOf(note, authorName, authorUsername),
  );
}

function noteOf(
  note: typeof helenaGoalNote.$inferSelect,
  authorName: string | null,
  authorUsername: string | null,
): GoalNote {
  return {
    id: note.id,
    body: note.body,
    author: authorName
      ? { name: authorName, username: authorUsername, agent: authorUsername !== null }
      : null,
    proposedStatus: (note.proposedStatus as GoalStatus | null) ?? null,
    decision: (note.decision as GoalNote['decision']) ?? null,
    decidedAt: note.decidedAt?.toISOString() ?? null,
    createdAt: note.createdAt.toISOString(),
  };
}

// get_goal: a goal the caller may read, with its chain, the goals below it that it may
// read, its linked tasks and its latest notes.
export async function getGoal(caller: GoalCaller, goalId: number): Promise<GoalDetail> {
  const { goals, visible, goal } = await requireReadableGoal(caller, goalId);
  const byId = new Map(goals.map((candidate) => [candidate.id, candidate]));
  const [lookup, progress, tasks, notes] = await Promise.all([
    names(caller.teamId),
    goalProgress(caller.teamId),
    goalTasks(goalId),
    goalNotes(goalId),
  ]);
  return {
    ...summarize(goal, byId, lookup, progress),
    children: goals
      .filter((child) => child.parentGoalId === goalId && (!visible || visible.has(child.id)))
      .map((child) => ({ id: child.id, title: child.title, status: child.status })),
    tasks,
    notes,
  };
}

// link_issue_to_goal: the goal the task serves, or none. The route's guard checked that
// the caller may edit the task; the goal has to be one of the task's team the caller may
// read.
export async function setIssueGoal(
  caller: Omit<GoalCaller, 'teamId'>,
  issueId: number,
  goalId: number | null,
): Promise<{ issueId: number; goalId: number | null }> {
  const [target] = await db
    .select({ id: issue.id, teamId: project.teamId })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(eq(issue.id, issueId));
  if (!target) throw new HttpError(404, 'Issue not found');
  if (goalId === null) {
    await db.delete(helenaGoalTask).where(eq(helenaGoalTask.issueId, issueId));
    return { issueId, goalId: null };
  }
  await requireReadableGoal({ teamId: target.teamId, userId: caller.userId }, goalId);
  await db
    .insert(helenaGoalTask)
    .values({ issueId, goalId, teamId: target.teamId, linkedByUserId: caller.userId })
    .onConflictDoUpdate({
      target: helenaGoalTask.issueId,
      set: { goalId, linkedByUserId: caller.userId, createdAt: new Date() },
    });
  return { issueId, goalId };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The link of a task created with its goal (create_issue goalId), in the task's own
// transaction; the goal was checked with assertLinkableGoal before.
export async function linkIssueGoalTx(
  tx: Tx,
  link: { issueId: number; goalId: number; teamId: number; actorUserId: string },
): Promise<void> {
  await tx.insert(helenaGoalTask).values({
    issueId: link.issueId,
    goalId: link.goalId,
    teamId: link.teamId,
    linkedByUserId: link.actorUserId,
  });
}

// Checks a goal before a task is created with it, so a refused goal creates no task.
export async function assertLinkableGoal(
  caller: Omit<GoalCaller, 'teamId'>,
  teamId: number,
  goalId: number,
): Promise<void> {
  await requireReadableGoal({ teamId, userId: caller.userId }, goalId);
}

// The goal a task serves, for the task's own views.
export async function issueGoal(
  issueId: number,
): Promise<{ id: number; title: string; status: GoalStatus } | null> {
  const [row] = await db
    .select({
      id: organizationGoal.id,
      title: organizationGoal.title,
      status: organizationGoal.status,
    })
    .from(helenaGoalTask)
    .innerJoin(organizationGoal, eq(organizationGoal.id, helenaGoalTask.goalId))
    .where(eq(helenaGoalTask.issueId, issueId));
  return row ? { ...row, status: row.status as GoalStatus } : null;
}

const MAX_NOTE = 4000;

// add_goal_note: progress on a goal, and an agent's proposal of a new status, which
// waits for a team owner or manager. A person changes the status on the goal itself.
export async function addGoalNote(
  caller: GoalCaller,
  goalId: number,
  input: { body: string; proposedStatus?: GoalStatus | null },
): Promise<GoalNote> {
  const { goal, agent } = await requireReadableGoal(caller, goalId);
  const body = input.body.trim();
  if (!body) throw new HttpError(400, 'A note needs a text');
  if (body.length > MAX_NOTE) throw new HttpError(400, 'The note is too long');
  const proposed = input.proposedStatus ?? null;
  if (proposed && !agent) {
    throw new HttpError(400, "Change the goal's status on the goal itself");
  }
  if (proposed && proposed === goal.status) {
    throw new HttpError(400, `The goal is ${goal.status} already`);
  }
  const [note] = await db
    .insert(helenaGoalNote)
    .values({
      teamId: caller.teamId,
      goalId,
      authorUserId: caller.userId,
      body,
      proposedStatus: proposed,
    })
    .returning();
  const [author] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, caller.userId));
  return noteOf(note!, author?.name ?? null, agent?.username ?? null);
}

// A team owner or manager accepts or rejects a proposed status. Accepting sets it.
export async function decideGoalNote(
  teamId: number,
  goalId: number,
  noteId: number,
  accept: boolean,
  deciderUserId: string,
): Promise<GoalNote> {
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select()
      .from(helenaGoalNote)
      .where(
        and(
          eq(helenaGoalNote.id, noteId),
          eq(helenaGoalNote.goalId, goalId),
          eq(helenaGoalNote.teamId, teamId),
        ),
      )
      .for('update');
    if (!note || !note.proposedStatus) throw new HttpError(404, 'Proposal not found');
    if (note.decision) throw new HttpError(409, 'The proposal was decided already');
    const [decided] = await tx
      .update(helenaGoalNote)
      .set({
        decision: accept ? 'accepted' : 'rejected',
        decidedByUserId: deciderUserId,
        decidedAt: new Date(),
      })
      .where(eq(helenaGoalNote.id, noteId))
      .returning();
    if (accept) {
      await tx
        .update(organizationGoal)
        .set({ status: note.proposedStatus, updatedAt: new Date() })
        .where(and(eq(organizationGoal.id, goalId), eq(organizationGoal.teamId, teamId)));
    }
    const [author] = note.authorUserId
      ? await tx
          .select({ name: user.name, username: aiAgent.username })
          .from(user)
          .leftJoin(aiAgent, eq(aiAgent.userId, user.id))
          .where(eq(user.id, note.authorUserId))
      : [];
    return noteOf(decided!, author?.name ?? null, author?.username ?? null);
  });
}

// The proposals that wait for a decision, per goal, for the organization page.
export async function pendingProposals(teamId: number): Promise<Map<number, number>> {
  const rows = await db
    .select({ goalId: helenaGoalNote.goalId, count: sql<number>`count(*)::int` })
    .from(helenaGoalNote)
    .where(
      and(
        eq(helenaGoalNote.teamId, teamId),
        sql`${helenaGoalNote.proposedStatus} IS NOT NULL`,
        isNull(helenaGoalNote.decision),
      ),
    )
    .groupBy(helenaGoalNote.goalId);
  return new Map(rows.map((row) => [row.goalId, row.count]));
}

// The active goals an agent's SOUL.md names (runtime-policy/goals.ts): those that concern
// it (all of the team's for the Home agent), without the goals above them, which only
// the chain of each names.
export async function activeGoalsForAgent(agent: {
  teamId: number;
  userId: string;
  username: string;
}): Promise<SoulGoal[]> {
  const goals = await teamGoals(agent.teamId);
  const active = goals.filter((goal) => goal.status === 'active');
  if (active.length === 0) return [];
  const byId = new Map(goals.map((goal) => [goal.id, goal]));
  const home = isHomeAgent(agent.username);
  const reach = home ? null : await agentReach(agent.teamId, agent.userId);
  const concerning = reach
    ? active.filter((goal) =>
        goal.projectId != null
          ? reach.projectIds.has(goal.projectId)
          : goal.departmentId != null
            ? reach.departmentIds.has(goal.departmentId)
            : true,
      )
    : active;
  if (concerning.length === 0) return [];
  const lookup = await names(agent.teamId);
  return concerning.map((goal) => {
    return {
      id: goal.id,
      title: goal.title,
      description: goal.description,
      path: goalPath(goal, byId),
      project: goal.projectId == null ? null : (lookup.projects.get(goal.projectId)?.key ?? null),
      department:
        goal.departmentId == null
          ? null
          : (lookup.departments.get(goal.departmentId)?.name ?? null),
      targetDate: goal.targetDate,
    };
  });
}
