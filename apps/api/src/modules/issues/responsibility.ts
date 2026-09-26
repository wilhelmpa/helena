import { aiAgent, db, issue, project, projectMember, teamMember, teamRole } from '@repo/db';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { defaultMemberPermissions, hasPermission, normalizePermissions } from '#shared/permissions';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function canReadTasks(member: { role: string; permissions: unknown }): boolean {
  return (
    member.role === 'owner' ||
    hasPermission(
      member.permissions ? normalizePermissions(member.permissions) : defaultMemberPermissions(),
      'work_items',
      'read',
    )
  );
}

export async function canBeIssueAssignee(
  projectId: number,
  userId: string,
  connection: typeof db | Transaction = db,
): Promise<boolean> {
  const [member] = await connection
    .select({ role: projectMember.role, permissions: teamRole.permissions })
    .from(projectMember)
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .leftJoin(aiAgent, eq(aiAgent.userId, projectMember.userId))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        eq(projectMember.userId, userId),
        isNull(aiAgent.id),
      ),
    )
    .limit(1);
  return member !== undefined && canReadTasks(member);
}

export async function resolveIssueAssignee(
  projectId: number,
  input: {
    assigneeUserId?: string | null;
    parentId?: number | null;
    columnAssigneeUserId?: string | null;
  },
  connection: typeof db | Transaction = db,
): Promise<string> {
  if (input.assigneeUserId != null) {
    if (!(await canBeIssueAssignee(projectId, input.assigneeUserId, connection)))
      throw new HttpError(
        400,
        'Assignee must be a human project member who can read tasks; use delegate for an agent',
      );
    return input.assigneeUserId;
  }
  if (input.parentId != null) {
    const [parent] = await connection
      .select({ assigneeUserId: issue.assigneeUserId })
      .from(issue)
      .where(and(eq(issue.id, input.parentId), eq(issue.projectId, projectId)))
      .limit(1);
    if (
      parent?.assigneeUserId &&
      (await canBeIssueAssignee(projectId, parent.assigneeUserId, connection))
    )
      return parent.assigneeUserId;
  }
  if (
    input.columnAssigneeUserId &&
    (await canBeIssueAssignee(projectId, input.columnAssigneeUserId, connection))
  )
    return input.columnAssigneeUserId;

  const owner = await defaultIssueOwner(connection, projectId);
  if (!owner)
    throw new HttpError(
      400,
      'Project needs a responsible human owner before creating or assigning tasks',
    );
  return owner;
}

async function defaultIssueOwner(
  connection: typeof db | Transaction,
  projectId: number,
  leavingUserId?: string,
): Promise<string | null> {
  const owners = await connection
    .select({
      userId: projectMember.userId,
      role: projectMember.role,
      permissions: teamRole.permissions,
    })
    .from(projectMember)
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(
      teamMember,
      and(eq(teamMember.teamId, project.teamId), eq(teamMember.userId, projectMember.userId)),
    )
    .leftJoin(aiAgent, eq(aiAgent.userId, projectMember.userId))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        isNull(aiAgent.id),
        leavingUserId ? ne(projectMember.userId, leavingUserId) : undefined,
        or(eq(teamMember.role, 'owner'), eq(projectMember.role, 'owner')),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${teamMember.role} = 'owner' THEN 0 ELSE 1 END`,
      asc(projectMember.createdAt),
      asc(projectMember.userId),
    );
  return owners.find(canReadTasks)?.userId ?? null;
}

export async function transferDepartingAssignee(
  tx: Transaction,
  userId: string,
  projectIds?: number[],
): Promise<void> {
  if (projectIds?.length === 0) return;
  const tasks = await tx
    .select({ projectId: issue.projectId })
    .from(issue)
    .where(
      and(
        eq(issue.assigneeUserId, userId),
        projectIds ? inArray(issue.projectId, projectIds) : undefined,
      ),
    );
  const affectedProjects = [...new Set(tasks.map((task) => task.projectId))].sort((a, b) => a - b);
  if (affectedProjects.length === 0) return;
  await tx
    .select({ id: project.id })
    .from(project)
    .where(inArray(project.id, affectedProjects))
    .orderBy(asc(project.id))
    .for('update');
  for (const projectId of affectedProjects) {
    const owner = await defaultIssueOwner(tx, projectId, userId);
    if (!owner)
      throw new HttpError(
        409,
        'Assign another human project owner before removing a responsible person',
      );
    await tx
      .update(issue)
      .set({ assigneeUserId: owner, updatedAt: new Date() })
      .where(and(eq(issue.projectId, projectId), eq(issue.assigneeUserId, userId)));
  }
}
