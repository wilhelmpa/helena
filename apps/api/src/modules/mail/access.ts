import { agentAccess } from '#shared/agent-access';
import { db, mailThread, project, projectMember, teamRole } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import { getTeamMembership, runsTeam } from '#modules/teams/service';
import { requireUser, type AuthUser } from '#shared/access';
import { assertMcpAllowed } from '#shared/guards';
import { HttpError } from '#shared/lib';
import { hasPermission, type PermissionAction } from '#shared/permissions';

// Who may read and change mail. A thread belongs to one project, or to Home when it
// has none. Home mail is the team's own: its owners and managers reach it. Project
// mail is reached through the mail permission of the project's role, which agents
// hold too; the owners and managers of the team reach every project's mail.
export interface MailScope {
  home: boolean;
  projectIds: number[];
}

export async function mailScope(
  teamId: number,
  user: AuthUser | null | undefined,
  action: PermissionAction | 'triage',
): Promise<MailScope> {
  const userId = requireUser(user).id;
  const standing = await getTeamMembership(teamId, userId);
  if (!standing) throw new HttpError(404, 'Team not found');
  const agent = await agentAccess(userId, teamId);
  if (runsTeam(standing) || agent?.role === 'home') {
    const rows = await db
      .select({ id: project.id })
      .from(project)
      .where(eq(project.teamId, teamId));
    return { home: true, projectIds: rows.map((row) => row.id) };
  }
  const rows = await db
    .select({
      projectId: projectMember.projectId,
      role: projectMember.role,
      permissions: teamRole.permissions,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .where(and(eq(projectMember.userId, userId), eq(project.teamId, teamId)));
  const allowed = rows.map((row) => {
    const coordinator = agent?.coordinator === 'coordinator';
    if (coordinator && (action === 'create' || action === 'delete')) return null;
    return (
      action === 'triage'
        ? coordinator ||
          hasPermission(
            toMemberContext(row.role as MemberRole, row.permissions).permissions,
            'mail',
            'edit',
          )
        : (action === 'read' && coordinator) ||
          hasPermission(
            toMemberContext(row.role as MemberRole, row.permissions).permissions,
            'mail',
            action,
          )
    )
      ? row.projectId
      : null;
  });
  return { home: false, projectIds: allowed.filter((id): id is number => id !== null) };
}

export function inScope(scope: MailScope, projectId: number | null): boolean {
  return projectId == null ? scope.home : scope.projectIds.includes(projectId);
}

// The team a mail row belongs to must be the caller's, and the project it is filed in
// one whose mail the caller may reach with `action`.
export async function assertMailAccess(
  teamId: number,
  projectId: number | null,
  user: AuthUser | null | undefined,
  action: PermissionAction | 'triage',
  headers: Headers,
): Promise<void> {
  const scope = await mailScope(teamId, user, action).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, 'Not found');
    throw error;
  });
  if (!inScope(scope, projectId)) {
    throw new HttpError(403, `You do not have permission to ${action} this mail`);
  }
  if (projectId != null) await assertMcpAllowed(projectId, headers);
}

export async function threadAccess(
  threadId: number,
  user: AuthUser | null | undefined,
  action: PermissionAction | 'triage',
  headers: Headers,
) {
  const [thread] = await db
    .select({
      id: mailThread.id,
      teamId: mailThread.teamId,
      accountId: mailThread.accountId,
      projectId: mailThread.projectId,
    })
    .from(mailThread)
    .where(eq(mailThread.id, threadId));
  if (!thread) throw new HttpError(404, 'Mail thread not found');
  await assertMailAccess(thread.teamId, thread.projectId, user, action, headers).catch(
    (error: unknown) => {
      if (error instanceof HttpError && error.status === 404)
        throw new HttpError(404, 'Mail thread not found');
      throw error;
    },
  );
  return thread;
}
