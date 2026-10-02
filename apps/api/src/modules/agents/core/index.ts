import { listAgentTrash, permanentlyDeleteTrashedAgent, setAgentTrashed } from './trash';
import { Elysia, t } from 'elysia';
import { noContent } from '#shared/http';
import { guards } from '#shared/guards';
import { authContext } from '#shared/auth-context';
import { requireUser, type TeamMembership } from '#shared/access';
import { HttpError } from '#shared/lib';
import { accessErrors, commonErrors, errors } from '#shared/responses';
import { mcpTool } from '#mcp/generate';
import { teamParams } from '#modules/teams/model';
import { runsTeam } from '#modules/teams/service';
import { isHomeHandle } from './home-agent';
import { agentContextSizeView, agentSizeLimits } from './context-limits';
import {
  listAgents,
  matchAgentQuery,
  createAgent,
  updateAgent,
  regenerateKey,
  queueAgentRuntime,
  getAgentById,
  getAgentInProject,
  agentScopeOf,
  memberProjectIds,
  copyTemplateIntoProject,
  saveAgentAsTemplate,
} from './service';
import { consolidateAgentMemory, dreamHistory } from '../native-runtime/consolidation';
import { resetCopyToTemplate } from './template-sync';
import {
  AgentRunArchiveResponse,
  AgentDreamHistory,
  AgentRunPageResponse,
  agentRunParams,
  AiAgentListResponse,
  AiAgentResponse,
  ChatMessagesResponse,
  ChatThreadListResponse,
  CreateAgentResponse,
  renameThreadBody,
  RegenerateKeyResponse,
  agentListQuery,
  agentDeleteQuery,
  agentParams,
  copyTemplateBody,
  saveAsTemplateBody,
  createAgentBody,
  projectAgentParams,
  resetToTemplateBody,
  runsQuery,
  setAgentProjectsBody,
  threadListQuery,
  threadPageQuery,
  threadParams,
  teamThreadParams,
  updateAgentBody,
} from './model';
import { listAgentRuns, setAgentRunArchived } from './run-queue';
import { listAgentHeartbeats } from './heartbeats';
import { addFavorite, removeFavorite } from '../chat-favorites';
import {
  listThreads,
  getThreadMessages,
  deleteThread,
  renameThread,
  ownsThread,
} from '../chat/service';

// The agent a :agentId path addresses, scoped by agentScopeOf — one of another team, and
// one of a project the caller is not in, both read as missing.
async function requireVisibleAgent(
  agentId: number,
  membership: TeamMembership,
  includeDeleted = false,
) {
  const agent = await getAgentById(
    agentId,
    membership.teamId,
    agentScopeOf(membership),
    includeDeleted,
  );
  if (!agent) throw new HttpError(404, 'Agent not found');
  return agent;
}

// The Home agent is recognised by its handle, so no other agent may take it.
function assertNotHomeHandle(username: string | undefined) {
  if (username !== undefined && isHomeHandle(username)) {
    throw new HttpError(409, 'This username is reserved for the Home agent');
  }
}

// The projects the caller may put the agent in: an owner or a manager of the team
// reaches every project it owns, anyone else only the projects they are a member of
// themselves. A project outside that set is refused. One the agent already works in
// and the caller cannot see is kept, so a partial view never detaches it.
async function resolveAgentProjects(
  membership: TeamMembership,
  next: number[] | undefined,
  current: { id: number }[],
): Promise<number[] | undefined> {
  if (next == null || runsTeam(membership.role)) return next;
  const mine = new Set(await memberProjectIds(membership.teamId, membership.userId));
  if (next.some((id) => !mine.has(id))) {
    throw new HttpError(403, 'You can only attach an agent to a project you are a member of');
  }
  const hidden = current.filter((p) => !mine.has(p.id)).map((p) => p.id);
  return [...next, ...hidden];
}

// An agent belongs to a team, so managing it — creating, editing, attaching it to a
// project, reading its key — sits under :teamId, gated by the ai_agents resource on the
// team: its owner and managers always, an owner of one of its projects always, another
// member when a project role of theirs grants it. One path carries one guard; a second
// one under the project would need its own answer for a project member who holds no
// rights in the team.
//
// The permission is merged from every project role the caller holds in the team, so it
// says what they may do, not which agents they may do it to. Which ones is
// requireVisibleAgent above: everyone but an owner or a manager of the team reaches
// only the agents working in a project they belong to, and resolveAgentProjects bounds
// where they may put one the same way.
//
// Chatting with an agent stays under :projectKey as well: a chat acts inside one
// project, which is what the permission check is bound to.

// Archive or bring back a run, bounded like the run history: the agent must be visible to
// the reader, and a reader who does not run the team reaches only their projects' runs.
async function archiveRun(
  params: { agentId: number; runId: number },
  membership: TeamMembership,
  archived: boolean,
) {
  await requireVisibleAgent(params.agentId, membership);
  const projectIds = runsTeam(membership.role)
    ? undefined
    : await memberProjectIds(membership.teamId, membership.userId);
  const result = await setAgentRunArchived(params.agentId, params.runId, archived, projectIds);
  if (result === 'not-found') throw new HttpError(404, 'Run not found');
  if (result === 'pending') throw new HttpError(409, 'A pending run cannot be archived');
  return result;
}

export const aiAgentRoutes = new Elysia({ name: 'ai-agents', detail: { tags: ['AI Agents'] } })
  .use(authContext)
  .use(guards)
  .get(
    '/teams/:teamId/ai-agent-trash',
    ({ membership }) => listAgentTrash(membership.teamId, agentScopeOf(membership)),
    {
      params: teamParams,
      teamPermission: ['ai_agents', 'delete'],
      response: {
        200: t.Array(t.Object({ id: t.Number(), name: t.String(), deletedAt: t.String() })),
        ...accessErrors,
      },
      detail: { summary: 'List agents in the trash' },
    },
  )
  .post(
    '/teams/:teamId/ai-agent-trash/:agentId/restore',
    async ({ params, membership }) => {
      if (
        !(await setAgentTrashed(params.agentId, membership.teamId, false, agentScopeOf(membership)))
      )
        throw new HttpError(404, 'Agent not found in trash');
      return noContent();
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'delete'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Restore an agent from the trash' },
    },
  )
  .get(
    '/teams/:teamId/ai-agents',
    async ({ membership, query }) => {
      const visible = await listAgents(
        membership.teamId,
        query.projectId,
        agentScopeOf(membership),
      );
      const agents = query.query ? await matchAgentQuery(visible, query.query) : visible;
      return Promise.all(
        agents.map(async (agent) => ({
          ...agent,
          sizeLimits: await agentSizeLimits(agent.id, membership.teamId),
        })),
      );
    },
    {
      params: teamParams,
      query: agentListQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: AiAgentListResponse, ...accessErrors },
      detail: {
        summary: 'List AI agents',
        description:
          "List the team's AI agents with their config. Pass projectId to list only the agents " +
          'working in that project.',
        ...mcpTool('list_ai_agents'),
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId',
    async ({ params, membership }) => ({
      ...(await requireVisibleAgent(params.agentId, membership)),
      sizeLimits: await agentSizeLimits(params.agentId, membership.teamId),
    }),
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: AiAgentResponse, ...commonErrors },
      detail: {
        summary: 'Get an AI agent',
        description: 'Get an AI agent by id with its config.',
        ...mcpTool('get_ai_agent'),
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/dream',
    async ({ params, membership }) => {
      await requireVisibleAgent(params.agentId, membership);
      await consolidateAgentMemory(params.agentId, new Date(), 'manual');
      return dreamHistory(params.agentId);
    },
    {
      teamOwner: true,
      params: agentParams,
      response: { 200: AgentDreamHistory, ...commonErrors, ...errors(409) },
      detail: { summary: 'Consolidate agent memory now' },
    },
  )
  .get(
    '/teams/:teamId/ai-agents/:agentId/dream',
    async ({ params, membership }) => {
      await requireVisibleAgent(params.agentId, membership);
      return dreamHistory(params.agentId);
    },
    {
      teamOwner: true,
      params: agentParams,
      response: { 200: AgentDreamHistory, ...commonErrors },
      detail: { summary: 'Read agent memory consolidation status and history' },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/context-sizes',
    async ({ params, membership }) => {
      await requireVisibleAgent(params.agentId, membership);
      return agentContextSizeView(params.agentId, membership.teamId);
    },
    {
      detail: {
        summary: 'Get agent context sizes',
        description:
          'Read current sizes, effective limits and truncation details for each context area of a visible agent.',
      },
      params: agentParams,
      teamPermission: ['ai_agents', 'read'],
      response: {
        200: t.Object({
          modelContextTokens: t.Number(),
          areas: t.Array(
            t.Object({
              key: t.String(),
              size: t.Number(),
              limit: t.Number(),
              truncated: t.Boolean(),
              charsBefore: t.Number(),
              charsAfter: t.Number(),
            }),
          ),
        }),
        ...commonErrors,
      },
    },
  )

  // Creates an agent with its first API key, returned once here and never available
  // again (regenerate to get a new one). Its runner drives it with that key.
  .post(
    '/teams/:teamId/ai-agents',
    async ({ membership, body, set, user }) => {
      assertNotHomeHandle(body.username);
      if (body.projectScope === 'all' && !runsTeam(membership.role)) {
        throw new HttpError(403, 'Only a team owner or manager may grant all projects');
      }
      const projectIds = await resolveAgentProjects(
        membership,
        body.projectId != null ? [body.projectId] : body.projectIds,
        [],
      );
      set.status = 201;
      return createAgent(membership.teamId, {
        ...body,
        projectIds,
        ownerUserId: requireUser(user).id,
      });
    },
    {
      params: teamParams,
      body: createAgentBody,
      teamPermission: ['ai_agents', 'create'],
      response: { 201: CreateAgentResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Create an AI agent',
        description:
          'Create an AI agent. Its API key is returned once; the runner that drives the agent ' +
          'authenticates with it.',
        ...mcpTool('create_ai_agent'),
      },
    },
  )

  .post(
    '/teams/:teamId/ai-agents/:agentId/copy',
    async ({ params, membership, body, set, user }) => {
      const template = await requireVisibleAgent(params.agentId, membership);
      await resolveAgentProjects(membership, [body.projectId], []);
      set.status = 201;
      return copyTemplateIntoProject(template, body.projectId, requireUser(user).id);
    },
    {
      params: agentParams,
      body: copyTemplateBody,
      teamPermission: ['ai_agents', 'create'],
      response: { 201: CreateAgentResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Add a specialist from a template',
        description:
          'Copy a template into a project. The copy works in that project only, as a ' +
          "specialist reporting to the project's coordinator, with the template's " +
          'instructions, model, runtime policy, skills and capabilities, and its name and ' +
          "handle suffixed with the project key. The copy's API key is returned once.",
        ...mcpTool('copy_ai_agent_template'),
      },
    },
  )

  // "Pool erweitern" (Auftrag 117): a new template in the pool from a working agent.
  .post(
    '/teams/:teamId/ai-agents/:agentId/save-as-template',
    async ({ params, membership, body, set, user }) => {
      const agentRow = await requireVisibleAgent(params.agentId, membership);
      set.status = 201;
      return saveAgentAsTemplate(agentRow, requireUser(user).id, body.name);
    },
    {
      params: agentParams,
      body: saveAsTemplateBody,
      teamPermission: ['ai_agents', 'create'],
      response: { 201: CreateAgentResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Save an agent as a template',
        description:
          "Add a template to the team's pool with the agent's instructions, model, runtime " +
          'policy, skills, tools, MCP servers, role, Autopilot level and budgets. The agent ' +
          "stays as it is; the template works in no project. The template's API key is " +
          'returned once.',
        ...mcpTool('save_ai_agent_as_template'),
      },
    },
  )

  // "Auf Vorlage zurücksetzen": drops the copy's own edit to one field group and
  // immediately pulls the template's current value for it. A group the agent has not
  // overridden, or an agent that is not a copy, is a no-op (204, nothing to reset).
  .post(
    '/teams/:teamId/ai-agents/:agentId/reset-to-template',
    async ({ params, membership, body }) => {
      await requireVisibleAgent(params.agentId, membership);
      await resetCopyToTemplate(params.agentId, membership.teamId, body.group);
      return getAgentById(params.agentId, membership.teamId);
    },
    {
      params: agentParams,
      body: resetToTemplateBody,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: t.Nullable(AiAgentResponse), ...commonErrors },
      detail: {
        summary: "Reset a template copy's field group to its template",
        description:
          "Drop a copy's own override of one field group (skills, tools, mcpServers, " +
          "approvals, instructions, model, or budgets) and re-apply the template's " +
          'current value for it right away.',
        ...mcpTool('reset_ai_agent_to_template'),
      },
    },
  )

  .patch(
    '/teams/:teamId/ai-agents/:agentId',
    async ({ params, membership, body, user }) => {
      const current = await requireVisibleAgent(params.agentId, membership);
      if (current.agentRole !== 'home') assertNotHomeHandle(body.username);
      if (
        body.projectScope !== undefined &&
        body.projectScope !== current.projectScope &&
        !runsTeam(membership.role)
      ) {
        throw new HttpError(403, 'Only a team owner or manager may change project scope');
      }
      const projectIds = await resolveAgentProjects(membership, body.projectIds, current.projects);
      const agent = await updateAgent(
        params.agentId,
        membership.teamId,
        { ...body, projectIds },
        requireUser(user).id,
      );
      if (!agent) throw new HttpError(404, 'Agent not found');
      return agent;
    },
    {
      body: updateAgentBody,
      params: agentParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: AiAgentResponse, ...commonErrors, ...errors(409) },
      detail: {
        summary: 'Update an AI agent',
        description: "Update an AI agent's name, username, projects, or model config.",
        ...mcpTool('update_ai_agent'),
      },
    },
  )

  // The projects of the team the agent works in. Membership is what lets its key reach
  // a project, so this is both the attach and the detach: the set is replaced.
  .put(
    '/teams/:teamId/ai-agents/:agentId/projects',
    async ({ params, membership, body, user }) => {
      const current = await requireVisibleAgent(params.agentId, membership);
      if (current.projectScope === 'all' && !runsTeam(membership.role)) {
        throw new HttpError(403, 'Only a team owner or manager may change project scope');
      }
      const projectIds = await resolveAgentProjects(membership, body.projectIds, current.projects);
      const agent = await updateAgent(
        params.agentId,
        membership.teamId,
        { projectIds, projectScope: 'selected' },
        requireUser(user).id,
      );
      if (!agent) throw new HttpError(404, 'Agent not found');
      return agent;
    },
    {
      body: setAgentProjectsBody,
      params: agentParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: AiAgentResponse, ...commonErrors },
      detail: {
        summary: "Set an AI agent's projects",
        description:
          'Replace the projects of the team the agent works in. Send the full set: a project ' +
          'left out is detached. A project of another team is rejected, and so is one the ' +
          'caller is not a member of unless they run the team.',
        ...mcpTool('set_ai_agent_projects', undefined, 'credentials'),
      },
    },
  )

  // Rotates the agent's API key (delete + create) and returns the new secret once.
  .post(
    '/teams/:teamId/ai-agents/:agentId/regenerate-key',
    async ({ params, membership }) => {
      const agent = await requireVisibleAgent(params.agentId, membership);
      const apiKey = await regenerateKey(params.agentId, membership.teamId);
      if (apiKey == null) throw new HttpError(404, 'Agent not found');
      // The key of an agent's Hermes runtime no longer works, so the runtime is keyed again.
      await queueAgentRuntime(agent.userId);
      return { apiKey };
    },
    {
      params: agentParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: RegenerateKeyResponse, ...commonErrors },
      detail: {
        summary: 'Regenerate the API key',
        description: "Rotate an agent's API key and return the new secret once.",
        // Rotating invalidates the previous key, which cannot be recovered.
        ...mcpTool('regenerate_ai_agent_key', { destructiveHint: true }, 'credentials'),
      },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/heartbeats',
    async ({ params, membership, query }) => {
      await requireVisibleAgent(params.agentId, membership);
      return listAgentHeartbeats(
        params.agentId,
        runsTeam(membership.role)
          ? undefined
          : await memberProjectIds(membership.teamId, membership.userId),
        query.includeIdle ?? false,
      );
    },
    {
      params: agentParams,
      query: t.Object({ includeIdle: t.Optional(t.Boolean()) }),
      teamPermission: ['ai_agents', 'read'],
      response: {
        200: t.Array(
          t.Object({
            id: t.Number(),
            projectId: t.Nullable(t.Number()),
            checkedAt: t.String(),
            outcome: t.String(),
            reason: t.String(),
            runId: t.Nullable(t.Number()),
          }),
        ),
        ...commonErrors,
      },
      detail: { summary: 'List agent heartbeat checks', ...mcpTool('list_ai_agent_heartbeats') },
    },
  )

  // The agent's run history: the triggered runs (a mention or a delegation) queued for
  // it, newest first, paginated. Chat answers are not recorded here. A run carries
  // the prompt it was given and what it answered, so it is bounded to the projects the
  // reader is a member of — seeing the agent is not seeing what it did everywhere.
  .get(
    '/teams/:teamId/ai-agents/:agentId/runs',
    async ({ params, membership, query }) => {
      await requireVisibleAgent(params.agentId, membership);
      const projectIds = runsTeam(membership.role)
        ? undefined
        : await memberProjectIds(membership.teamId, membership.userId);
      return listAgentRuns(params.agentId, {
        before: query.before,
        limit: query.limit,
        projectIds,
        includeArchived: query.includeArchived,
      });
    },
    {
      params: agentParams,
      query: runsQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: AgentRunPageResponse, ...commonErrors },
      detail: {
        summary: 'List agent runs',
        description:
          "List an agent's triggered runs. An owner or a manager of the team sees them all; " +
          'anyone else only the runs that happened in a project they belong to. Archived runs are left out unless includeArchived is set.',
        ...mcpTool('list_ai_agent_runs'),
      },
    },
  )

  // Runs are never deleted to tidy up: a finished run is archived instead, which takes it
  // out of the run history and the activity feed and keeps it for the statistics.
  .post(
    '/teams/:teamId/ai-agents/:agentId/runs/:runId/archive',
    ({ params, membership }) => archiveRun(params, membership, true),
    {
      params: agentRunParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: AgentRunArchiveResponse, ...commonErrors },
      detail: {
        summary: 'Archive an agent run',
        description:
          'Take a finished run out of the lists without deleting it. A pending run cannot be ' +
          'archived (409).',
        ...mcpTool('archive_ai_agent_run', { destructiveHint: true }),
      },
    },
  )
  .post(
    '/teams/:teamId/ai-agents/:agentId/runs/:runId/unarchive',
    ({ params, membership }) => archiveRun(params, membership, false),
    {
      params: agentRunParams,
      teamPermission: ['ai_agents', 'edit'],
      response: { 200: AgentRunArchiveResponse, ...commonErrors },
      detail: {
        summary: 'Bring back an archived agent run',
        description: 'Show an archived run in the lists again.',
        ...mcpTool('unarchive_ai_agent_run'),
      },
    },
  )

  .delete(
    '/teams/:teamId/ai-agents/:agentId',
    async ({ params, membership, query }) => {
      await requireVisibleAgent(params.agentId, membership, query.permanent === true);
      const scope = agentScopeOf(membership);
      const ok = query.permanent
        ? await permanentlyDeleteTrashedAgent(params.agentId, membership.teamId, scope)
        : await setAgentTrashed(params.agentId, membership.teamId, true, scope);
      if (!ok) throw new HttpError(404, 'Agent not found in trash');
      return noContent();
    },
    {
      params: agentParams,
      query: agentDeleteQuery,
      teamPermission: ['ai_agents', 'delete'],
      response: { 204: t.Void(), ...commonErrors },
      detail: {
        summary: 'Delete an AI agent',
        description:
          'Move an AI agent to the recoverable trash. With permanent, delete an agent already in the trash for good.',
        ...mcpTool('delete_ai_agent', undefined, 'delete', 'external'),
      },
    },
  )

  // Global Home chat history. A fresh installation has no project, so these routes
  // enforce team visibility while keeping each member's transcript private.
  .get(
    '/teams/:teamId/ai-agents/:agentId/threads',
    async ({ params, membership, query, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      return listThreads(caller.id, params.agentId, query);
    },
    {
      params: agentParams,
      query: threadListQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ChatThreadListResponse, ...commonErrors },
      detail: { summary: 'List global Home chat threads' },
    },
  )

  .put(
    '/teams/:teamId/ai-agents/:agentId/threads/:threadId/favorite',
    async ({ params, membership, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      if (!(await ownsThread(params.threadId, caller.id, params.agentId))) {
        throw new HttpError(404, 'Thread not found');
      }
      await addFavorite(caller.id, params.agentId, params.threadId);
      return noContent();
    },
    {
      params: teamThreadParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Star a global Home chat thread' },
    },
  )

  .delete(
    '/teams/:teamId/ai-agents/:agentId/threads/:threadId/favorite',
    async ({ params, membership, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      if (!(await ownsThread(params.threadId, caller.id, params.agentId))) {
        throw new HttpError(404, 'Thread not found');
      }
      await removeFavorite(caller.id, params.threadId);
      return noContent();
    },
    {
      params: teamThreadParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Unstar a global Home chat thread' },
    },
  )

  .get(
    '/teams/:teamId/ai-agents/:agentId/threads/:threadId/messages',
    async ({ params, membership, query, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      const messages = await getThreadMessages(params.threadId, caller.id, query.page);
      if (messages === null) throw new HttpError(404, 'Thread not found');
      return messages;
    },
    {
      params: teamThreadParams,
      query: threadPageQuery,
      teamPermission: ['ai_agents', 'read'],
      response: { 200: ChatMessagesResponse, ...commonErrors },
      detail: { summary: 'Get global Home thread messages' },
    },
  )

  .patch(
    '/teams/:teamId/ai-agents/:agentId/threads/:threadId',
    async ({ params, membership, body, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      const renamed = await renameThread(params.threadId, caller.id, body.title);
      if (!renamed) throw new HttpError(404, 'Thread not found');
      return noContent();
    },
    {
      params: teamThreadParams,
      body: renameThreadBody,
      teamPermission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Rename a global Home chat thread' },
    },
  )

  .delete(
    '/teams/:teamId/ai-agents/:agentId/threads/:threadId',
    async ({ params, membership, user }) => {
      const caller = requireUser(user);
      await requireVisibleAgent(params.agentId, membership);
      const deleted = await deleteThread(params.threadId, caller.id);
      if (!deleted) throw new HttpError(404, 'Thread not found');
      return noContent();
    },
    {
      params: teamThreadParams,
      teamPermission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a global Home chat thread' },
    },
  )

  // The caller's own chat threads with this agent, newest first, a page at a time.
  // Scoped to the caller (the thread's owner), so a user only sees their own
  // conversations. `q` searches them and `favorites` returns the starred ones instead.
  .get(
    '/projects/:projectKey/ai-agents/:agentId/threads',
    async ({ params, project, query, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      return listThreads(caller.id, params.agentId, query);
    },
    {
      params: projectAgentParams,
      query: threadListQuery,
      permission: ['ai_agents', 'read'],
      response: { 200: ChatThreadListResponse, ...commonErrors },
      detail: { summary: 'List chat threads' },
    },
  )

  // Stars one of the caller's conversations, so it stays in the favorites group of the
  // history. Scoped the same way as reading it: a thread that is not the caller's own
  // with this agent is a 404.
  .put(
    '/projects/:projectKey/ai-agents/:agentId/threads/:threadId/favorite',
    async ({ params, project, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      if (!(await ownsThread(params.threadId, caller.id, params.agentId)))
        throw new HttpError(404, 'Thread not found');
      await addFavorite(caller.id, params.agentId, params.threadId);
      return noContent();
    },
    {
      params: threadParams,
      permission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Star a chat thread' },
    },
  )

  .delete(
    '/projects/:projectKey/ai-agents/:agentId/threads/:threadId/favorite',
    async ({ params, project, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      if (!(await ownsThread(params.threadId, caller.id, params.agentId)))
        throw new HttpError(404, 'Thread not found');
      await removeFavorite(caller.id, params.threadId);
      return noContent();
    },
    {
      params: threadParams,
      permission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Unstar a chat thread' },
    },
  )

  // The transcript of one of the caller's chat threads, to restore the conversation
  // in the UI. 404 when the thread does not exist or is not owned by the caller.
  .get(
    '/projects/:projectKey/ai-agents/:agentId/threads/:threadId/messages',
    async ({ params, project, query, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      const messages = await getThreadMessages(params.threadId, caller.id, query.page);
      if (messages === null) throw new HttpError(404, 'Thread not found');
      return messages;
    },
    {
      params: threadParams,
      query: threadPageQuery,
      permission: ['ai_agents', 'read'],
      response: { 200: ChatMessagesResponse, ...commonErrors },
      detail: { summary: 'Get thread messages' },
    },
  )

  // Renames one of the caller's chat threads. Scoped the same way as reading it: a
  // thread owned by another user is a 404.
  .patch(
    '/projects/:projectKey/ai-agents/:agentId/threads/:threadId',
    async ({ params, project, body, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      const renamed = await renameThread(params.threadId, caller.id, body.title);
      if (!renamed) throw new HttpError(404, 'Thread not found');
      return noContent();
    },
    {
      params: threadParams,
      body: renameThreadBody,
      permission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Rename a chat thread' },
    },
  )

  // Deletes one of the caller's chat threads with its messages. Scoped the same way as
  // reading it: a thread owned by another user is a 404.
  .delete(
    '/projects/:projectKey/ai-agents/:agentId/threads/:threadId',
    async ({ params, project, user }) => {
      const caller = requireUser(user);
      if (!(await getAgentInProject(params.agentId, project.id, caller.id))) {
        throw new HttpError(404, 'Agent not found');
      }
      const deleted = await deleteThread(params.threadId, caller.id);
      if (!deleted) throw new HttpError(404, 'Thread not found');
      return noContent();
    },
    {
      params: threadParams,
      permission: ['ai_agents', 'read'],
      response: { 204: t.Void(), ...commonErrors },
      detail: { summary: 'Delete a chat thread' },
    },
  );
