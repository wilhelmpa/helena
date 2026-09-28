import {
  db,
  helenaGoalTask,
  helenaProjectGoalLink,
  initiative,
  issue,
  organizationDepartment,
  organizationGoal,
  organizationProjectAssignment,
  project,
  projectColumn,
  team,
} from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { checkPermission, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import type { GoalStatus } from '#modules/goals/scope';
import { contributions, defaultProjectGoal, projectPoolGoals } from './scope';

type Reader = Pick<typeof db, 'select'>;
async function poolGoals(reader: Reader, target: { id: number; teamId: number }) {
  const [goals, departments, assignments] = await Promise.all([
    reader
      .select()
      .from(organizationGoal)
      .where(eq(organizationGoal.teamId, target.teamId))
      .orderBy(asc(organizationGoal.title), asc(organizationGoal.id)),
    reader
      .select({ id: organizationDepartment.id, parentId: organizationDepartment.parentId })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, target.teamId)),
    reader
      .select({ departmentId: organizationProjectAssignment.departmentId })
      .from(organizationProjectAssignment)
      .where(
        and(
          eq(organizationProjectAssignment.projectId, target.id),
          eq(organizationProjectAssignment.teamId, target.teamId),
        ),
      ),
  ]);
  return projectPoolGoals(
    goals.map((goal) => ({ ...goal, status: goal.status as GoalStatus })),
    target.id,
    assignments[0]?.departmentId ?? null,
    departments,
  );
}

// The route asserts initiatives/read. Counts reveal only this project's work and
// only to a caller who can also read its tickets. No organization-wide totals.
export async function projectGoalContext(target: { id: number; teamId: number }, user: AuthUser) {
  const goals = await poolGoals(db, target);
  const visible = new Set(goals.map((goal) => goal.id));
  const [assignments, departments] = await Promise.all([
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
      .select({ id: organizationDepartment.id, parentId: organizationDepartment.parentId })
      .from(organizationDepartment)
      .where(eq(organizationDepartment.teamId, target.teamId)),
  ]);
  const defaultGoalId =
    defaultProjectGoal(goals, target.id, assignments[0]?.departmentId ?? null, departments)?.id ??
    null;
  const links = await db
    .select({ initiativeId: initiative.id, goalId: helenaProjectGoalLink.goalId })
    .from(helenaProjectGoalLink)
    .innerJoin(initiative, eq(initiative.id, helenaProjectGoalLink.initiativeId))
    .where(eq(initiative.projectId, target.id));
  const mayReadTasks = await checkPermission(target.id, user, 'work_items', 'read');
  const tasks = mayReadTasks
    ? await db
        .select({
          id: issue.id,
          parentId: issue.parentId,
          state: projectColumn.stateType,
          explicitGoalId: helenaGoalTask.goalId,
          inheritedGoalId: helenaProjectGoalLink.goalId,
        })
        .from(issue)
        .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
        .leftJoin(helenaGoalTask, eq(helenaGoalTask.issueId, issue.id))
        .leftJoin(
          initiative,
          and(eq(initiative.id, issue.initiativeId), eq(initiative.projectId, target.id)),
        )
        .leftJoin(helenaProjectGoalLink, eq(helenaProjectGoalLink.initiativeId, initiative.id))
        .where(and(eq(issue.projectId, target.id), isNull(issue.archivedAt)))
    : [];
  const progress = contributions(tasks, visible, defaultGoalId);
  return {
    goals: goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      targetDate: goal.targetDate,
      parentGoalId: goal.parentGoalId,
      path: goal.path,
      scope:
        goal.projectId !== null
          ? ('project' as const)
          : goal.departmentId !== null
            ? ('department' as const)
            : ('team' as const),
      progress: mayReadTasks ? (progress.get(goal.id) ?? { total: 0, done: 0 }) : null,
    })),
    links: links.filter((link) => visible.has(link.goalId)),
  };
}

// Serialize against the existing organization writer's team lock, then recheck
// the owning project and the target scope. No descriptive/status/owner field is copied.
export async function setProjectGoalLink(
  initiativeId: number,
  goalId: number | null,
  expectedProjectId: number,
) {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: project.id, teamId: project.teamId })
      .from(project)
      .where(eq(project.id, expectedProjectId));
    if (!target) throw new HttpError(404, 'Project not found');
    await tx.select({ id: team.id }).from(team).where(eq(team.id, target.teamId)).for('update');
    const [current] = await tx
      .select({ projectId: initiative.projectId })
      .from(initiative)
      .where(eq(initiative.id, initiativeId))
      .for('update');
    if (!current || current.projectId !== target.id)
      throw new HttpError(404, 'Project goal not found');
    if (goalId !== null && !(await poolGoals(tx, target)).some((goal) => goal.id === goalId))
      throw new HttpError(400, 'Goal is outside this project scope');
    if (goalId === null)
      await tx
        .delete(helenaProjectGoalLink)
        .where(eq(helenaProjectGoalLink.initiativeId, initiativeId));
    else
      await tx
        .insert(helenaProjectGoalLink)
        .values({ initiativeId, goalId })
        .onConflictDoUpdate({ target: helenaProjectGoalLink.initiativeId, set: { goalId } });
    return { initiativeId, goalId };
  });
}

// Templates run in no project. Home has no exception to project ACL here: these
// project goals expose existing private project content, unlike team-wide defaults.
export async function projectGoalsForAgent(agent: { teamId: number; userId: string }) {
  const projects = await db
    .select({ id: project.id, key: project.key, teamId: project.teamId })
    .from(project)
    .where(and(eq(project.teamId, agent.teamId), eq(project.initiativesEnabled, true)))
    .orderBy(asc(project.id));
  const lines: string[] = [];
  for (const target of projects) {
    if (!(await checkPermission(target.id, { id: agent.userId }, 'initiatives', 'read'))) continue;
    const goals = await poolGoals(db, target);
    const parents = new Map(goals.map((goal) => [goal.id, goal]));
    const rows = await db
      .select({ id: initiative.id, title: initiative.title, goalId: helenaProjectGoalLink.goalId })
      .from(initiative)
      .leftJoin(helenaProjectGoalLink, eq(helenaProjectGoalLink.initiativeId, initiative.id))
      .where(and(eq(initiative.projectId, target.id), eq(initiative.status, 'active')))
      .orderBy(asc(initiative.id))
      .limit(12 - lines.length);
    for (const row of rows) {
      const parent = row.goalId === null ? null : parents.get(row.goalId);
      const title = row.title.replace(/\s+/g, ' ').slice(0, 160);
      lines.push(
        `- ${target.key}: project goal ${row.id} "${title}"${parent ? `; contributes to pool goal #${parent.id}` : ''}`,
      );
    }
    if (lines.length >= 12) break;
  }
  return lines.length
    ? [
        '## Project goals',
        ...lines,
        'Read project goal details with get_initiative; its existing numeric ID is an initiativeId, not a pool goalId. Use get_project_goal_context for the live pool relationship. Keep human responsibility and explicit task-goal choices unchanged.',
      ].join('\n')
    : '';
}
