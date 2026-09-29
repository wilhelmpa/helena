import { and, eq, not, or, sql, type SQL } from 'drizzle-orm';
import {
  aiAgent,
  db,
  getDisplayName,
  project,
  projectMember,
  team,
  teamRole,
  user as userTable,
} from '@repo/db';
import {
  HOME_DIR,
  isHiddenPath,
  locateVaultPath,
  pathOrBelow,
  PRIVATE_DIR,
  PROJECTS_DIR,
  TEMPLATES_DIR,
  type GitAuthor,
} from '@repo/vault';
import type { AuthUser } from '#shared/access';
import { hasPermission } from '#shared/permissions';
import { toMemberContext, type MemberRole } from '#modules/members/service';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import { knowledgeActor, type KnowledgeActor } from './reach';

// Who may read and write which part of the vault.
//
// - Projects/<KEY>/: by the caller's role in the project, like every project resource
//   (documents read / edit), while the project has Docs on. Over MCP the project also
//   has to be in its team's MCP reach.
// - Home/, Templates/ and everything else outside Projects/: the instance owner (the
//   god account). A project agent reads Templates/. The Home agent reads everything
//   but Private/, the projects of its team included, and writes Home/.
// - Private/: the instance owner only, never an agent. The file permissions enforce
//   the same for the agent user.
// - Hidden paths (.git, .obsidian, .trash) are never reached through the API.

export type VaultAction = 'read' | 'write';

interface Access {
  read: boolean;
  write: boolean;
}

export interface VaultScope {
  projects: Map<string, Access>;
  home: Access;
  templates: Access;
  private: boolean;
  agent: { username: string } | null;
  author: GitAuthor;
  // Who writes, for the index and the history's trailers (reach.ts).
  actor: KnowledgeActor;
}

const NONE: Access = { read: false, write: false };

const projectColumns = {
  key: project.key,
  documentsEnabled: project.documentsEnabled,
  mcpEnabled: project.mcpEnabled,
  teamMcpEnabled: team.mcpEnabled,
};

interface ProjectFlags {
  documentsEnabled: boolean;
  mcpEnabled: boolean;
  teamMcpEnabled: boolean;
}

async function memberships(userId: string) {
  return db
    .select({ ...projectColumns, role: projectMember.role, permissions: teamRole.permissions })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .innerJoin(team, eq(team.id, project.teamId))
    .leftJoin(teamRole, eq(teamRole.id, projectMember.roleId))
    .where(eq(projectMember.userId, userId));
}

async function teamProjects(teamId: number) {
  return db
    .select(projectColumns)
    .from(project)
    .innerJoin(team, eq(team.id, project.teamId))
    .where(eq(project.teamId, teamId));
}

export async function vaultScope(
  caller: AuthUser,
  viaMcp: boolean,
  headers: Headers | null = null,
): Promise<VaultScope> {
  const [person] = await db
    .select({ name: userTable.name, email: userTable.email, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, caller.id));
  const [agent] = await db
    .select({
      username: aiAgent.username,
      teamId: aiAgent.teamId,
      agentRole: aiAgent.agentRole,
      projectScope: aiAgent.projectScope,
    })
    .from(aiAgent)
    .where(eq(aiAgent.userId, caller.id));
  const allProjects = agent?.projectScope === 'all';
  const homeAgent = agent ? isHomeAgent(agent.agentRole) : false;
  const reachable = (row: ProjectFlags) =>
    row.documentsEnabled && (!viaMcp || (row.mcpEnabled && row.teamMcpEnabled));
  const projects = new Map<string, Access>();
  if (allProjects) {
    for (const row of await teamProjects(agent.teamId)) {
      if (reachable(row)) projects.set(row.key, { read: true, write: false });
    }
  } else {
    for (const row of await memberships(caller.id)) {
      if (!reachable(row)) continue;
      const { permissions } = toMemberContext(row.role as MemberRole, row.permissions);
      const owner = row.role === 'owner';
      projects.set(row.key, {
        read: owner || hasPermission(permissions, 'documents', 'read'),
        write: owner || hasPermission(permissions, 'documents', 'edit'),
      });
    }
  }
  const owner = !agent && person?.role === 'god';
  const readsProjects = [...projects.values()].some((access) => access.read);
  return {
    projects,
    home: owner || homeAgent ? { read: true, write: true } : NONE,
    templates: owner
      ? { read: true, write: true }
      : { read: homeAgent || readsProjects, write: false },
    private: owner,
    agent: agent ? { username: agent.username } : null,
    author: agent
      ? { name: person?.name || agent.username, email: `${agent.username}@agents.volition.local` }
      : {
          name: person?.name || (await getDisplayName()),
          email: person?.email || 'helena@volition.local',
        },
    actor: await knowledgeActor(caller, headers),
  };
}

export function canAccess(scope: VaultScope, relative: string, action: VaultAction): boolean {
  if (isHiddenPath(relative)) return false;
  if (relative === '' || relative === PROJECTS_DIR) return action === 'read';
  const location = locateVaultPath(relative);
  switch (location.scope) {
    case 'private':
      return scope.private;
    case 'project':
      return (scope.projects.get(location.projectKey!) ?? NONE)[action];
    case 'templates':
      return scope.templates[action];
    case 'home':
    case 'root':
      return scope.home[action];
  }
}

// The index rows a scope may read, as a condition on vault_entry.
export function readableEntries(scope: VaultScope): SQL {
  const parts: SQL[] = [];
  for (const [key, access] of scope.projects) {
    if (access.read) parts.push(pathOrBelow(`${PROJECTS_DIR}/${key}`));
  }
  if (scope.templates.read) parts.push(pathOrBelow(TEMPLATES_DIR));
  if (scope.private) parts.push(pathOrBelow(PRIVATE_DIR));
  if (scope.home.read) {
    parts.push(pathOrBelow(HOME_DIR));
    parts.push(
      not(or(pathOrBelow(PROJECTS_DIR), pathOrBelow(PRIVATE_DIR), pathOrBelow(TEMPLATES_DIR))!),
    );
  }
  return parts.length > 0 ? or(...parts)! : sql`false`;
}

// A condition for the rows of one folder and below, within a scope.
export function readableBelow(scope: VaultScope, folder: string): SQL {
  return folder ? and(readableEntries(scope), pathOrBelow(folder))! : readableEntries(scope);
}
