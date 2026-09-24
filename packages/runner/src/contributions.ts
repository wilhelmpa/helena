import { createRegistry } from '@helena/sdk';
import { browserGateway } from './browser-gateway';
import { learningConfig } from './learning';
import type { RuntimeMcpServer, RuntimeMcpValue } from './policy';
import type { McpNamedValue, McpServerSpec } from './runtime';

// What goes into an agent's runtime profile besides its instructions and skills, collected
// from contributions. The built-in ones below are Helena's own MCP server, the project's
// browser for Hermes, the team library's servers and the learning settings; another package
// adds its own by registering one (the browser gateway its "Projekt-Browser" server, the
// Hermes panel its fallback models), and every runtime adapter picks it up the same way.

// The contribution contract lives in @helena/sdk (runtime-policy.ts); a runner plugin
// registers one through ctx.profileContributions.
export type { ProfileContext, ProfileContribution } from '@helena/sdk';
import type { ProfileContext, ProfileContribution } from '@helena/sdk';

// Helena's own MCP server: the tools of the app itself (tasks, comments, approvals). Every
// agent has it; the name is the one Hermes' tool names and the skills already use.
export const HELENA_MCP_SERVER = 'itsaplan';
// The header that names the run on each of the agent's requests to Helena's MCP server.
export const RUN_HEADER = 'x-helena-run';
// Chrome DevTools into the project's browser, until the browser gateway replaces it.
export const LEGACY_BROWSER_MCP_SERVER = 'browser-harness';

// Written by the runner itself, not taken from the team's library.
export const RUNTIME_MCP_SERVERS = [HELENA_MCP_SERVER, LEGACY_BROWSER_MCP_SERVER];

const MCP_SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// The variable a library secret reaches the runtime in. Hermes and Claude Code expand
// ${NAME} with their own environment; the runner sets it before each run.
export function mcpSecretVariable(id: number): string {
  return `ITSAPLAN_MCP_SECRET_${id}`;
}

function libraryValues(values: RuntimeMcpValue[]): McpNamedValue[] {
  return values.map((entry) =>
    'secret' in entry
      ? { name: entry.name, value: { env: mcpSecretVariable(entry.secret) } }
      : { name: entry.name, value: { literal: entry.value } },
  );
}

export function librarySpec(server: RuntimeMcpServer): McpServerSpec {
  return server.transport === 'stdio'
    ? {
        name: server.name,
        transport: 'stdio',
        command: server.command ?? '',
        args: server.args,
        env: libraryValues(server.env),
      }
    : {
        name: server.name,
        transport: server.transport,
        url: server.url ?? '',
        headers: libraryValues(server.headers),
      };
}

const helenaMcp: ProfileContribution = {
  id: 'helena-mcp',
  mcpServers: ({ url }) =>
    url
      ? [
          {
            name: HELENA_MCP_SERVER,
            transport: 'http',
            url: `${url}/mcp`,
            headers: [
              { name: 'Authorization', value: { template: 'Bearer ${ITSAPLAN_API_KEY}' } },
              // The run the request belongs to (agent_run.id; empty in a chat), which the API
              // records as the provenance of what the agent writes (vault entries, commits).
              { name: RUN_HEADER, value: { env: 'ITSAPLAN_RUN_ID' } },
            ],
            // An Authorization header must not follow a redirect to another origin.
            hermes: {
              strict_redirect_headers: true,
              lazy: true,
              connect_timeout: 15,
              timeout: 120,
            },
          },
        ]
      : [],
};

// Hermes' browser-harness server, pointed at the Chromium of the agent's own project (the
// runner config names its DevTools address as BROWSER_CDP_URL). Without that address, or
// without the harness installed, the agent has no such server.
const legacyBrowser: ProfileContribution = {
  id: 'legacy-browser',
  mcpServers: ({ runtime, env, hermes }) => {
    const cdp = env.BROWSER_CDP_URL?.trim();
    const command = hermes?.browserHarness?.trim();
    if (runtime !== 'hermes' || !cdp || !command) return [];
    return [
      {
        name: LEGACY_BROWSER_MCP_SERVER,
        transport: 'stdio',
        command,
        args: [],
        env: [{ name: 'BU_CDP_URL', value: { literal: cdp } }],
        hermes: { connect_timeout: 20 },
      },
    ];
  },
};

const library: ProfileContribution = {
  id: 'library',
  mcpServers: (context) => {
    const claimed = new Set(
      profileContributions().flatMap((contribution) => contribution.claims?.(context) ?? []),
    );
    return (context.snapshot.mcpServers ?? [])
      .filter((server) => !claimed.has(server.name))
      .map(librarySpec);
  },
};

const learning: ProfileContribution = {
  id: 'learning',
  hermesConfig: ({ snapshot }) => learningConfig(snapshot.learning),
};

// The contributions, as an @helena/sdk registry: the built-ins above and the browser
// gateway's (browser-gateway.ts) as the internal plugin helena.runtimes, and those of runner
// plugins (plugins.ts), in this order.
export const profileContributionRegistry =
  createRegistry<ProfileContribution>('profile contribution');
for (const contribution of [helenaMcp, legacyBrowser, browserGateway, library, learning]) {
  profileContributionRegistry.register(contribution, 'helena.runtimes');
}

// Adds a contribution, or replaces the one with the same id.
export function registerProfileContribution(contribution: ProfileContribution): void {
  profileContributionRegistry.replace(contribution);
}

export function unregisterProfileContribution(id: string): void {
  profileContributionRegistry.remove(id);
}

export function profileContributions(): readonly ProfileContribution[] {
  return profileContributionRegistry.list();
}

export interface CollectedProfile {
  // Every server Helena gives the agent, in contribution order.
  mcpServers: McpServerSpec[];
  // The servers that come from the runner itself rather than the team's library, which
  // the owner turns off per agent like a toolset.
  runtimeServers: string[];
  // Servers that must be off.
  suppressed: string[];
  // Toolsets that must be off.
  deniedToolsets: string[];
  hermesConfig: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Hermes' own merge: nested objects key by key, anything else replaced.
export function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    merged[key] = isObject(value) && isObject(merged[key]) ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

// A server may not take the name of a toolset: Hermes names a server's toolset after it. A
// library server may not take the name of a server of the runtime's own configuration
// either, which Hermes would merge into it; the runner's own servers replace those.
export function collectProfile(context: ProfileContext): CollectedProfile {
  const mcpServers: McpServerSpec[] = [];
  const runtimeServers: string[] = [];
  const suppressed = new Set<string>();
  const deniedToolsets = new Set<string>();
  let hermesConfig: Record<string, unknown> = {};
  const toolsets = new Set(context.hermes?.toolsets ?? []);
  const shared = new Set([...(context.hermes?.mcpServers ?? []), ...RUNTIME_MCP_SERVERS]);
  for (const contribution of profileContributions()) {
    const own = contribution.id !== 'library';
    for (const spec of contribution.mcpServers?.(context) ?? []) {
      if (!MCP_SERVER_NAME.test(spec.name)) {
        throw new Error('runtime policy contains an invalid MCP server name');
      }
      if (toolsets.has(spec.name) || (!own && shared.has(spec.name))) {
        throw new Error(`MCP server ${spec.name} has the name of a Hermes toolset or server`);
      }
      if (mcpServers.some((s) => s.name === spec.name)) {
        throw new Error('runtime policy contains an invalid MCP server name');
      }
      if (own && RUNTIME_MCP_SERVERS.includes(spec.name)) runtimeServers.push(spec.name);
      mcpServers.push(spec);
    }
    for (const name of contribution.suppress?.(context) ?? []) suppressed.add(name);
    for (const name of contribution.denyToolsets?.(context) ?? []) deniedToolsets.add(name);
    const config = contribution.hermesConfig?.(context);
    if (config) hermesConfig = deepMerge(hermesConfig, config);
  }
  return {
    mcpServers,
    runtimeServers,
    suppressed: [...suppressed],
    deniedToolsets: [...deniedToolsets],
    hermesConfig,
  };
}
