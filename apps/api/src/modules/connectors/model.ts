import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';
import { GrantResponse, UseAction } from '#modules/agents/credentials/model';

export const accountParams = t.Object({ teamId: t.Numeric(), accountId: t.Numeric() });
export const clientParams = t.Object({ teamId: t.Numeric(), clientId: t.Numeric() });

const Engine = t.Union([t.Literal('helena'), t.Literal('gog')]);
const Status = t.Nullable(t.Union([t.Literal('ok'), t.Literal('needs_auth'), t.Literal('error')]));
const services = t.Array(t.String({ maxLength: 32 }), { maxItems: 20 });

export const GoogleClientResponse = t.Object({
  id: t.Number(),
  label: t.String(),
  clientId: t.String(),
  projectId: t.Nullable(t.String()),
  type: t.Union([t.Literal('installed'), t.Literal('web')]),
  accounts: t.Number(),
  createdAt: t.String(),
});

export const GoogleAccountResponse = t.Object({
  id: t.Number(),
  label: t.String(),
  email: t.String(),
  engine: Engine,
  clientCredentialId: t.Nullable(t.Number()),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  services: t.Array(t.Object({ id: t.String(), enabled: t.Boolean(), granted: t.Boolean() })),
  status: Status,
  statusDetail: t.Nullable(t.String()),
  checkedAt: t.Nullable(t.String()),
  signedIn: t.Boolean(),
  grants: t.Array(GrantResponse),
  mail: t.Nullable(
    t.Object({
      accountId: t.Number(),
      enabled: t.Boolean(),
      fetchDays: t.Nullable(t.Number()),
      syncStatus: t.String(),
      syncError: t.Nullable(t.String()),
    }),
  ),
  createdAt: t.String(),
});

export const GoogleOverviewResponse = t.Object({
  accounts: t.Array(GoogleAccountResponse),
  clients: t.Array(GoogleClientResponse),
  gogAvailable: t.Boolean(),
  // Whether a Web client can return to Helena itself (Helena runs on https).
  callbackAvailable: t.Boolean(),
});

export const importClientBody = t.Object({
  json: t.String({
    minLength: 2,
    maxLength: 20_000,
    description: 'The client file as downloaded.',
  }),
  label: t.Optional(t.String({ maxLength: 200 })),
  engine: t.Optional(Engine),
});

export const ImportClientResponse = t.Object({ client: t.Nullable(GoogleClientResponse) });

export const signInBody = t.Object({
  engine: Engine,
  clientCredentialId: t.Optional(t.Integer()),
  email: t.Optional(t.String({ format: 'email', maxLength: 320 })),
  services,
  projectId: t.Optional(t.Nullable(t.Integer())),
  accountId: t.Optional(t.Integer({ description: 'Sign in an existing account again.' })),
  removeFromGog: t.Optional(t.Boolean()),
});

export const SignInResponse = t.Object({
  sessionId: t.String(),
  url: t.String(),
  mode: t.Union([t.Literal('paste'), t.Literal('callback')]),
});

export const finishSignInBody = t.Object({
  sessionId: t.String({ minLength: 10, maxLength: 200 }),
  redirectUrl: t.String({ minLength: 1, maxLength: 4000 }),
});

export const updateGoogleAccountBody = t.Object({
  label: t.Optional(t.String({ maxLength: 200 })),
  projectId: t.Optional(t.Nullable(t.Integer())),
  services: t.Optional(services),
});

export const deleteGoogleAccountQuery = t.Object({
  fromGog: t.Optional(t.BooleanString()),
});

export const GogStatusResponse = t.Object({
  available: t.Boolean(),
  unlisted: t.Array(
    t.Object({ email: t.String(), services: t.Array(t.String()), ok: t.Boolean() }),
  ),
});

export const adoptGogBody = t.Object({
  email: t.String({ format: 'email', maxLength: 320 }),
  projectId: t.Optional(t.Nullable(t.Integer())),
});

export const auditQuery = t.Object({
  credentialId: t.Optional(t.Numeric()),
  action: t.Optional(UseAction),
  ...pageQueryFields,
});

export const AuditPageResponse = pageResponse(
  t.Object({
    id: t.Number(),
    credentialId: t.Nullable(t.Number()),
    credentialLabel: t.String(),
    action: UseAction,
    category: t.Nullable(t.String()),
    purpose: t.String(),
    agentId: t.Nullable(t.Number()),
    agentName: t.String(),
    runId: t.Nullable(t.Number()),
    issueIdentifier: t.Nullable(t.String()),
    chatMessageId: t.Nullable(t.Number()),
    createdAt: t.String(),
  }),
);

export const CatalogResponse = t.Array(
  t.Object({
    id: t.String(),
    label: t.Any(),
    icon: t.Nullable(t.String()),
    kind: t.Union([t.Literal('account'), t.Literal('credential')]),
    services: t.Array(t.Object({ id: t.String(), label: t.Any(), actions: t.Array(t.String()) })),
    tools: t.Array(
      t.Object({ name: t.String(), service: t.String(), category: t.String(), gog: t.Boolean() }),
    ),
  }),
);

export const projectKeyParams = t.Object({ projectKey: t.String() });
export const actionParams = t.Object({ projectKey: t.String(), actionId: t.Numeric() });

export const ConnectionsResponse = t.Object({
  google: t.Array(
    t.Object({
      account: t.String(),
      engine: Engine,
      services: t.Array(
        t.Object({ id: t.String(), access: t.Union([t.Literal('read'), t.Literal('write')]) }),
      ),
      tools: t.Array(t.String()),
    }),
  ),
  webLogins: t.Array(t.Object({ id: t.Number(), label: t.String(), origins: t.Array(t.String()) })),
  sshKeys: t.Array(
    t.Object({ id: t.Number(), label: t.String(), publicKey: t.Nullable(t.String()) }),
  ),
  environment: t.Array(
    t.Object({ name: t.String(), label: t.String(), secret: t.Boolean() }),
    {
      description:
        'The environment variables your commands receive in each run and chat answer. Use ' +
        'them by name ($NAME); never print a secret one.',
    },
  ),
});

export const ToolCallResponse = t.Object({
  status: t.Union([t.Literal('done'), t.Literal('pending_approval'), t.Literal('denied')]),
  result: t.Optional(t.Any()),
  actionId: t.Optional(t.Number()),
  approvalId: t.Optional(t.Number()),
  message: t.Optional(t.String()),
  reason: t.Optional(t.String()),
});

export const ConnectorActionResponse = t.Object({
  id: t.Number(),
  tool: t.String(),
  category: t.String(),
  summary: t.String(),
  status: t.String(),
  approvalId: t.Nullable(t.Number()),
  result: t.Any(),
  error: t.Nullable(t.String()),
  createdAt: t.String(),
  finishedAt: t.Nullable(t.String()),
});

export const cloneParams = t.Object({ teamId: t.Numeric(), credentialId: t.Numeric() });

export const cloneBody = t.Object({
  projectId: t.Integer(),
  areaId: t.Optional(
    t.Nullable(t.Integer({ description: 'The area; none for the workspace itself.' })),
  ),
  url: t.String({
    minLength: 5,
    maxLength: 500,
    description: 'git@host:owner/repo.git, ssh:// or https://',
  }),
  agentId: t.Optional(
    t.Integer({ description: 'The agent whose runner clones; any of the project.' }),
  ),
});

export const CloneResponse = t.Object({
  runId: t.Number(),
  agentId: t.Number(),
  agentName: t.String(),
  folder: t.String(),
  name: t.String(),
});

export const mcpSignInBody = t.Object({
  label: t.Optional(t.String({ maxLength: 200 })),
  serverUrl: t.String({ minLength: 8, maxLength: 2000, description: 'The MCP server URL.' }),
  scope: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  projectId: t.Optional(t.Nullable(t.Integer())),
});

export const McpSignInResponse = t.Object({
  id: t.Number(),
  url: t.Nullable(t.String()),
  mode: t.Union([t.Literal('paste'), t.Literal('callback'), t.Literal('connected')]),
});

export const mcpConnectionParams = t.Object({ teamId: t.Numeric(), connectionId: t.Numeric() });

export const mcpFinishBody = t.Object({ redirectUrl: t.String({ minLength: 1, maxLength: 4000 }) });

export const McpConnectionResponse = t.Object({
  id: t.Number(),
  label: t.String(),
  serverUrl: t.String(),
  status: t.Nullable(t.Union([t.Literal('ok'), t.Literal('needs_auth'), t.Literal('error')])),
  statusDetail: t.Nullable(t.String()),
});
