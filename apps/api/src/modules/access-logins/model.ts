import { t } from 'elysia';

// "Anmeldungen" in Zugänge (service.ts): names, states and times of every login the agents
// use. No field here holds a token, and none may be added: a test checks every response.

export const accessLoginAgentParams = t.Object({ teamId: t.Numeric(), agentId: t.Numeric() });

export const agentLoginRow = t.Object({
  agentId: t.Number(),
  name: t.String(),
  username: t.String(),
  runtime: t.Union([t.Literal('claude'), t.Literal('codex')]),
  online: t.Boolean({ description: "Whether the agent's runner was seen lately." }),
  source: t.Union([t.Literal('own'), t.Literal('stored'), t.Literal('none')], {
    description:
      "Which login the runtime works with: 'own' the runtime's own login in the agent's " +
      "home (a Codex device login), 'stored' a runtime login of Zugänge granted to the " +
      "agent (it wins over its own), 'none' neither.",
  }),
  state: t.Union(
    [t.Literal('signedIn'), t.Literal('expired'), t.Literal('signedOut'), t.Literal('unknown')],
    {
      description:
        "'signedIn' a login reaches the runtime; 'expired' the provider refused it (sign in " +
        "again); 'signedOut' none reaches it; 'unknown' the runner has not said yet.",
    },
  ),
  account: t.Nullable(
    t.Object(
      {
        method: t.Nullable(t.String()),
        email: t.Nullable(t.String()),
        plan: t.Nullable(t.String()),
        organization: t.Nullable(t.String()),
      },
      { description: "The runtime's own login, as the runtime names its account." },
    ),
  ),
  refreshedAt: t.Nullable(
    t.String({ description: 'When the runtime last wrote its own login (signed in, renewed).' }),
  ),
  checkedAt: t.Nullable(t.String({ description: 'When the runner last asked the runtime.' })),
  credential: t.Nullable(
    t.Object(
      { id: t.Number(), label: t.String() },
      { description: 'The stored runtime login granted to the agent.' },
    ),
  ),
  command: t.Nullable(
    t.String({
      description: 'What the owner runs in the owner terminal to sign the runtime in (again).',
    }),
  ),
  canCheck: t.Boolean({ description: "The agent's runner can read the login now." }),
  canSignOut: t.Boolean({
    description: "The viewer may sign the runtime's own login out, and its runner can.",
  }),
});

export const sharedLoginRow = t.Object({
  key: t.String(),
  store: t.String({ description: "Where it lives: 'hermes' (Hermes' store), 'codex-cli'." }),
  provider: t.String(),
  label: t.Nullable(t.String()),
  managed: t.Boolean({ description: 'Whether the token keeper renews it.' }),
  state: t.Union([
    t.Literal('ok'),
    t.Literal('expiring'),
    t.Literal('expired'),
    t.Literal('error'),
    t.Literal('invalid'),
    t.Literal('unknown'),
  ]),
  condition: t.Union(
    [
      t.Literal('active'),
      t.Literal('valid'),
      t.Literal('renewFailing'),
      t.Literal('relogin'),
      t.Literal('separate'),
      t.Literal('unknown'),
    ],
    { description: 'What it asks of the owner (@helena/sdk runtimeLoginCondition).' },
  ),
  expiresAt: t.Nullable(t.String()),
  refreshedAt: t.Nullable(t.String()),
  error: t.Nullable(t.String()),
  command: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  plan: t.Nullable(t.String({ description: 'The plan, as the plan limits last read it.' })),
  stale: t.Boolean({ description: 'The token keeper stopped writing its status.' }),
  checkedAt: t.String(),
});

export const AccessLoginsResponse = t.Object({
  agents: t.Array(agentLoginRow),
  shared: t.Nullable(t.Array(sharedLoginRow), {
    description: 'The model logins every Hermes agent shares; null for anyone but the owner.',
  }),
});

export type AgentLoginRow = typeof agentLoginRow.static;
export type SharedLoginRow = typeof sharedLoginRow.static;
export type AccessLoginsResponse = typeof AccessLoginsResponse.static;
