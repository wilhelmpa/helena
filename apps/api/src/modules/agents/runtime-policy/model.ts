import { t } from 'elysia';

import { runtimeConflict, runtimeInventory, runtimePolicy, runtimeState } from '../core/model';
import { learnedSkill, runtimeActionResult, runtimeActionSnapshot } from '../learning/model';
import { profileReport, runtimeIssue } from '../runtime-sync/model';

// A literal, or the id of a secret whose value GET /agent-runtime/mcp-secrets returns.
const runtimeMcpValue = t.Union([
  t.Object({ name: t.String(), value: t.String() }),
  t.Object({ name: t.String(), secret: t.Number() }),
]);

export const RuntimePolicySnapshotResponse = t.Object({
  revision: t.String(),
  agent: t.Object({ id: t.Number(), name: t.String(), username: t.String() }),
  instructions: t.Nullable(t.String()),
  model: t.Nullable(t.String()),
  memory: t.Object({ enabled: t.Boolean(), lastMessages: t.Nullable(t.Number()) }),
  runtimePolicy,
  projects: t.Array(
    t.Object({ id: t.Number(), key: t.String(), name: t.String(), instructions: t.String() }),
  ),
  skills: t.Array(
    t.Object({
      id: t.Number(),
      slug: t.String(),
      name: t.String(),
      description: t.String(),
      markdown: t.String(),
      files: t.Array(t.Object({ path: t.String(), content: t.String() })),
    }),
  ),
  configuredTools: t.Array(
    t.Object({ id: t.Number(), toolKey: t.String(), integrationKey: t.String() }),
  ),
  // The parts of the knowledge vault the agent's own file tools may reach, as absolute
  // paths (see knowledge.ts). The runner hands it to Hermes as VOLITION_VAULT_ACCESS.
  vaultAccess: t.Object({
    root: t.String(),
    read: t.Array(t.String()),
    write: t.Array(t.String()),
    deny: t.Array(t.String()),
  }),
  mcpServers: t.Array(
    t.Object({
      name: t.String(),
      transport: t.Union([t.Literal('stdio'), t.Literal('http'), t.Literal('sse')]),
      command: t.Nullable(t.String()),
      args: t.Array(t.String()),
      url: t.Nullable(t.String()),
      env: t.Array(runtimeMcpValue),
      headers: t.Array(runtimeMcpValue),
    }),
    { description: 'The MCP servers of the team library enabled on the agent.' },
  ),
  webLogins: t.Boolean({
    description:
      'Whether website logins are granted to the agent. Its runner then reads them for each ' +
      'run and chat answer from GET /agent-runs/:runId/web-logins or ' +
      '/agent-chats/:messageId/web-logins.',
  }),
  learning: t.Object({
    enabled: t.Boolean({ description: 'The agent keeps memory and creates skills.' }),
    curator: t.Boolean({
      description: "The runtime's curator may archive learned skills the agent no longer uses.",
    }),
  }),
  actions: t.Array(runtimeActionSnapshot, {
    description: "The owner's decisions on what the agent learned, not carried out yet.",
  }),
});

export const McpSecretsResponse = t.Object({
  secrets: t.Record(t.String(), t.String(), {
    description: "The values of the secrets the agent's MCP servers reference, by secret id.",
  }),
});

export const RuntimeStateBody = t.Object({
  adapter: t.String({ minLength: 1, maxLength: 64 }),
  status: t.Union([t.Literal('online'), t.Literal('degraded')]),
  appliedRevision: t.Nullable(t.String({ maxLength: 128 })),
  capabilities: t.Array(t.String({ minLength: 1, maxLength: 80 }), { maxItems: 64 }),
  detail: t.Nullable(t.String({ maxLength: 500 })),
  conflicts: t.Optional(t.Array(runtimeConflict, { maxItems: 8 })),
  restored: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 300 }), { maxItems: 20 })),
  inventory: t.Optional(runtimeInventory),
  learnedSkills: t.Optional(t.Array(learnedSkill, { maxItems: 50 })),
  actions: t.Optional(t.Array(runtimeActionResult, { maxItems: 100 })),
  profile: t.Optional(profileReport),
  version: t.Optional(t.Nullable(t.String({ maxLength: 64 }))),
  issues: t.Optional(t.Array(runtimeIssue, { maxItems: 8 })),
});

export const RuntimeStateResponse = runtimeState;
