import { request } from '@/lib/api/core/client';

export type McpTransport = 'stdio' | 'http' | 'sse';

// An environment variable or a header of a server: a literal value, or one of the team's
// secrets, named by its id and label. A secret's value is never returned; a label that is
// null names a secret that was deleted.
export interface McpServerValue {
  name: string;
  value: string | null;
  credentialId: number | null;
  credentialLabel: string | null;
}

// An MCP server of the team's library. A stdio server has a command and arguments, an
// http or sse server a URL.
export interface McpServer {
  id: number;
  teamId: number;
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: McpServerValue[];
  headers: McpServerValue[];
  createdAt: string;
}

// Exactly one of value and credentialId is set.
export interface McpServerValueInput {
  name: string;
  value?: string;
  credentialId?: number;
}

export interface McpServerInput {
  name: string;
  description: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: McpServerValueInput[];
  headers: McpServerValueInput[];
}

export const listMcpServers = (teamId: number) =>
  request<McpServer[]>(`/teams/${teamId}/mcp-servers`);

export const createMcpServer = (teamId: number, input: McpServerInput) =>
  request<McpServer>(`/teams/${teamId}/mcp-servers`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const updateMcpServer = (teamId: number, id: number, input: McpServerInput) =>
  request<McpServer>(`/teams/${teamId}/mcp-servers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

export const deleteMcpServer = (teamId: number, id: number) =>
  request<void>(`/teams/${teamId}/mcp-servers/${id}`, { method: 'DELETE' });

export const listAgentMcpServers = (teamId: number, agentId: number) =>
  request<McpServer[]>(`/teams/${teamId}/ai-agents/${agentId}/mcp-servers`);

export const setAgentMcpServers = (teamId: number, agentId: number, mcpServerIds: number[]) =>
  request<McpServer[]>(`/teams/${teamId}/ai-agents/${agentId}/mcp-servers`, {
    method: 'PUT',
    body: JSON.stringify({ mcpServerIds }),
  });
