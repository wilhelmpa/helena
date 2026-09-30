import type { CallToolResult, Tool, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import {
  ACTION_META_KEY,
  annotationsForCategory,
  categoryFromAnnotations,
  type ActionCategory,
} from './actions';
import { toJsonSchema, type JsonSchema, type SchemaLike } from './schema';
import type { AgentRef, Logger, ProjectRef } from './common';

// An agent tool is an MCP tool (https://modelcontextprotocol.io): a name, a description
// the model reads, a JSON-Schema input, optional output schema and annotations. Helena
// adds one thing, the action category a policy decides on, and serves every registered
// tool to agents through its MCP endpoint. A tool from an existing MCP server needs no
// code at all: a plugin names the server in its manifest (`mcpServers`).

export interface ToolCallContext {
  // Who calls: the agent the call runs for, and the project it acts in.
  agent: AgentRef | null;
  project: ProjectRef | null;
  // The decrypted credential of the connector the tool belongs to, keyed by the fields of
  // its credentialSchema. Absent for a tool without a connector.
  credential?: Record<string, string | number | boolean>;
  credentialId?: number;
  runId?: number | null;
  // The caller's own credential for Helena's API, for a tool that acts on Helena as the
  // caller (the built-in route tools do): what it may do is exactly what the caller may.
  caller?: { userId: string; auth: CallerAuth };
  signal?: AbortSignal;
  log: Logger;
}

export type CallerAuth =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'oauth'; accessToken: string }
  | { kind: 'owner-terminal'; accessToken: string };

export interface AgentTool<Input = Record<string, unknown>, Output = unknown> {
  // The MCP tool name, unique across Helena: `[A-Za-z0-9_-]{1,64}`.
  name: string;
  title?: string;
  // Given to the model verbatim.
  description: string;
  inputSchema: SchemaLike<Input>;
  outputSchema?: SchemaLike<Output>;
  annotations?: ToolAnnotations;
  // What calling the tool does. Tools without it get the category their annotations
  // imply (read-only is `read`, destructive `delete`, anything else `write`).
  category?: ActionCategory;
  // For a tool whose effect depends on its arguments (a browser click may send, pay or
  // publish): the category of one call. `category` is then the widest it can be.
  classify?(input: Input): ActionCategory;
  // The connector whose credential the tool runs with.
  connector?: string;
  // The OAuth scopes the connector's token needs for this tool, shown in the catalog.
  scopes?: string[];
  // Runs the call. A plain return value becomes a JSON text block plus structured
  // content; return a CallToolResult for full control (images, several blocks, isError).
  handler(input: Input, ctx: ToolCallContext): Promise<Output | CallToolResult>;
}

// A tool of any input and output, as registries hold them.
export type AnyAgentTool = AgentTool<unknown, unknown>;

export const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

// The category of one call: the tool's own classification, then its declaration, then
// what its MCP annotations say.
export function toolCategory<Input>(
  tool: AgentTool<Input, unknown>,
  input?: Input,
): ActionCategory {
  if (tool.classify && input !== undefined) return tool.classify(input);
  return declaredCategory(tool);
}

// The static category of a tool, for a catalog and for the manifest check: for a tool
// that classifies each call, the widest effect it can have.
export function declaredCategory(
  tool: Pick<AnyAgentTool, 'category' | 'annotations'>,
): ActionCategory {
  return tool.category ?? categoryFromAnnotations(tool.annotations);
}

// The tool as an MCP client sees it in tools/list.
export function toMcpTool(tool: AnyAgentTool): Tool {
  const category = declaredCategory(tool);
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    inputSchema: toJsonSchema(tool.inputSchema) as Tool['inputSchema'],
    ...(tool.outputSchema
      ? { outputSchema: toJsonSchema(tool.outputSchema) as Tool['outputSchema'] }
      : {}),
    annotations: { ...annotationsForCategory(category), ...tool.annotations },
    _meta: { [ACTION_META_KEY]: category },
  };
}

export function isCallToolResult(value: unknown): value is CallToolResult {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as CallToolResult).content) &&
    (value as CallToolResult).content.every(
      (block) => !!block && typeof block === 'object' && typeof block.type === 'string',
    )
  );
}

// A handler's return value as an MCP result.
export function toCallToolResult(value: unknown): CallToolResult {
  if (isCallToolResult(value)) return value;
  if (typeof value === 'string') return { content: [{ type: 'text', text: value }] };
  const structured =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  return {
    content: [{ type: 'text', text: JSON.stringify(value ?? null) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// The serializable form for a catalog UI.
export interface ToolDescriptor {
  name: string;
  title?: string;
  description: string;
  category: ActionCategory;
  connector?: string;
  scopes?: string[];
  inputSchema: JsonSchema;
}

export function toolDescriptor(tool: AnyAgentTool): ToolDescriptor {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    description: tool.description,
    category: declaredCategory(tool),
    ...(tool.connector ? { connector: tool.connector } : {}),
    ...(tool.scopes ? { scopes: tool.scopes } : {}),
    inputSchema: toJsonSchema(tool.inputSchema),
  };
}
