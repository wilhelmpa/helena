// An agent tool as Helena's framework registers it (docs/volition-helena-oss.md §3a,
// "Agenten-Werkzeuge"): an MCP tool definition plus the action category a policy decides on.
// The categories, their order and the annotations they imply are @helena/sdk's (hub/framework)
// as decided in docs/volition-orchestrator-decisions.md D-C1, so the gateway's tools move
// there unchanged once the SDK is in the hub; until then this is the one place the gateway
// defines what a tool is.

// mirror of @helena/sdk ACTION_CATEGORIES (D-C1): what a call does, in rising risk.
export const ACTION_CATEGORIES = [
  'read',
  'report',
  'write',
  'send',
  'publish',
  'execute',
  'delete',
  'pay',
  'credentials',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export function actionRank(category: ActionCategory): number {
  return ACTION_CATEGORIES.indexOf(category);
}

// The key a tool's category travels under in tools/list (`_meta`), as in @helena/sdk.
export const ACTION_META_KEY = 'helena/action';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface AgentToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // The category of a call before the gateway looks at what the call actually does: a click
  // is 'write', but a click that submits a form is 'send' (categoryOf in tools.ts).
  category: ActionCategory;
  // What the category's annotations do not say (a browser tool acts on the open web); the
  // tool's own win, as in @helena/sdk's toMcpTool.
  annotations?: ToolAnnotations;
}

// The MCP tool annotations a category implies (D-C1), so an MCP client that knows nothing of
// Helena still shows a read-only tool as one. `execute`, `pay` and `credentials` are not
// fixed by D-C1 yet; they take the widest reading until the SDK names them.
export function annotationsForCategory(category: ActionCategory): ToolAnnotations {
  switch (category) {
    case 'read':
      return { readOnlyHint: true, destructiveHint: false };
    case 'report':
    case 'write':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
    case 'send':
    case 'publish':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
    case 'delete':
      return { readOnlyHint: false, destructiveHint: true };
    case 'execute':
    case 'pay':
    case 'credentials':
      return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
  }
}

// The tool as an MCP client sees it in tools/list.
export function mcpToolOf(tool: AgentToolDefinition) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      title: tool.title,
      ...annotationsForCategory(tool.category),
      ...tool.annotations,
    },
    _meta: { [ACTION_META_KEY]: tool.category },
  };
}
