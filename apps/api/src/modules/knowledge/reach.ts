import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import {
  agentRun,
  aiAgent,
  db,
  project,
  projectMember,
  team,
  teamMember,
  teamRole,
  user as userTable,
  userPreference,
} from '@repo/db';
import { HOME_VAULT_RESOURCE, type KnowledgeReach } from '@helena/knowledge';
import type { AuthUser } from '#shared/access';
import { hasPermission, PERMISSION_RESOURCES } from '#shared/permissions';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import { runsTeam, type TeamStanding } from '#modules/teams/service';
import { isHomeAgent } from '#modules/agents/core/home-agent';

// A reader's reach in the knowledge index (see @helena/knowledge reach.ts), from the
// same rules the routes of each source check:
// - a project item by the reader's role in the project (the resource it names, read),
//   documents only while the project has Docs on, and over MCP only for projects in
//   their team's MCP reach;
// - an item of no project (Home docs, Home mail) by the team's owners and managers;
//   the Home agent reads Home's docs and every project's docs of its team, like the
//   vault (scope.ts); other members read only items without a permission (templates);
// - a private item (a chat, Private/) by its owner.

async function projectRows(userId: string) {
  return db
    .select({
      projectId: project.id,
      teamId: project.teamId,
      documentsEnabled: project.documentsEnabled,
      mcpEnabled: project.mcpEnabled,
      teamMcpEnabled: team.mcpEnabled,
      role: projectMember.role,
      permissions: teamRole.permissions,
    })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .innerJoin(team, eq(team.id, project.teamId))
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .where(eq(projectMember.userId, userId));
}

export async function knowledgeReach(caller: AuthUser, viaMcp: boolean): Promise<KnowledgeReach> {
  const projects = new Map<number, Set<string>>();
  const teams = new Map<number, Set<string>>();
  for (const row of await projectRows(caller.id)) {
    if (viaMcp && !(row.mcpEnabled && row.teamMcpEnabled)) continue;
    const { permissions } = toMemberContext(row.role as MemberRole, row.permissions);
    const resources = new Set<string>(
      PERMISSION_RESOURCES.filter((resource) => hasPermission(permissions, resource, 'read')),
    );
    if (!row.documentsEnabled) resources.delete('documents');
    projects.set(row.projectId, resources);
  }
  const standings = await db
    .select({ teamId: teamMember.teamId, role: teamMember.role })
    .from(teamMember)
    .where(eq(teamMember.userId, caller.id));
  const [agent] = await db
    .select({
      username: aiAgent.username,
      teamId: aiAgent.teamId,
      agentRole: aiAgent.agentRole,
      projectScope: aiAgent.projectScope,
    })
    .from(aiAgent)
    .where(eq(aiAgent.userId, caller.id));
  const [person] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, caller.id));
  // Home's own folder of the vault is the instance owner's (and the Home agent's), not
  // every team owner's: the vault's rule (scope.ts).
  const instanceOwner = !agent && person?.role === 'god';
  for (const standing of standings) {
    const resources = new Set<string>(
      runsTeam(standing.role as TeamStanding) ? PERMISSION_RESOURCES : [],
    );
    if (instanceOwner) resources.add(HOME_VAULT_RESOURCE);
    teams.set(standing.teamId, resources);
  }
  if (agent?.projectScope === 'all') {
    const teamProjects = await db
      .select({
        id: project.id,
        documentsEnabled: project.documentsEnabled,
        mcpEnabled: project.mcpEnabled,
        teamMcpEnabled: team.mcpEnabled,
      })
      .from(project)
      .innerJoin(team, eq(team.id, project.teamId))
      .where(eq(project.teamId, agent.teamId));
    for (const row of teamProjects) {
      if (!row.documentsEnabled || (viaMcp && !(row.mcpEnabled && row.teamMcpEnabled))) continue;
      const resources = projects.get(row.id) ?? new Set<string>();
      resources.add('documents');
      projects.set(row.id, resources);
    }
    const own = teams.get(agent.teamId) ?? new Set<string>();
    own.add('documents');
    if (isHomeAgent(agent.agentRole)) own.add(HOME_VAULT_RESOURCE);
    teams.set(agent.teamId, own);
  }
  return { userId: caller.id, projects, teams };
}

// Who acts, as the knowledge index and the vault history name them: `agent:<id>` for an
// agent's bot user, `user:<id>` for a person; with the agent's run when it is known.
export interface KnowledgeActor {
  ref: string;
  agentId: number | null;
  runId: number | null;
  timeZone: string;
  locale: string;
}

// The runner names the run an agent works in with this header (hub/hermes-sync). Without
// it, an agent with exactly one run in progress is taken to act in that one.
export const RUN_HEADER = 'x-helena-run';

async function currentRun(agentId: number, headers: Headers | null): Promise<number | null> {
  const named = Number(headers?.get(RUN_HEADER) ?? '');
  if (Number.isSafeInteger(named) && named > 0) {
    const [row] = await db
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.id, named), eq(agentRun.agentId, agentId)));
    if (row) return row.id;
  }
  const active = await db
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.agentId, agentId),
        isNotNull(agentRun.startedAt),
        isNull(agentRun.finishedAt),
      ),
    )
    .orderBy(desc(agentRun.startedAt))
    .limit(2);
  return active.length === 1 ? active[0]!.id : null;
}

export async function knowledgeActor(
  caller: AuthUser,
  headers: Headers | null,
): Promise<KnowledgeActor> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(eq(aiAgent.userId, caller.id));
  const [preference] = await db
    .select({ timezone: userPreference.timezone, locale: userPreference.locale })
    .from(userPreference)
    .where(eq(userPreference.userId, caller.id));
  return {
    ref: agent ? `agent:${agent.id}` : `user:${caller.id}`,
    agentId: agent?.id ?? null,
    runId: agent ? await currentRun(agent.id, headers) : null,
    timeZone: preference?.timezone || 'UTC',
    locale: preference?.locale || 'en',
  };
}
