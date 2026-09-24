// An agent tool as Helena's framework registers it (docs/volition-helena-oss.md §3a,
// "Agenten-Werkzeuge": a tool with a description, an input schema and an action category).
// Kept to the shape the coming @helena/sdk describes, so the browser gateway's tools move
// there as they are once it lands (hub/framework); until then this is the one place the
// gateway defines what a tool is.

// What a call does to the world, which the policy engine (hub/autopilot:
// decide(agent, project, actionCategory, context)) decides on.
export const ACTION_CATEGORIES = [
  'read',
  'write',
  'send',
  'publish',
  'delete',
  'pay',
  'execute',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export interface AgentToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // The category of a call, before the gateway looks at what the call actually does: a
  // click is 'write', but a click that submits a form is 'send' (see categoryOf in server.ts).
  category: ActionCategory;
}

// The MCP tool annotations a category implies, so an MCP client that knows nothing of Helena
// still shows a read-only tool as one; `_meta` carries the category itself.
export function mcpToolOf(tool: AgentToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      readOnlyHint: tool.category === 'read',
      destructiveHint: tool.category === 'delete' || tool.category === 'pay',
      openWorldHint: tool.category !== 'read',
    },
    _meta: { 'helena/actionCategory': tool.category },
  };
}
