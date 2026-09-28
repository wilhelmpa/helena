import {
  aiAgent,
  db,
  helenaGoalTask,
  helenaProjectGoalLink,
  initiative,
  issue,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  user,
} from '@repo/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { defaultProjectGoal, projectPoolGoals } from './scope';
import type { GoalStatus } from '#modules/goals/scope';

export interface IssueWhy {
  department: { id: number; name: string } | null;
  goal: { id: number; title: string; path: string[] } | null;
  initiative: { id: number; title: string } | null;
  parents: { id: number; identifier: string; title: string }[];
  task: { id: number; identifier: string; title: string };
  source: 'explicit' | 'parent' | 'initiative' | 'project' | 'department' | 'team' | null;
}

// Resolve from the existing goal, initiative and task records each time: a changed
// parent or department immediately changes the effective chain without copying data.
export async function issueWhy(issueId: number): Promise<IssueWhy | null> {
  const [first] = await db
    .select({
      id: issue.id,
      projectId: issue.projectId,
      parentId: issue.parentId,
      initiativeId: issue.initiativeId,
      title: issue.title,
      sequenceNumber: issue.sequenceNumber,
    })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (!first) return null;
  const [target] = await db
    .select({ id: project.id, key: project.key, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, first.projectId));
  if (!target) return null;

  const ancestry = [first];
  const seen = new Set([first.id]);
  let parentId = first.parentId;
  while (parentId != null && !seen.has(parentId) && ancestry.length < 32) {
    const [parent] = await db
      .select({
        id: issue.id,
        projectId: issue.projectId,
        parentId: issue.parentId,
        initiativeId: issue.initiativeId,
        title: issue.title,
        sequenceNumber: issue.sequenceNumber,
      })
      .from(issue)
      .where(and(eq(issue.id, parentId), eq(issue.projectId, first.projectId)));
    if (!parent) break;
    ancestry.push(parent);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  const ids = ancestry.map((row) => row.id);
  const explicit = await db
    .select({ issueId: helenaGoalTask.issueId, goalId: helenaGoalTask.goalId })
    .from(helenaGoalTask)
    .where(inArray(helenaGoalTask.issueId, ids));
  const byIssue = new Map(explicit.map((row) => [row.issueId, row.goalId]));
  const initiativeIds = [...new Set(ancestry.flatMap((row) => row.initiativeId ?? []))];
  const initiatives = initiativeIds.length
    ? await db
        .select({
          id: initiative.id,
          projectId: initiative.projectId,
          title: initiative.title,
          goalId: helenaProjectGoalLink.goalId,
        })
        .from(initiative)
        .leftJoin(helenaProjectGoalLink, eq(helenaProjectGoalLink.initiativeId, initiative.id))
        .where(inArray(initiative.id, initiativeIds))
    : [];
  const validInitiatives = new Map(
    initiatives.filter((row) => row.projectId === target.id).map((row) => [row.id, row]),
  );
  const [assignment, departments, goals] = await Promise.all([
    db
      .select({ departmentId: organizationProjectAssignment.departmentId })
      .from(organizationProjectAssignment)
      .where(
        and(
          eq(organizationProjectAssignment.projectId, target.id),
          eq(organizationProjectAssignment.teamId, target.teamId),
        ),
      ),
    db
      .select({
        id: organizationDepartment.id,
        parentId: organizationDepartment.parentId,
        name: organizationDepartment.name,
      })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, target.teamId)),
    db.select().from(organizationGoal).where(eq(organizationGoal.teamId, target.teamId)),
  ]);
  const visible = projectPoolGoals(
    goals.map((goal) => ({ ...goal, status: goal.status as GoalStatus })),
    target.id,
    assignment[0]?.departmentId ?? null,
    departments,
  );
  const byGoal = new Map(visible.map((goal) => [goal.id, goal]));
  const selectedInitiative =
    ancestry
      .map((row) => (row.initiativeId == null ? null : validInitiatives.get(row.initiativeId)))
      .find((row) => row != null) ?? null;
  let goalId: number | null = null;
  let source: IssueWhy['source'] = null;
  for (const [index, row] of ancestry.entries()) {
    const candidate = byIssue.get(row.id);
    if (candidate != null) {
      goalId = candidate;
      source = index === 0 ? 'explicit' : 'parent';
      break;
    }
  }
  if (goalId == null) {
    for (const row of ancestry) {
      const candidate =
        row.initiativeId == null ? null : validInitiatives.get(row.initiativeId)?.goalId;
      if (candidate != null && byGoal.has(candidate)) {
        goalId = candidate;
        source = 'initiative';
        break;
      }
    }
  }
  if (goalId == null) {
    const fallback = defaultProjectGoal(
      visible,
      target.id,
      assignment[0]?.departmentId ?? null,
      departments,
    );
    if (fallback) {
      goalId = fallback.id;
      source =
        fallback.projectId != null
          ? 'project'
          : fallback.departmentId != null
            ? 'department'
            : 'team';
    }
  }
  const goal = goalId == null ? null : (byGoal.get(goalId) ?? null);
  const departmentId = goal?.departmentId ?? assignment[0]?.departmentId ?? null;
  const department = departments.find((row) => row.id === departmentId) ?? null;
  const ref = (row: typeof first) => ({
    id: row.id,
    identifier: `${target.key}-${row.sequenceNumber}`,
    title: row.title,
  });
  return {
    department: department ? { id: department.id, name: department.name } : null,
    goal: goal ? { id: goal.id, title: goal.title, path: goal.path } : null,
    initiative: selectedInitiative
      ? { id: selectedInitiative.id, title: selectedInitiative.title }
      : null,
    parents: ancestry.slice(1).reverse().map(ref),
    task: ref(first),
    source,
  };
}

export function issueWhySection(why: IssueWhy | null): string {
  if (!why) return '';
  const chain = [
    ...(why.department ? [why.department.name] : []),
    ...(why.goal ? [...why.goal.path, why.goal.title] : []),
    ...(why.initiative ? [why.initiative.title] : []),
    ...why.parents.map((parent) => `${parent.identifier} ${parent.title}`),
    `${why.task.identifier} ${why.task.title}`,
  ];
  return `\n\n## Why this task exists\n${chain.join(' → ')}\n`;
}

export async function projectWhyChains(projectId: number) {
  const tasks = await db
    .select({
      id: issue.id,
      delegateUserId: issue.delegateUserId,
      assigneeUserId: issue.assigneeUserId,
    })
    .from(issue)
    .where(and(eq(issue.projectId, projectId), isNull(issue.archivedAt)))
    .orderBy(desc(issue.updatedAt), desc(issue.id))
    .limit(40);
  const userIds = [
    ...new Set(
      tasks.flatMap((task) =>
        [task.delegateUserId, task.assigneeUserId].filter((id): id is string => id != null),
      ),
    ),
  ];
  const agents = userIds.length
    ? await db
        .select({ id: aiAgent.id, userId: aiAgent.userId, name: user.name })
        .from(aiAgent)
        .innerJoin(user, eq(user.id, aiAgent.userId))
        .where(inArray(aiAgent.userId, userIds))
    : [];
  const byUser = new Map(agents.map((agent) => [agent.userId, agent]));
  const chains = await Promise.all(
    tasks.map(async (task) => ({
      why: await issueWhy(task.id),
      agent: byUser.get(task.delegateUserId ?? '') ?? byUser.get(task.assigneeUserId ?? '') ?? null,
    })),
  );
  return chains.filter(
    (chain): chain is { why: IssueWhy; agent: (typeof agents)[number] | null } => chain.why != null,
  );
}
