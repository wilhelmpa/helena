import {
  ACTION_CATEGORIES,
  type AgentTool,
  type HelenaPlugin,
  type PluginManifest,
} from '@helena/sdk';
import { INTEGRATIONS_PLUGIN_ID, builtinConnectors } from '@repo/agent-tools';
import { webhooksManifest, webhooksPlugin } from '@repo/db/plugins';
import { host } from '#shared/helena';
import { dispatchTool } from '#mcp/dispatch';
import { routeTools, type McpRouteTool } from '#mcp/generate';
import type { McpApp } from '#mcp/types';
import { loadRepositoryBundles } from '#modules/template-bundles/service';
import { SPOOL_SOURCE_ID, spoolLimitSource } from '#modules/provider-limits/spool';

// Helena's own features as internal plugins: they register through the same host and
// the same manifest checks as an external plugin (docs/helena-framework.md, §3a
// "dogfooding"). Loaded once, when the app is assembled (app.ts).

// A built-in's name is a key of Helena's own translations (god.plugins.names.<name>).
function builtinManifest(
  id: string,
  name: string,
  manifest: Partial<PluginManifest>,
): PluginManifest {
  return {
    id,
    name: { i18n: `god.plugins.names.${name}` },
    version: '1.0.0',
    sdk: '^0.1.0',
    provides: {},
    ...manifest,
  };
}

// The tool integrations (@repo/agent-tools) as connectors whose tools run with the
// team credential an agent's configured tool is bound to.
const integrations: HelenaPlugin = {
  register(ctx) {
    for (const connector of builtinConnectors()) ctx.connectors.register(connector);
  },
};

// Helena's own API as MCP tools: every route tagged with mcpTool() (mcp/generate.ts).
// A call is an in-process request against the route with the caller's credential, so
// the route's validation and permission checks apply exactly as over HTTP.
export const MCP_ROUTES_PLUGIN_ID = 'helena.mcp';

function routeTool(app: McpApp, route: McpRouteTool): AgentTool<Record<string, unknown>> {
  return {
    name: route.name,
    description: route.description,
    inputSchema: route.inputSchema as unknown as Record<string, unknown>,
    outputSchema: route.outputSchema as unknown as Record<string, unknown>,
    annotations: route.annotations,
    category: route.category,
    async handler(input, ctx) {
      if (!ctx.caller) throw new Error(`${route.name} acts as its caller and needs one`);
      const result = await dispatchTool(app, route, input, ctx.caller.auth, {
        viaMcpEndpoint: false,
      });
      return {
        content: [{ type: 'text', text: result.text }],
        isError: result.isError,
        structuredContent: result.structuredContent as unknown as Record<string, unknown>,
      };
    },
  };
}

function routeToolsPlugin(app: McpApp): HelenaPlugin {
  return {
    register(ctx) {
      for (const route of routeTools(app)) {
        ctx.tools.register(routeTool(app, route) as AgentTool<unknown>);
      }
    },
  };
}

// The API-side usage-limit sources (docs/helena-decisions/provider-limits.md): the spool the
// owner reporter writes the owner's own Claude Code and Codex limits into.
export const LIMITS_PLUGIN_ID = 'helena.limits';

const limits: HelenaPlugin = {
  register(ctx) {
    ctx.usageLimitSources.register(spoolLimitSource());
  },
};

let loaded = false;

export async function loadBuiltinPlugins(app: McpApp): Promise<void> {
  if (loaded) return;
  loaded = true;
  const all = [...ACTION_CATEGORIES];
  await host.load(
    integrations,
    builtinManifest(INTEGRATIONS_PLUGIN_ID, 'integrations', {
      provides: { connectors: ['*'], tools: ['*'] },
      permissions: { actions: all, credentials: true },
    }),
  );
  await host.load(
    routeToolsPlugin(app),
    builtinManifest(MCP_ROUTES_PLUGIN_ID, 'mcp', {
      provides: { tools: ['*'] },
      permissions: { actions: all },
    }),
  );
  // Outgoing webhooks consume issue and comment events; in process until the workflow
  // engine provides the event transport, then in the worker.
  await host.load(webhooksPlugin, webhooksManifest);
  await host.load(
    limits,
    builtinManifest(LIMITS_PLUGIN_ID, 'limits', {
      provides: { usageLimitSources: [SPOOL_SOURCE_ID] },
    }),
  );
  await loadRepositoryBundles();
  for (const plugin of host.list()) {
    if (plugin.status !== 'loaded') {
      console.error(`[plugins] built-in ${plugin.manifest.id} failed: ${plugin.error}`);
    }
  }
}
