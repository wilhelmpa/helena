// An agent tool as Helena's framework registers it (docs/volition-helena-oss.md §3a,
// "Agenten-Werkzeuge"): an MCP tool definition plus the action category a policy decides on.
// The categories, the annotations they imply and the meta key are those of @helena/sdk
// (hub/framework, packages/sdk/src/actions.ts and tools.ts), so the gateway's tools move
// there unchanged once the SDK is in the hub; until then this is the one place the gateway
// defines what a tool is.

// What a call does to the world, ordered by how far the effect reaches.
export const ACTION_CATEGORIES = [
  'read',
  'write',
  'execute',
  'send',
  'delete',
  'publish',
  'pay',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

// The key a tool's category travels under in tools/list (`_meta`), as in @helena/sdk.
export const ACTION_META_KEY = 'helena/action';

export interface AgentToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // The category of a call before the gateway looks at what the call actually does: a click
  // is 'write', but a click that submits a form is 'send' (categoryOf in tools.ts).
  category: ActionCategory;
}

// The MCP tool annotations a category implies (@helena/sdk annotationsForCategory), so an MCP
// client that knows nothing of Helena still shows a read-only tool as one.
export function annotationsForCategory(category: ActionCategory): {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint?: boolean;
} {
  switch (category) {
    case 'read':
      return { readOnlyHint: true, destructiveHint: false };
    case 'write':
      return { readOnlyHint: false, destructiveHint: false };
    case 'execute':
      return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
    case 'send':
    case 'publish':
    case 'pay':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
    case 'delete':
      return { readOnlyHint: false, destructiveHint: true };
  }
}

// The tool as an MCP client sees it in tools/list.
export function mcpToolOf(tool: AgentToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { title: tool.title, ...annotationsForCategory(tool.category) },
    _meta: { [ACTION_META_KEY]: tool.category },
  };
}
