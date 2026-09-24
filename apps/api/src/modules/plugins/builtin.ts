import {
  ACTION_CATEGORIES,
  type AgentTool,
  type HelenaPlugin,
  type PluginManifest,
} from '@helena/sdk';
import {
  KNOWLEDGE_PLUGIN_MANIFEST,
  knowledgePlugin,
  useKnowledgeRegistries,
} from '@helena/knowledge';
import { INTEGRATIONS_PLUGIN_ID, builtinConnectors } from '@repo/agent-tools';
import { webhooksManifest, webhooksPlugin } from '@repo/db/plugins';
import { host } from '#shared/helena';
import { dispatchTool } from '#mcp/dispatch';
import { routeTools, type McpRouteTool } from '#mcp/generate';
import type { McpApp } from '#mcp/types';
import { loadRepositoryBundles } from '#modules/template-bundles/service';
import { SPOOL_SOURCE_ID, spoolLimitSource } from '#modules/provider-limits/spool';
import { LOGIN_STATUS_SOURCE_ID, loginStatusSource } from '#modules/runtime-logins/spool';
import { AUTOPILOT_EVALUATOR_ID, autopilotPolicyEvaluator } from '#modules/autopilot/evaluator';
import {
  BUILTIN_UPDATE_SOURCES,
  UPDATES_PLUGIN_ID,
  updatesPlugin,
} from '#modules/updates/sources/index';
import {
  BROWSER_TASK_PLUGIN_ID,
  BUILTIN_DECISION_BACKENDS,
  browserTaskPlugin,
} from '#modules/browser-task/backends';
import {
  BUILTIN_DECISION_CLASSES,
  DECISIONS_BACKENDS,
  DECISIONS_PLUGIN_ID,
  decisionsPlugin,
} from '#modules/decisions/classes';

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

// Whether the model logins agents share are usable (docs/helena-decisions/token-keeper.md):
// the status the token keeper writes next to the agents' views of them.
export const LOGINS_PLUGIN_ID = 'helena.logins';

const logins: HelenaPlugin = {
  register(ctx) {
    ctx.runtimeLoginSources.register(loginStatusSource());
  },
};

// Helena's Autopilot (docs/helena-decisions/policy-engine.md) as the policy evaluator every
// tool call, connector service and workflow step the framework routes is asked through.
export const AUTOPILOT_PLUGIN_ID = 'helena.autopilot';

const autopilot: HelenaPlugin = {
  register(ctx) {
    ctx.policies.register(autopilotPolicyEvaluator);
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
    autopilot,
    builtinManifest(AUTOPILOT_PLUGIN_ID, 'autopilot', {
      provides: { policies: [AUTOPILOT_EVALUATOR_ID] },
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
  await host.load(
    logins,
    builtinManifest(LOGINS_PLUGIN_ID, 'logins', {
      provides: { runtimeLoginSources: [LOGIN_STATUS_SOURCE_ID] },
    }),
  );
  // The update center (docs/helena-decisions/update-center.md): what Helena runs on and
  // whether a newer version exists.
  await host.load(
    updatesPlugin,
    builtinManifest(UPDATES_PLUGIN_ID, 'updates', {
      provides: { updateSources: BUILTIN_UPDATE_SOURCES.map((source) => source.id) },
      permissions: {
        network: [...new Set(BUILTIN_UPDATE_SOURCES.flatMap((source) => source.hosts ?? []))],
      },
    }),
  );
  // The decision backends of the browser's fast path (docs/helena-decisions/browser-task.md).
  await host.load(
    browserTaskPlugin,
    builtinManifest(BROWSER_TASK_PLUGIN_ID, 'browserTask', {
      provides: { decisionBackends: BUILTIN_DECISION_BACKENDS.map((backend) => backend.id) },
    }),
  );
  // Typed decisions (docs/helena-decisions/decisions.md): the classes Helena's own features ask
  // and the local logit and JSON backends.
  await host.load(
    decisionsPlugin,
    builtinManifest(DECISIONS_PLUGIN_ID, 'decisions', {
      provides: {
        decisionBackends: DECISIONS_BACKENDS.map((backend) => backend.id),
        decisionClasses: BUILTIN_DECISION_CLASSES.map((entry) => entry.id),
      },
    }),
  );
  // The second brain: Helena's knowledge sources and capture targets live in the host's
  // registries, beside those of plugins (@helena/knowledge).
  useKnowledgeRegistries({
    sources: host.knowledgeSources,
    captureTargets: host.captureTargets,
  });
  await host.load(knowledgePlugin, KNOWLEDGE_PLUGIN_MANIFEST);
  await loadRepositoryBundles();
  for (const plugin of host.list()) {
    if (plugin.status !== 'loaded') {
      console.error(`[plugins] built-in ${plugin.manifest.id} failed: ${plugin.error}`);
    }
  }
}
