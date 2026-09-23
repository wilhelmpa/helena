import { t } from 'elysia';

// How far an isolated agent of a project may reach out. Every agent connection leaves
// through the egress proxy, which reaches public addresses only (never loopback, the LAN
// or other private ranges, whatever the settings say). On top of that:
// - `open`: every public host except the ones on `deny`;
// - `allowlist`: only the hosts on `allow`, and still not the ones on `deny`.
// A domain covers its subdomains. `mailPorts` also opens 465, 587 and 993.
export const AGENT_NETWORK_MODES = ['open', 'allowlist'] as const;
export type AgentNetworkMode = (typeof AGENT_NETWORK_MODES)[number];

export const MAX_DOMAINS = 200;
export const MAX_DOMAIN_LENGTH = 253;

export interface AgentNetworkSettings {
  mode: AgentNetworkMode;
  allow: string[];
  deny: string[];
  mailPorts: boolean;
}

export const DEFAULT_AGENT_NETWORK: AgentNetworkSettings = {
  mode: 'open',
  allow: [],
  deny: [],
  mailPorts: false,
};

const Mode = t.Union([t.Literal('open'), t.Literal('allowlist')]);

const DomainList = t.Array(t.String({ minLength: 1, maxLength: MAX_DOMAIN_LENGTH + 2 }), {
  maxItems: MAX_DOMAINS,
});

export const AgentNetworkSettingsResponse = t.Object({
  mode: Mode,
  allow: t.Array(t.String()),
  deny: t.Array(t.String()),
  mailPorts: t.Boolean(),
});

export const updateAgentNetworkBody = t.Object({
  mode: t.Optional(Mode),
  allow: t.Optional(DomainList),
  deny: t.Optional(DomainList),
  mailPorts: t.Optional(t.Boolean()),
});

export const agentNetworkEventsQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200, description: 'Default 50.' })),
  before: t.Optional(t.Numeric({ minimum: 1, description: 'Only events with a smaller id.' })),
  runId: t.Optional(t.Numeric({ minimum: 1 })),
  decision: t.Optional(t.Union([t.Literal('allowed'), t.Literal('blocked')])),
});

export const AgentNetworkEventResponse = t.Object({
  id: t.Number(),
  host: t.String(),
  port: t.Number(),
  decision: t.Union([t.Literal('allowed'), t.Literal('blocked')]),
  reason: t.Nullable(t.String()),
  connections: t.Number(),
  bytesOut: t.Number(),
  bytesIn: t.Number(),
  firstAt: t.String(),
  lastAt: t.String(),
  runId: t.Nullable(t.Number()),
  agent: t.Nullable(t.Object({ id: t.Number(), username: t.String(), name: t.String() })),
});

export const AgentNetworkEventPageResponse = t.Object({
  items: t.Array(AgentNetworkEventResponse),
  nextBefore: t.Nullable(t.Number()),
});

// Why the egress proxy refused a connection, as its reports name it.
export const EGRESS_REASONS = [
  'private-address',
  'port',
  'denylisted',
  'not-allowlisted',
  'dns',
  'connect-failed',
  'bad-request',
] as const;
