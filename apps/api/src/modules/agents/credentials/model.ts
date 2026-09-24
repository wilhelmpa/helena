import { t } from 'elysia';
import { pageQueryFields, pageResponse } from '#shared/pagination';

export const credentialEntryParams = t.Object({
  teamId: t.Numeric(),
  credentialId: t.Numeric(),
});

export const runWorkParams = t.Object({ runId: t.Numeric() });
export const chatWorkParams = t.Object({ messageId: t.Numeric() });

const CredentialKind = t.Union([
  t.Literal('web_login'),
  t.Literal('api_key'),
  t.Literal('ssh_key'),
  t.Literal('secret'),
  t.Literal('runtime_login'),
]);

const ListedKind = t.Union([
  t.Literal('web_login'),
  t.Literal('api_key'),
  t.Literal('ssh_key'),
  t.Literal('secret'),
  t.Literal('runtime_login'),
  t.Literal('mcp_oauth'),
]);
const LoginRuntime = t.Union([t.Literal('claude'), t.Literal('codex')]);
const LoginMethod = t.Union([t.Literal('oauth_token'), t.Literal('api_key')]);

export const credentialListQuery = t.Object({
  kind: t.Optional(ListedKind),
  projectId: t.Optional(t.Numeric({ description: 'Only the credentials of this project.' })),
  ...pageQueryFields,
});

// Every field of every kind; a field the kind does not have is refused.
const credentialFields = {
  label: t.String({ minLength: 1, maxLength: 200 }),
  projectId: t.Optional(
    t.Nullable(t.Integer({ description: 'The project it is limited to; null for the team.' })),
  ),
  loginUrl: t.Optional(t.String({ maxLength: 2000, description: 'web_login: the login page.' })),
  allowedDomains: t.Optional(
    t.Array(t.String({ maxLength: 300 }), {
      maxItems: 20,
      description: 'web_login: further domains the login may be filled on.',
    }),
  ),
  username: t.Optional(t.String({ maxLength: 500 })),
  password: t.Optional(t.String({ maxLength: 4096 })),
  totpSecret: t.Optional(
    t.Nullable(
      t.String({
        maxLength: 1000,
        description: 'web_login: base32 authenticator key or otpauth:// link. Null removes it.',
      }),
    ),
  ),
  value: t.Optional(
    t.String({ maxLength: 16384, description: 'api_key, secret, runtime_login: the value.' }),
  ),
  notes: t.Optional(t.String({ maxLength: 4000 })),
  // runtime_login: the runtime it signs in, and whether it is an OAuth token (Claude Code,
  // from `claude setup-token`) or an API key.
  runtime: t.Optional(LoginRuntime),
  method: t.Optional(LoginMethod),
};

export const createCredentialEntryBody = t.Object({ kind: CredentialKind, ...credentialFields });

export const updateCredentialEntryBody = t.Partial(t.Object(credentialFields));

export const GrantAccess = t.Union([t.Literal('read'), t.Literal('write')]);

const grantInput = t.Object({
  agentId: t.Optional(t.Nullable(t.Integer({ description: 'The agent it is granted to.' }))),
  projectId: t.Optional(
    t.Nullable(t.Integer({ description: 'The project whose agents it is granted to.' })),
  ),
  service: t.Optional(
    t.Nullable(
      t.String({
        maxLength: 64,
        description: "A service of a connector account ('mail', 'calendar' …); null for all.",
      }),
    ),
  ),
  access: t.Optional(GrantAccess),
});

// The full set of grants. `agentIds` is the short form: those agents, every service,
// write access.
export const setCredentialGrantsBody = t.Object({
  agentIds: t.Optional(t.Array(t.Integer(), { maxItems: 200 })),
  grants: t.Optional(t.Array(grantInput, { maxItems: 400 })),
});

export const GrantResponse = t.Object({
  id: t.Number(),
  agentId: t.Nullable(t.Number()),
  agentName: t.Nullable(t.String()),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  service: t.Nullable(t.String()),
  access: GrantAccess,
});

export const CredentialGrantsResponse = t.Object({ grants: t.Array(GrantResponse) });

export const CredentialEntryResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  kind: ListedKind,
  label: t.String(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  serverUrl: t.Nullable(t.String({ description: 'mcp_oauth: the MCP server.' })),
  status: t.Nullable(t.Union([t.Literal('ok'), t.Literal('needs_auth'), t.Literal('error')])),
  statusDetail: t.Nullable(t.String()),
  loginUrl: t.Nullable(t.String()),
  allowedDomains: t.Array(t.String()),
  username: t.Nullable(t.String()),
  notes: t.String(),
  publicKey: t.Nullable(t.String()),
  runtime: t.Nullable(LoginRuntime),
  method: t.Nullable(LoginMethod),
  secrets: t.Array(t.String(), { description: 'The secret fields that hold a value.' }),
  agentIds: t.Array(t.Number(), { description: 'The agents granted by name.' }),
  grants: t.Array(GrantResponse),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const CredentialEntryPageResponse = pageResponse(CredentialEntryResponse);

export const credentialUseListQuery = t.Object(pageQueryFields);

export const UseAction = t.Union([
  t.Literal('delivered'),
  t.Literal('used'),
  t.Literal('called'),
  t.Literal('denied'),
  t.Literal('approval'),
  t.Literal('changed'),
]);

export const CredentialUsePageResponse = pageResponse(
  t.Object({
    id: t.Number(),
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

export const WebLoginsResponse = t.Object({
  logins: t.Array(
    t.Object({
      id: t.Number(),
      label: t.String(),
      updatedAt: t.String({ description: 'Changes whenever the login is edited.' }),
      origins: t.Array(t.String(), { description: 'The origins it may be filled on.' }),
      username: t.String(),
      password: t.String(),
      totpSecret: t.Nullable(t.String()),
    }),
  ),
});

export const credentialUsesBody = t.Object({
  runId: t.Optional(t.Integer()),
  messageId: t.Optional(t.Integer()),
  uses: t.Array(
    t.Object({
      credentialId: t.Integer(),
      tool: t.String({ minLength: 1, maxLength: 64 }),
      origin: t.String({ maxLength: 300 }),
    }),
    { maxItems: 50 },
  ),
});

// The login of the calling agent's Claude Code or Codex runtime. The value is only in the
// answer for a run or chat answer the agent holds.
export const RuntimeLoginResponse = t.Object({
  login: t.Nullable(
    t.Object({
      credentialId: t.Number(),
      runtime: LoginRuntime,
      method: LoginMethod,
      value: t.Optional(t.String()),
    }),
  ),
});

// Named when the runner fetches the secrets for one run or chat answer, which records the
// delivery in the audit log.
export const workRefQuery = t.Object({
  runId: t.Optional(t.Numeric()),
  messageId: t.Optional(t.Numeric()),
});

export const SshKeysResponse = t.Object({
  keys: t.Array(
    t.Object({
      id: t.Number(),
      label: t.String(),
      updatedAt: t.String({ description: 'Changes whenever the key pair is regenerated.' }),
      privateKey: t.String(),
    }),
  ),
});
