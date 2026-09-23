import { db, projectMember, teamMember, teamRole, revision } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import { hasPermission, type PermissionResource } from '#shared/permissions';

// The revision engine's read side. The counters themselves are written by the
// triggers in migration 0070 — no application code bumps them, so a write moves
// the marker whichever process it came from.

// A scope kind a client may ask for: the key it maps to in the revision table and
// the resource the caller must be allowed to read to watch it. Project-wide and
// entity scopes use the supplied id. The inbox is per user, so the session user is
// added to its key here; clients never send or see it, and it needs no permission.
export interface ScopeKind {
  key: (id: number, userId: string) => string;
  resource: PermissionResource | null;
  teamScoped?: boolean;
}

export const scopeKind: Record<string, ScopeKind> = {
  board: { key: (projectId) => `board:${projectId}`, resource: 'work_items' },
  documents: { key: (projectId) => `documents:${projectId}`, resource: 'documents' },
  actionRuns: { key: (projectId) => `action-runs:${projectId}`, resource: 'actions' },
  controlPlane: { key: (projectId) => `control-plane:${projectId}`, resource: 'actions' },
  agentRuns: { key: (projectId) => `agent-runs:${projectId}`, resource: 'ai_agents' },
  issue: { key: (issueId) => `issue:${issueId}`, resource: 'work_items' },
  initiative: {
    key: (initiativeId) => `initiative:${initiativeId}`,
    resource: 'initiatives',
  },
  inbox: { key: (projectId, userId) => `inbox:${projectId}:${userId}`, resource: null },
  hubInbox: { key: (teamId) => `hub-inbox:${teamId}`, resource: null, teamScoped: true },
  approvals: { key: (teamId) => `approvals:${teamId}`, resource: null, teamScoped: true },
};

export async function bumpControlPlaneRevision(projectId: number): Promise<void> {
  await db
    .insert(revision)
    .values({ scope: `control-plane:${projectId}`, projectId, rev: 1 })
    .onConflictDoUpdate({ target: revision.scope, set: { rev: sql`${revision.rev} + 1` } });
}

// A scope with no row has never changed; a client treats it the same as any other
// unchanged value, so it reads as "0".
export const NO_REV = '0';

// One scope to read: its key in the revision table and the resource it belongs to.
export interface ScopeRead {
  key: string;
  resource: PermissionResource | null;
  teamScoped?: boolean;
}

// The markers a client is watching, in one query. The join against the membership
// is the access check: a scope of a project the user is not a member of returns no
// row and reads as unchanged. The role decides the rest — a scope whose resource
// the member may not read is dropped the same way, so it also reads as unchanged.
export async function readRevs(
  wanted: ScopeRead[],
  userId: string,
): Promise<Record<string, string>> {
  if (wanted.length === 0) return {};
  const projectWanted = wanted.filter((row) => !row.teamScoped);
  const teamWanted = wanted.filter((row) => row.teamScoped);
  const rows =
    projectWanted.length === 0
      ? []
      : await db
          .select({
            scope: revision.scope,
            rev: revision.rev,
            role: projectMember.role,
            permissions: teamRole.permissions,
          })
          .from(revision)
          .innerJoin(projectMember, eq(projectMember.projectId, revision.projectId))
          .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
          .where(
            and(
              inArray(
                revision.scope,
                projectWanted.map((w) => w.key),
              ),
              eq(projectMember.userId, userId),
            ),
          );

  const resources = new Map(wanted.map((w) => [w.key, w.resource]));
  const out: Record<string, string> = {};
  for (const row of rows) {
    const resource = resources.get(row.scope);
    if (resource) {
      const { permissions } = toMemberContext(row.role as MemberRole, row.permissions);
      if (!hasPermission(permissions, resource, 'read')) continue;
    }
    out[row.scope] = String(row.rev);
  }
  if (teamWanted.length > 0) {
    const teamRows = await db
      .select({ scope: revision.scope, rev: revision.rev })
      .from(revision)
      .innerJoin(teamMember, eq(teamMember.teamId, revision.projectId))
      .where(
        and(
          inArray(
            revision.scope,
            teamWanted.map((row) => row.key),
          ),
          eq(teamMember.userId, userId),
        ),
      );
    for (const row of teamRows) out[row.scope] = String(row.rev);
  }
  return out;
}
