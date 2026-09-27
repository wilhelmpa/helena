import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  ACTION_META_KEY,
  SchemaError,
  consoleLogger,
  toCallToolResult,
  toMcpTool,
  toolCategory,
  validate,
  type AgentRef,
  type AnyAgentTool,
  type ProjectRef,
} from '@helena/sdk';
import { aiAgent, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { agentTeam } from '#modules/agents/core/service';
import { getProjectByKey } from '#modules/projects/service';
import { listTeams } from '#modules/teams/service';
import { host, registries } from '#shared/helena';
import type { McpApp } from './types';
import { routeTools, toolTitle, withoutFields, type McpRouteTool } from './generate';
import { dispatchTool } from './dispatch';
import { SERVER_INSTRUCTIONS } from './instructions';
import type { McpCredential } from './credential';
import { toolError } from './result';
import { visibleConnectors } from '#modules/connectors/tools';
import { callConfiguredTool, configuredToolsOf } from '#modules/agents/tools/run';
import { SERVER_INFO } from './info';

// The path param of every team-scoped route.
const TEAM_PARAM = 'teamId';

// The team the caller's tool calls act in, or null when they have to name one.
//
// A client knows projects, not teams, so the team is resolved from the key rather
// than asked for: an agent key acts in the team its agent belongs to, and a person
// with a single team acts in that one. A person in several teams names the team on
// each call. It is never resolved from projectKey — an agent has to be creatable in
// a team that holds no project.
async function callerTeam(userId: string): Promise<number | null> {
  const ofAgent = await agentTeam(userId);
  if (ofAgent !== null) return ofAgent;
  const teams = await listTeams(userId, { mcpOnly: true });
  return teams.length === 1 ? teams[0].id : null;
}

// The tools the endpoint serves: every tool of the registry (@helena/sdk) that runs
// without a connector credential — Helena's own routes (the internal plugin helena.mcp)
// and the tools of plugins. A connector's tool needs the credential an agent's configured
// tool is bound to, so it is only reached that way.
function servedTools(): AnyAgentTool[] {
  return registries.tools.list().filter((tool) => !tool.connector);
}

async function callerAgent(userId: string): Promise<AgentRef | null> {
  const [row] = await db
    .select({ id: aiAgent.id, name: aiAgent.username, templateId: aiAgent.sourceTemplateId })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  return row ? { id: row.id, userId, name: row.name, templateId: row.templateId } : null;
}

async function callProject(args: Record<string, unknown>): Promise<ProjectRef | null> {
  const key = typeof args.projectKey === 'string' ? args.projectKey : null;
  if (!key) return null;
  const project = await getProjectByKey(key);
  return project ? { id: project.id, key: project.key, teamId: project.teamId } : null;
}

function refusal(status: number, text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
    structuredContent: toolError(status, text),
  };
}

// A low-level MCP Server for one request. tools/list returns the registry's tools;
// tools/call asks the policy (@helena/sdk decide) and then runs the tool: a route tool
// through app.handle with the caller's API key, a plugin's tool through its handler. The
// low-level Server (not McpServer) is used so a route's TypeBox JSON Schema can be served
// as the tool inputSchema without converting to Zod. A route validates its own arguments.
export async function buildMcpServer(
  app: McpApp,
  credential: McpCredential,
  userId: string,
  // The run an agent's runtime names on its requests (x-helena-run), for the policy log.
  context: { runId?: number | null; agentProject?: string | null } = {},
): Promise<Server> {
  const server = new Server(
    // `name` is the stable programmatic identifier; `title` is the human-readable
    // display name a client shows to the user (per the MCP Implementation spec).
    SERVER_INFO,
    // `instructions` reaches the client in the initialize response and covers what
    // no single tool description can: which tool resolves ids, how a column is
    // picked, how far a request to "work on an issue" goes.
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const routes = new Map(routeTools(app).map((route) => [route.name, route]));
  const teamId = await callerTeam(userId);
  const needsTeam = (route: McpRouteTool) => route.pathParams.includes(TEAM_PARAM);
  // The access center's connector tools (routes that act with a Google account …) are
  // listed only to an agent that holds a grant on one of the connector's accounts; the
  // route refuses a call without one either way.
  const granted = [...routes.values()].some((route) => route.connector)
    ? await visibleConnectors(userId)
    : new Set<string>();
  const listed = () =>
    servedTools().filter((tool) => {
      const connector = routes.get(tool.name)?.connector;
      return !connector || granted.has(connector);
    });
  // A connector's tool the owner bound to a credential and enabled on this agent (a
  // configured tool, agents/tools/run.ts): listed and run with that credential.
  const configured = await configuredToolsOf(userId);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...listed(), ...[...configured.values()].map((entry) => entry.tool)].map((tool) => {
      const route = routes.get(tool.name);
      // A plugin's tool without a title of its own gets its name spelled out, like a route.
      if (!route) return { title: toolTitle(tool.name), ...toMcpTool(tool) };
      return {
        name: route.name,
        title: route.title,
        description: route.description,
        // A caller whose team is already known does not get to name one.
        inputSchema:
          teamId !== null && needsTeam(route)
            ? withoutFields(route.inputSchema, [TEAM_PARAM])
            : route.inputSchema,
        annotations: route.annotations,
        outputSchema: route.outputSchema,
        _meta: { [ACTION_META_KEY]: route.category },
      };
    }),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const bound = configured.get(req.params.name);
    if (bound) {
      return callConfiguredTool(
        bound,
        { ...(req.params.arguments ?? {}) },
        {
          userId,
          auth: credential,
          runId: context.runId ?? null,
          agentProject: context.agentProject,
        },
      );
    }
    const tool = registries.tools.get(req.params.name);
    if (!tool || tool.connector) return refusal(404, `Unknown tool: ${req.params.name}`);
    const args = { ...(req.params.arguments ?? {}) };

    // Only asked when a policy is registered: without one every action is allowed, as
    // before policies existed, and a call costs no extra lookups.
    if (registries.policies.list().length > 0) {
      const decision = await host.decide({
        agent: await callerAgent(userId),
        project: await callProject(args),
        action: toolCategory(tool, args),
        context: {
          tool: tool.name,
          input: args,
          runId: context.runId ?? null,
          // Helena's own routes act on the project's data, inside the agent's workspace,
          // unless the route says it reaches further (mcpTool's scope).
          scope: routes.has(tool.name) ? (routes.get(tool.name)?.scope ?? 'workspace') : undefined,
        },
      });
      if (decision.effect === 'deny') return refusal(403, `Not allowed: ${decision.reason}`);
      if (decision.effect === 'needs-approval') {
        return refusal(
          403,
          `This needs approval: ${decision.reason}. Call request_approval with what you want to ` +
            'do and wait for the decision before you try again.',
        );
      }
    }

    const route = routes.get(tool.name);
    if (route) {
      if (needsTeam(route)) {
        if (teamId !== null) args[TEAM_PARAM] = teamId;
        else if (args[TEAM_PARAM] == null) {
          return refusal(
            400,
            'teamId is required: no single team follows from your key. Call list_teams and ' +
              'pass the id of the team to act in.',
          );
        }
      }
      const { text, isError, structuredContent } = await dispatchTool(
        app,
        route,
        args,
        credential,
        { viaMcpEndpoint: true, agentProject: context.agentProject },
      );
      return { content: [{ type: 'text', text }], isError, structuredContent };
    }

    // A plugin's tool: validated against its schema, then run with the caller.
    try {
      const input = await validate(tool.inputSchema, args);
      const result = await tool.handler(input, {
        agent: await callerAgent(userId),
        project: await callProject(args),
        caller: { userId, auth: credential },
        log: consoleLogger(`tool ${tool.name}`),
      });
      return toCallToolResult(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return refusal(error instanceof SchemaError ? 400 : 500, message);
    }
  });

  return server;
}
