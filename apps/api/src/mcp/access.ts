import { agentAccess, agentMayInspect, agentMayReadDecisionClasses } from '#shared/agent-access';
import { getMemberContext, getTeamPermissions } from '#modules/members/service';
import { getTeamMembership, runsTeam } from '#modules/teams/service';
import { listProjects } from '#modules/projects/service';
import { rootOwner } from '#modules/root-access/service';
import { mailScope } from '#modules/mail/access';
import { hasPermission, type PermissionAction, type PermissionResource } from '#shared/permissions';
import type { McpRouteTool } from './generate';

// Preflight only proves impossibility. Entity/project arguments are still authorized by
// the actual route on every call; no handler is executed to probe access.
export async function routeAccessForAgent(userId: string, teamId: number | null) {
  const agent = await agentAccess(userId);
  if (!agent || teamId === null) return (_route: McpRouteTool) => true;
  const [standing, teamPermissions, projects, inspector, decisionReader, triageScope, readScope] =
    await Promise.all([
      getTeamMembership(teamId, userId),
      getTeamPermissions(teamId, userId),
      listProjects(userId, { mcpOnly: true }),
      agentMayInspect(userId, teamId),
      agentMayReadDecisionClasses(userId, teamId),
      mailScope(teamId, { id: userId }, 'triage'),
      mailScope(teamId, { id: userId }, 'read'),
    ]);
  const root = await rootOwner(agent.id)
    .then(() => true)
    .catch(() => false);
  const projectContexts = await Promise.all(
    projects
      .filter((p) => p.teamId === teamId)
      .map(async (p) => ({ id: p.id, context: await getMemberContext(p.id, userId) })),
  );
  return (route: McpRouteTool): boolean => {
    if (route.access === 'root-owner' && !root) return false;
    if (
      route.access === 'project-owner' &&
      !projectContexts.some((p) => p.context?.role === 'owner')
    )
      return false;
    if (route.access === 'person-only') return false;
    if (route.access === 'team-manager' && !runsTeam(standing)) return false;
    if (route.access === 'team-owner' && standing !== 'owner') return false;
    if (route.access === 'decision-reader' && !runsTeam(standing) && !decisionReader) return false;
    if (route.access === 'agent-inspector' && !inspector) return false;
    if (
      agent.coordinator === 'coordinator' &&
      route.category === 'send' &&
      route.path.includes('mail')
    )
      return false;
    if (
      agent.coordinator === 'coordinator' &&
      route.category === 'delete' &&
      route.path.includes('mail')
    )
      return false;
    if (
      route.path.includes('/mail/') &&
      !route.permission &&
      route.method === 'GET' &&
      !readScope.home &&
      !readScope.projectIds.length
    )
      return false;
    const pair = route.permission;
    if (!pair) return true;
    const [resource, action] = pair;
    if (resource === 'ai_agents' && action === 'read' && inspector) return true;
    if (
      resource === 'mail' &&
      agent.coordinator === 'coordinator' &&
      agent.role !== 'home' &&
      (action === 'create' || action === 'delete')
    )
      return false;
    if (resource === 'receipts')
      return (
        runsTeam(standing) ||
        projectContexts.some(
          (p) => p.context?.role === 'owner' || (agent.modelRole === 'finance' && !agent.template),
        )
      );
    if (resource === 'mail' && action === 'triage')
      return triageScope.home || triageScope.projectIds.length > 0;
    if (resource === 'mail' && action === 'read')
      return readScope.home || readScope.projectIds.length > 0;
    if (resource === 'project_admin')
      return runsTeam(standing) || projectContexts.some((p) => p.context?.role === 'owner');
    if (route.path.includes(':teamId') || route.path.startsWith('/hub-inbox/'))
      return (
        runsTeam(standing) ||
        hasPermission(teamPermissions, resource as PermissionResource, action as PermissionAction)
      );
    return projectContexts.some(
      (p) =>
        p.context &&
        (p.context.role === 'owner' ||
          hasPermission(
            p.context.permissions,
            resource as PermissionResource,
            action as PermissionAction,
          )),
    );
  };
}
