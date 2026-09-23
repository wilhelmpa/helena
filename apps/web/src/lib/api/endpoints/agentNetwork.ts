import { request } from '@/lib/api/core/client';

// The network access of a project's isolated agents (mirrors
// apps/api modules/agent-egress/model.ts). Every agent connection leaves through an
// egress proxy that reaches public addresses only — loopback, the LAN and other
// private ranges are never reachable, whatever these settings say. On top of that:
// `open` reaches every public host but the deny list; `allowlist` reaches only the
// allow list (the deny list still applies); `blocked` reaches nothing (the Plan API
// and the browser gateway do not go through the proxy). A domain covers its
// subdomains. An agent of the project can carry a mode of its own, overriding the
// project's for that agent; the allow/deny lists stay the project's either way.
export const AGENT_NETWORK_MODES = ['open', 'allowlist', 'blocked'] as const;
export type AgentNetworkMode = (typeof AGENT_NETWORK_MODES)[number];

export const MAX_AGENT_NETWORK_DOMAINS = 200;

// One agent of the project, with the mode of its own or null where it follows the
// project's.
export interface AgentNetworkAgentOverride {
  id: number;
  username: string;
  name: string;
  mode: AgentNetworkMode | null;
}

export interface AgentNetworkSettings {
  mode: AgentNetworkMode;
  allow: string[];
  deny: string[];
  mailPorts: boolean;
  agents: AgentNetworkAgentOverride[];
}

export interface AgentNetworkSettingsPatch {
  mode?: AgentNetworkMode;
  allow?: string[];
  deny?: string[];
  mailPorts?: boolean;
  // Changes to the agents' own modes, by agent id (as a string); null makes the
  // agent follow the project again. Only the agents named here change.
  agents?: Record<string, AgentNetworkMode | null>;
}

export type AgentNetworkDecision = 'allowed' | 'blocked';

// Why the egress proxy refused a connection, as its reports name it. Kept as a
// runtime list for the log's reason labels; the API types the field as a plain
// string, so an unrecognized value still renders (as its raw text) instead of
// breaking the row.
export const AGENT_NETWORK_REASONS = [
  'blocked',
  'private-address',
  'port',
  'denylisted',
  'not-allowlisted',
  'dns',
  'connect-failed',
  'bad-request',
] as const;

export interface AgentNetworkEvent {
  id: number;
  host: string;
  port: number;
  decision: AgentNetworkDecision;
  reason: string | null;
  connections: number;
  bytesOut: number;
  bytesIn: number;
  firstAt: string;
  lastAt: string;
  runId: number | null;
  agent: { id: number; username: string; name: string } | null;
}

export interface AgentNetworkEventPage {
  items: AgentNetworkEvent[];
  nextBefore: number | null;
}

export const getAgentNetworkSettings = (projectKey: string) =>
  request<AgentNetworkSettings>(`/projects/${projectKey}/settings/agent-network`);

export const updateAgentNetworkSettings = (projectKey: string, patch: AgentNetworkSettingsPatch) =>
  request<AgentNetworkSettings>(`/projects/${projectKey}/settings/agent-network`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export const listAgentNetworkEvents = (
  projectKey: string,
  params: { decision?: AgentNetworkDecision; before?: number; limit?: number } = {},
) => {
  const query = new URLSearchParams({ limit: String(params.limit ?? 50) });
  if (params.before != null) query.set('before', String(params.before));
  if (params.decision) query.set('decision', params.decision);
  return request<AgentNetworkEventPage>(
    `/projects/${projectKey}/agent-network/events?${query.toString()}`,
  );
};
