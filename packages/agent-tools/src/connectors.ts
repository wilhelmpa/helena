import type { AgentTool, Connector, ToolCallContext } from '@helena/sdk';
import { TOOL_CATEGORIES } from './categories';
import { INTEGRATIONS } from './registry';
import type { CustomToolEntry, Integration } from './types';

// The integrations as @helena/sdk connectors: each one's credential form, and its tools as
// agent tools with an action category, running with the connector's credential. The API
// registers them as the internal plugin `helena.integrations`, next to the connectors of
// external plugins.

export const INTEGRATIONS_PLUGIN_ID = 'helena.integrations';

function agentTool(integration: Integration, entry: CustomToolEntry): AgentTool<unknown> {
  const category = TOOL_CATEGORIES[entry.key];
  if (!category) throw new Error(`Tool ${entry.key} has no action category (categories.ts)`);
  return {
    name: entry.key,
    title: entry.label,
    description: entry.description,
    inputSchema: entry.inputSchema,
    category,
    connector: integration.key,
    scopes: entry.scopes,
    handler: (input: unknown, ctx: ToolCallContext) =>
      entry.execute(ctx.credential ?? {}, (input ?? {}) as Record<string, unknown>),
  };
}

export function integrationConnector(integration: Integration): Connector {
  return {
    id: integration.key,
    label: integration.label,
    credentialSchema: integration.credentialSchema,
    auth: { kind: 'fields' },
    tools: integration.tools.map((entry) => agentTool(integration, entry)),
  };
}

export function builtinConnectors(): Connector[] {
  return INTEGRATIONS.map(integrationConnector);
}
