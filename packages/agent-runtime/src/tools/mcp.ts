import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveMcpValue, type McpServerSpec } from '@helena/sdk';
import { error, type AgentTool, type JsonSchemaObject, type ToolOutput } from './types';

// The MCP servers Helena hands the agent (Helena's own, the project browser, the team
// library's), each as tools the model calls directly. There is no bridge in between: the
// model sees each tool's own name and schema (Hermes reached the browser through a
// `tool_call` bridge, which failed 11 of 112 calls in the browser eval).
//
// Helena's own server checks every call where it lands, and the browser gateway asks
// Helena's policy for each action itself; the calls of every other server are asked about
// here first (the tool's `question`).

// The servers that decide on their calls themselves.
export const SERVER_SIDE_POLICY = new Set(['itsaplan', 'helena', 'plan', 'projekt-browser']);
// Their tools keep their own names; a library server's are named `<server>__<tool>`.
const BARE_NAMES = new Set(['itsaplan', 'helena', 'plan', 'projekt-browser']);
export const BROWSER_SERVER = 'projekt-browser';

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface McpConnection {
  server: string;
  client: Client;
  close(): Promise<void>;
}

function namedValues(
  entries: McpServerSpec['env'] | McpServerSpec['headers'],
  env: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    (entries ?? []).map(({ name, value }) => [name, resolveMcpValue(value, env)]),
  );
}

// The environment a stdio server starts with: a small base, the variables it reads by name,
// and its own values. Nothing else of the loop's environment reaches it.
function stdioEnv(
  spec: McpServerSpec,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const base: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'LANG', 'TMPDIR', 'USER']) {
    if (env[name]) base[name] = env[name]!;
  }
  for (const name of spec.passEnv ?? []) {
    if (env[name] !== undefined) base[name] = env[name]!;
  }
  return { ...base, ...namedValues(spec.env, env) };
}

export async function connectMcp(
  spec: McpServerSpec,
  env: Record<string, string | undefined>,
  timeoutMs = 20_000,
): Promise<McpConnection> {
  const client = new Client({ name: 'helena-agent', version: '1.0.0' });
  let transport;
  if (spec.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: spec.command ?? '',
      args: spec.args ?? [],
      env: stdioEnv(spec, env),
      stderr: 'ignore',
    });
  } else if (spec.transport === 'http') {
    const headers = new Headers(namedValues(spec.headers, env));
    if (['itsaplan', 'helena', 'plan'].includes(spec.name)) {
      for (const [header, variable] of [
        ['x-helena-run', 'ITSAPLAN_RUN_ID'],
        ['x-volition-message', 'ITSAPLAN_MESSAGE_ID'],
      ] as const) {
        const id = env[variable];
        if (id) headers.set(header, id);
        else headers.delete(header);
      }
    }
    transport = new StreamableHTTPClientTransport(new URL(spec.url ?? ''), {
      requestInit: { headers, redirect: 'error' },
    });
  } else {
    throw new Error(`MCP server ${spec.name}: SSE is not supported`);
  }
  const connecting = client.connect(transport);
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`MCP server ${spec.name} did not start`)),
      timeoutMs,
    ).unref?.(),
  );
  await Promise.race([connecting, deadline]);
  return {
    server: spec.name,
    client,
    close: async () => {
      await client.close().catch(() => {});
    },
  };
}

function schemaOf(value: unknown): JsonSchemaObject {
  const schema = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    ...schema,
    type: 'object',
    properties: (schema.properties as Record<string, unknown>) ?? {},
  };
}

// MCP content as the text the model reads: text parts joined, other parts named.
export function mcpText(result: { content?: unknown; structuredContent?: unknown }): string {
  const parts = Array.isArray(result.content) ? result.content : [];
  const texts = parts.map((part: { type?: string; text?: string; mimeType?: string }) =>
    part?.type === 'text'
      ? (part.text ?? '')
      : `[${part?.type ?? 'content'}${part?.mimeType ? ` ${part.mimeType}` : ''}]`,
  );
  if (texts.length === 0 && result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return texts.join('\n');
}

export interface McpToolList {
  tools: AgentTool[];
  // The instructions a server sends on connect (the browser gateway's usage rules).
  instructions: { server: string; text: string }[];
}

export async function mcpTools(
  connection: McpConnection,
  spec: McpServerSpec,
  taken: Set<string>,
): Promise<McpToolList> {
  const listed = await connection.client.listTools();
  const instructions = connection.client.getInstructions?.();
  const tools: AgentTool[] = [];
  const timeoutMs = spec.toolTimeoutSec ? spec.toolTimeoutSec * 1000 : DEFAULT_TIMEOUT_MS;
  for (const tool of listed.tools) {
    let name = BARE_NAMES.has(spec.name) ? tool.name : `${spec.name}__${tool.name}`;
    name = name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
    if (!TOOL_NAME.test(name) || taken.has(name)) {
      name = `${spec.name}__${tool.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
      if (taken.has(name)) continue;
    }
    taken.add(name);
    const annotations = (tool.annotations ?? null) as Record<string, unknown> | null;
    const readOnly = annotations?.readOnlyHint === true;
    const serverSide = SERVER_SIDE_POLICY.has(spec.name);
    tools.push({
      name,
      description: (tool.description ?? tool.title ?? tool.name).slice(0, 2000),
      inputSchema: schemaOf(tool.inputSchema),
      kind: spec.name === BROWSER_SERVER ? 'browser' : 'normal',
      timeoutMs,
      readOnly,
      question: (input) =>
        serverSide || readOnly
          ? null
          : {
              tool: tool.name,
              mcp: { server: spec.name, annotations },
              summary: JSON.stringify(input).slice(0, 300),
            },
      async execute(input, ctx): Promise<ToolOutput> {
        try {
          const result = await connection.client.callTool(
            { name: tool.name, arguments: input },
            undefined,
            { signal: ctx.signal, timeout: timeoutMs },
          );
          const output = mcpText(result as { content?: unknown; structuredContent?: unknown });
          return {
            text: output || '(no output)',
            isError: result.isError === true,
            changed: !readOnly,
          };
        } catch (err) {
          return error(
            `The tool ${tool.name} failed: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}`,
          );
        }
      },
    });
  }
  return {
    tools,
    instructions: instructions ? [{ server: spec.name, text: instructions }] : [],
  };
}
