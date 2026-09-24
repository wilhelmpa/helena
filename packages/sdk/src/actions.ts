import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// What an action does to the world, which is what a policy decides on: a tool call, a
// connector service, a workflow step and an agent runtime's own tool call all carry one.
// The categories are ordered by how far the effect reaches and how hard it is to undo.
export const ACTION_CATEGORIES = [
  // Looks, changes nothing.
  'read',
  // Changes Helena's own data or files in the agent's workspace; undoable.
  'write',
  // Runs code or a command, or drives a browser: the effect depends on what runs.
  'execute',
  // Reaches a person or system outside Helena: a mail, a chat message, an API call.
  'send',
  // Removes something.
  'delete',
  // Makes something public: a post, a release, a shared page.
  'publish',
  // Spends money.
  'pay',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

// The rank of a category in ACTION_CATEGORIES, for a policy that allows "everything up
// to send" with one threshold.
export function actionRank(category: ActionCategory): number {
  return ACTION_CATEGORIES.indexOf(category);
}

// The MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
// are the standard every MCP client already reads, so a tool that declares only them still
// gets a category: read-only is `read`, destructive is `delete`, open-world is `send`,
// anything else is `write`. `execute`, `publish` and `pay` say more than the annotations
// can and have to be declared.
export function categoryFromAnnotations(annotations: ToolAnnotations | undefined): ActionCategory {
  if (!annotations) return 'write';
  if (annotations.readOnlyHint === true) return 'read';
  if (annotations.destructiveHint === true) return 'delete';
  if (annotations.openWorldHint === true) return 'send';
  return 'write';
}

// The annotations a category implies, for serving a tool to an MCP client that knows
// nothing of categories. The tool's own annotations win where it sets them.
export function annotationsForCategory(category: ActionCategory): ToolAnnotations {
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

// An Agent Client Protocol tool call names its kind (ToolKind); this is the category a
// runtime's own tool call gets when it asks for permission (session/request_permission).
export function categoryFromAcpToolKind(kind: string | null | undefined): ActionCategory {
  switch (kind) {
    case 'read':
    case 'search':
    case 'think':
    case 'fetch':
      return 'read';
    case 'edit':
    case 'move':
    case 'switch_mode':
      return 'write';
    case 'delete':
      return 'delete';
    case 'execute':
    default:
      // An unknown kind is treated as the widest effect a runtime can have on its own.
      return 'execute';
  }
}

// The meta key a tool definition carries its category under when it travels as a plain
// MCP tool (tools/list): `_meta: { "helena/action": "send" }`.
export const ACTION_META_KEY = 'helena/action';
