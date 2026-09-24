import type { McpServer } from '@/lib/api/endpoints/agentMcpServers';

// The instance-seeded library rows every team gets once its owner runs the setup script
// (ensureBuiltinMcpServers, apps/api/src/modules/agents/mcp-servers/service.ts) — they may
// not exist yet for a team that has not been set up. A row's `name` is the lowercase
// technical slug Hermes uses for the server (also its toolset name), not a label a team
// owner should read as one, so the UI shows a translated title and description instead
// (teams.mcpServers.builtin.<slug> in the message files) wherever the raw name would
// otherwise be shown. `builtin` rows cannot be edited or deleted (the API answers 403).
export const BUILTIN_MCP_SERVER_SLUGS = ['projekt-browser', 'hermes-browser-legacy'] as const;

export type BuiltinMcpServerSlug = (typeof BUILTIN_MCP_SERVER_SLUGS)[number];

// The slug to translate a builtin row's title/description with, or null for a custom row
// or a builtin row whose name this UI does not recognize (shown with its raw name/description
// as a fallback; its edit/delete affordances stay hidden either way).
export function builtinMcpServerSlug(
  server: Pick<McpServer, 'name' | 'builtin'>,
): BuiltinMcpServerSlug | null {
  if (!server.builtin) return null;
  return (BUILTIN_MCP_SERVER_SLUGS as readonly string[]).includes(server.name)
    ? (server.name as BuiltinMcpServerSlug)
    : null;
}
