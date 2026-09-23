import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { guards } from '#shared/guards';
import { requireUser } from '#shared/access';
import { accessErrors, commonErrors } from '#shared/responses';
import {
  AgentNetworkEventPageResponse,
  AgentNetworkSettingsResponse,
  agentNetworkEventsQuery,
  updateAgentNetworkBody,
} from './model';
import { getAgentNetworkView, listAgentNetworkEvents, setAgentNetwork } from './service';

// The network access of a project's isolated agents: which hosts the egress proxy lets
// them reach, and what it let through or refused.
export const agentNetworkRoutes = new Elysia({
  name: 'agent-network',
  detail: { tags: ['AI Agents'] },
})
  .use(authContext)
  .use(guards)
  .get(
    '/projects/:projectKey/settings/agent-network',
    ({ project }) => getAgentNetworkView(project.id),
    {
      permission: ['ai_agents', 'read'],
      response: { 200: AgentNetworkSettingsResponse, ...accessErrors },
      detail: {
        summary: "Get the network access of a project's agents",
        description:
          'The hosts the egress proxy lets the isolated agents of the project reach: every public ' +
          'host but the denied ones (`open`), only the allowed ones (`allowlist`), or none ' +
          '(`blocked`), and the agents with a mode of their own. Private and local addresses ' +
          'are never reachable, whatever this says.',
      },
    },
  )
  .put(
    '/projects/:projectKey/settings/agent-network',
    ({ project, user, body }) => setAgentNetwork(project.id, requireUser(user).id, body),
    {
      permission: ['ai_agents', 'edit'],
      body: updateAgentNetworkBody,
      response: { 200: AgentNetworkSettingsResponse, ...commonErrors },
      detail: {
        summary: "Update the network access of a project's agents",
        description:
          'Change the mode, the allowed and the denied domains (a domain covers its subdomains), ' +
          'whether the mail ports are open, and the modes of single agents (null follows the ' +
          'project). Agent keys are refused.',
      },
    },
  )
  .get(
    '/projects/:projectKey/agent-network/events',
    ({ project, query }) => listAgentNetworkEvents(project.id, query),
    {
      permission: ['ai_agents', 'read'],
      query: agentNetworkEventsQuery,
      response: { 200: AgentNetworkEventPageResponse, ...accessErrors },
      detail: {
        summary: "List the network connections of a project's agents",
        description:
          'Newest first: the hosts the isolated agents connected to or were refused, with the ' +
          'number of connections and bytes. Never what was sent.',
      },
    },
  );
