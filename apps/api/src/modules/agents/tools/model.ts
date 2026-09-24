import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

export { agentParams } from '../model';

export const toolParams = t.Object({
  teamId: t.Numeric(),
  agentToolId: t.Numeric({ description: 'Configured tool id from list_configured_tools.' }),
});

// The tool catalog itself is served by the integrations catalog (kind 'tool').
export const AgentToolResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  toolKey: t.String(),
  credentialId: t.Number(),
  integrationKey: t.String(),
  credentialLabel: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const AgentToolListResponse = t.Array(AgentToolResponse);

export const AgentToolPageResponse = pageResponse(AgentToolResponse);

export const agentToolListQuery = t.Object(pageQueryFields);

export const createAgentToolBody = t.Object({
  toolKey: t.String({ minLength: 1 }),
  credentialId: t.Number(),
});

export const setAgentToolsBody = t.Object({
  agentToolIds: t.Array(t.Number(), {
    description: 'Configured tool ids from list_configured_tools.',
  }),
});
