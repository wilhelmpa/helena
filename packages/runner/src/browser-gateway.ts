import type { ProfileContribution } from './contributions';
import type { RuntimePolicySnapshot } from './policy';

// The browser gateway as a profile contribution (contributions.ts): every runtime reaches it
// the same way, through its "Projekt-Browser" MCP server. packages/runner is published on its
// own and cannot import apps/api, so these are duplicated from
// apps/api/src/modules/agents/mcp-servers/service.ts; keep them in sync by hand.
// "hermes-browser-legacy" carries no command anyone runs: it is a marker whose only meaning is
// "this agent keeps Hermes' own, pre-gateway browsers" (the `browser` toolset and the
// `browser-harness` server).
export const BROWSER_GATEWAY_MCP_SERVER_NAME = 'projekt-browser';
export const BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME = 'hermes-browser-legacy';
export const BROWSER_GATEWAY_SHIM_PATH = '/usr/local/libexec/helena-browser-mcp';
// What the shim needs from the agent's environment: its key, the run or chat answer it works
// on (the gateway files a login's use and a handover card under it), and, without isolation
// only, the socket of its project's browser.
export const BROWSER_GATEWAY_ENV = [
  'ITSAPLAN_API_KEY',
  'ITSAPLAN_RUN_ID',
  'ITSAPLAN_MESSAGE_ID',
  'BROWSER_GATEWAY_SOCKET',
] as const;
// browser_handover waits up to 30 minutes for the owner, browser_acquire up to 10.
export const BROWSER_GATEWAY_TOOL_TIMEOUT_SEC = 1900;
// The browsers an agent on the gateway no longer gets (docs/volition-design-browser-perfekt.md
// §3.4): Hermes' own `browser` toolset (a headless browser nobody sees) and the
// `browser-harness` server (CDP straight into a project browser, without lock, login flow or
// audit).
export const REPLACED_BROWSER_TOOLSETS = ['browser'];
export const REPLACED_BROWSER_SERVERS = ['browser-harness'];

// Whether the gateway is this agent's browser: it has the gateway's server without the explicit
// "Hermes-eigener Browser (alt)" fallback.
export function usesBrowserGateway(ownMcpServers: string[]): boolean {
  return (
    ownMcpServers.includes(BROWSER_GATEWAY_MCP_SERVER_NAME) &&
    !ownMcpServers.includes(BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME)
  );
}

function libraryNames(snapshot: RuntimePolicySnapshot): string[] {
  return (snapshot.mcpServers ?? []).map(({ name }) => name);
}

export const browserGateway: ProfileContribution = {
  id: 'browser-gateway',
  // The shim always runs from its installed path, whatever the library row says, and the
  // legacy marker is never a server of its own.
  claims: () => [BROWSER_GATEWAY_MCP_SERVER_NAME, BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME],
  mcpServers: ({ snapshot }) =>
    libraryNames(snapshot).includes(BROWSER_GATEWAY_MCP_SERVER_NAME)
      ? [
          {
            name: BROWSER_GATEWAY_MCP_SERVER_NAME,
            transport: 'stdio',
            command: BROWSER_GATEWAY_SHIM_PATH,
            args: [],
            passEnv: [...BROWSER_GATEWAY_ENV],
            toolTimeoutSec: BROWSER_GATEWAY_TOOL_TIMEOUT_SEC,
            // Nobody is there to approve a tool call; the gateway itself decides.
            codex: { default_tools_approval_mode: '"approve"' },
          },
        ]
      : [],
  suppress: ({ snapshot }) =>
    usesBrowserGateway(libraryNames(snapshot)) ? REPLACED_BROWSER_SERVERS : [],
  denyToolsets: ({ snapshot }) =>
    usesBrowserGateway(libraryNames(snapshot)) ? REPLACED_BROWSER_TOOLSETS : [],
};
