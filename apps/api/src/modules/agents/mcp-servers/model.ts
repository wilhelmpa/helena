import { t } from 'elysia';

export { agentParams } from '../model';

export const mcpServerParams = t.Object({
  teamId: t.Numeric(),
  mcpServerId: t.Numeric(),
});

const secretRef = t.Optional(
  t.Number({ description: "Id of one of the team's secrets (integration kind 'secret')." }),
);

// A literal value, or a reference to a secret whose value only the agent's runner receives.
// Exactly one of the two is set.
const envEntry = t.Object({
  name: t.String({ pattern: '^[A-Za-z_][A-Za-z0-9_]{0,127}$' }),
  value: t.Optional(t.String({ maxLength: 4096 })),
  credentialId: secretRef,
});

const headerEntry = t.Object({
  name: t.String({ pattern: '^[A-Za-z0-9-]{1,128}$' }),
  value: t.Optional(t.String({ maxLength: 4096 })),
  credentialId: secretRef,
});

export const createMcpServerBody = t.Object({
  name: t.String({
    pattern: '^[a-z0-9][a-z0-9_-]{0,63}$',
    description: "The server's name in Hermes, which is also the name of its toolset.",
  }),
  description: t.Optional(t.String({ maxLength: 500 })),
  transport: t.Union([t.Literal('stdio'), t.Literal('http'), t.Literal('sse')]),
  command: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  args: t.Optional(t.Array(t.String({ maxLength: 1000 }), { maxItems: 64 })),
  url: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  env: t.Optional(t.Array(envEntry, { maxItems: 64 })),
  headers: t.Optional(t.Array(headerEntry, { maxItems: 64 })),
});

export const updateMcpServerBody = t.Partial(createMcpServerBody);

// A secret is named by its id and label, never by its value.
const valueResponse = t.Object({
  name: t.String(),
  value: t.Nullable(t.String()),
  credentialId: t.Nullable(t.Number()),
  credentialLabel: t.Nullable(
    t.String({ description: 'Null for a literal, and for a secret that no longer exists.' }),
  ),
});

export const McpServerResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  name: t.String(),
  description: t.String(),
  transport: t.Union([t.Literal('stdio'), t.Literal('http'), t.Literal('sse')]),
  command: t.Nullable(t.String()),
  args: t.Array(t.String()),
  url: t.Nullable(t.String()),
  env: t.Array(valueResponse),
  headers: t.Array(valueResponse),
  builtin: t.Boolean({
    description:
      'An instance-seeded entry ("Projekt-Browser" and its legacy fallback); a team cannot edit or delete it, only enable it per agent.',
  }),
  createdAt: t.String(),
});

export const McpServerListResponse = t.Array(McpServerResponse);

export const setAgentMcpServersBody = t.Object({
  mcpServerIds: t.Array(t.Number(), { description: 'Ids of MCP servers of the team library.' }),
});
