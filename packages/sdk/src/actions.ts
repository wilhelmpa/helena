import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// What an action does to the world, which is what a policy decides on: a tool call, a
// connector service, a workflow step and an agent runtime's own tool call all carry one.
// One list for all of Helena (orchestrator decision D-C1), in risk order; the policy
// engine, the connectors and the browser gateway import it from here.
export const ACTION_CATEGORIES = [
  // Looks, changes nothing: read, search, fetch a page.
  'read',
  // Posts status or results into Helena itself: a comment on its own task, a run report.
  // Always allowed, even at autopilot level 0.
  'report',
  // Creates or changes data, in Helena or in a connected system (a Notion page, a Gitea
  // issue, a file in the workspace).
  'write',
  // Sends a message to a person or an outside inbox: a mail, a chat or Telegram message.
  'send',
  // Makes something public: a post, a public reply, a release, a shared page.
  'publish',
  // Runs code or a command, or drives a browser: the effect depends on what runs.
  'execute',
  // Removes something.
  'delete',
  // Spends money.
  'pay',
  // Changes logins, keys or grants. Always needs approval, even at autopilot level 3.
  'credentials',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

// Where an action lands: inside the agent's own workspace (its project's folder and its
// project's data in Helena) or outside it (the system, other projects, the internet).
// Decides delete and execute: inside, a trusted agent may act and report; outside, a person
// approves.
export type ActionScope = 'workspace' | 'external';

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

// The rank of a category in ACTION_CATEGORIES, for a policy that allows "everything up
// to send" with one threshold.
export function actionRank(category: ActionCategory): number {
  return ACTION_CATEGORIES.indexOf(category);
}

// The category the MCP tool annotations imply. MCP's own defaults count a tool that says
// nothing as destructive and open-world; Helena counts it as `send` (D-C1), never as
// `write`. Read-only is `read`, an explicit destructive hint `delete`, an explicit
// closed world (openWorldHint false) `write`. `report`, `publish`, `execute`, `pay` and
// `credentials` say more than the annotations can and have to be declared.
export function categoryFromAnnotations(annotations: ToolAnnotations | undefined): ActionCategory {
  if (annotations?.readOnlyHint === true) return 'read';
  if (annotations?.destructiveHint === true) return 'delete';
  if (annotations?.openWorldHint === false) return 'write';
  return 'send';
}

// The annotations a category implies, for serving a tool to an MCP client that knows
// nothing of categories. The tool's own annotations win where it sets them.
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
