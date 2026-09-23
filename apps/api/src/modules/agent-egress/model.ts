import { t } from 'elysia';

// How far an isolated agent of a project may reach out. Every agent connection leaves
// through the egress proxy, which reaches public addresses only (never loopback, the LAN
// or other private ranges, whatever the settings say). On top of that:
// - `open` (Internet): every public host except the ones on `deny`;
// - `allowlist`: only the hosts on `allow`, and still not the ones on `deny`;
// - `blocked`: nothing; the agent keeps the Plan API and the browser gateway, which do not
//   go through the proxy, and its model's endpoints (the proxy's own list, egress.json).
// A domain covers its subdomains. `mailPorts` also opens 465, 587 and 993. An agent of the
// project can have a mode of its own (`agents`, by agent id); the lists stay the project's.
export const AGENT_NETWORK_MODES = ['open', 'allowlist', 'blocked'] as const;
export type AgentNetworkMode = (typeof AGENT_NETWORK_MODES)[number];

export const MAX_DOMAINS = 200;
export const MAX_DOMAIN_LENGTH = 253;

export interface AgentNetworkSettings {
  mode: AgentNetworkMode;
  allow: string[];
  deny: string[];
  mailPorts: boolean;
  // The agents whose mode differs from the project's, by agent id.
  agents: Record<string, AgentNetworkMode>;
}

export const DEFAULT_AGENT_NETWORK: AgentNetworkSettings = {
  mode: 'open',
  allow: [],
  deny: [],
  mailPorts: false,
  agents: {},
};

const Mode = t.Union([t.Literal('open'), t.Literal('allowlist'), t.Literal('blocked')]);

const DomainList = t.Array(t.String({ minLength: 1, maxLength: MAX_DOMAIN_LENGTH + 2 }), {
  maxItems: MAX_DOMAINS,
});

export const AgentNetworkSettingsResponse = t.Object({
  mode: Mode,
  allow: t.Array(t.String()),
  deny: t.Array(t.String()),
  mailPorts: t.Boolean(),
  // Every agent of the project, with the mode of its own or null where it follows the
  // project's.
  agents: t.Array(
    t.Object({
      id: t.Number(),
      username: t.String(),
      name: t.String(),
      mode: t.Nullable(Mode),
    }),
  ),
});

export const updateAgentNetworkBody = t.Object({
  mode: t.Optional(Mode),
  allow: t.Optional(DomainList),
  deny: t.Optional(DomainList),
  mailPorts: t.Optional(t.Boolean()),
  // Changes to the agents' own modes, by agent id; null makes the agent follow the project.
  agents: t.Optional(t.Record(t.String({ pattern: '^[1-9][0-9]{0,9}$' }), t.Nullable(Mode))),
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
  'blocked',
  'private-address',
  'port',
  'denylisted',
  'not-allowlisted',
  'dns',
  'connect-failed',
  'bad-request',
] as const;
