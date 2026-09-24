import { request } from '@/lib/api/core/client';

// Whether an agent's runtime runs exactly on its settings in Helena. Its runner applies the
// settings, reads the runtime's profile back and reports what differs (drift); "Neu
// schreiben" has it write the whole profile again.

export type RuntimeDriftCode =
  | 'not-linked'
  | 'managed-config'
  | 'mcp-unmanaged'
  | 'mcp-missing'
  | 'mcp-differs'
  | 'mcp-unsupported'
  | 'setting-differs'
  | 'approval-guard'
  | 'probe-failed';

export interface RuntimeDrift {
  // What drifted, as a path into the runtime's configuration.
  key: string;
  code: RuntimeDriftCode;
  // Names only: the setting keys or the server's keys that differ.
  detail?: string;
}

export interface RuntimeDefaults {
  model: string | null;
  provider: string | null;
  reasoning: string | null;
}

export interface RuntimeProfile {
  hash: string;
  checkedAt: string;
  drift: RuntimeDrift[];
  // What the runtime uses when the agent names no model or reasoning ("Agent default").
  defaults: RuntimeDefaults | null;
  // The MCP servers the runtime starts: Helena's, and the ones of its own configuration
  // Helena turned off.
  mcpServers: { name: string; enabled: boolean; managed: boolean }[];
}

export type RuntimeSyncState = 'synced' | 'drift' | 'pending' | 'degraded' | 'offline' | 'unknown';

export interface RuntimeSync {
  state: RuntimeSyncState;
  revision: string;
  appliedRevision: string | null;
  adapter: string | null;
  detail: string | null;
  profile: RuntimeProfile | null;
  rewritePending: boolean;
  reportedAt: string | null;
}

// The configured model and reasoning of a run next to what its session really ran on.
export interface ModelCheck {
  configured: {
    model: string | null;
    reasoning: string | null;
    source: 'run' | 'agent' | 'default';
  };
  used: { model: string | null; reasoning: string | null; provider: string | null } | null;
  mismatch: ('model' | 'reasoning')[];
}

export const getRuntimeSync = (teamId: number, agentId: number) =>
  request<RuntimeSync>(`/teams/${teamId}/ai-agents/${agentId}/runtime-sync`);

export const rewriteRuntimeProfile = (teamId: number, agentId: number) =>
  request<RuntimeSync>(`/teams/${teamId}/ai-agents/${agentId}/runtime-sync/rewrite`, {
    method: 'POST',
  });
