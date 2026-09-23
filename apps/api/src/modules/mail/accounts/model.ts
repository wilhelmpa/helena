import { t } from 'elysia';

const host = t.String({ minLength: 1, maxLength: 253, pattern: '^[A-Za-z0-9.-]+$' });
const port = t.Integer({ minimum: 1, maximum: 65535 });

const connectionFields = {
  imapHost: host,
  imapPort: port,
  imapTls: t.Boolean(),
  smtpHost: host,
  smtpPort: port,
  smtpTls: t.Boolean(),
  username: t.String({ minLength: 1, maxLength: 320 }),
};

export const createAccountBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 100 }),
  address: t.String({ format: 'email', maxLength: 320 }),
  projectId: t.Nullable(t.Integer({ minimum: 1 })),
  ...connectionFields,
  // Stored as a new secret of the Credentials page, labelled "Mail: <address>".
  password: t.Optional(t.String({ minLength: 1, maxLength: 1000 })),
  // A secret of the Credentials page holding the password, instead of typing it.
  credentialId: t.Optional(t.Integer({ minimum: 1 })),
  enabled: t.Optional(t.Boolean()),
  syncTrash: t.Optional(t.Boolean()),
  syncSpam: t.Optional(t.Boolean()),
});

// A password left out keeps the stored one; a new one replaces the value of its secret.
export const updateAccountBody = t.Partial(createAccountBody);

export const testConnectionBody = t.Object({
  ...connectionFields,
  password: t.Optional(t.String({ minLength: 1, maxLength: 1000 })),
  // Without a password: the value of this secret, else the stored password of the account.
  credentialId: t.Optional(t.Integer({ minimum: 1 })),
  accountId: t.Optional(t.Integer({ minimum: 1 })),
});

export const TestConnectionResponse = t.Object({
  // null when the server accepted the login, else what went wrong.
  imap: t.Nullable(t.String()),
  smtp: t.Nullable(t.String()),
});

export const MailAccountResponse = t.Object({
  id: t.Number(),
  teamId: t.Number(),
  projectId: t.Nullable(t.Number()),
  projectKey: t.Nullable(t.String()),
  projectName: t.Nullable(t.String()),
  name: t.String(),
  address: t.String(),
  imapHost: t.String(),
  imapPort: t.Number(),
  imapTls: t.Boolean(),
  smtpHost: t.String(),
  smtpPort: t.Number(),
  smtpTls: t.Boolean(),
  username: t.String(),
  hasPassword: t.Boolean(),
  credentialId: t.Nullable(t.Number()),
  credentialLabel: t.Nullable(t.String()),
  enabled: t.Boolean(),
  syncTrash: t.Boolean(),
  syncSpam: t.Boolean(),
  syncStatus: t.Union([
    t.Literal('idle'),
    t.Literal('importing'),
    t.Literal('synced'),
    t.Literal('error'),
  ]),
  syncError: t.Nullable(t.String()),
  lastSyncAt: t.Nullable(t.String()),
  // Messages imported of those the server holds, over the imported folders.
  progress: t.Object({ synced: t.Number(), total: t.Number() }),
});

export const MailAccountListResponse = t.Array(MailAccountResponse);

export const accountParams = t.Object({ teamId: t.Numeric(), accountId: t.Numeric() });

export const MailRuleResponse = t.Object({
  id: t.Number(),
  accountId: t.Nullable(t.Number()),
  matchType: t.Union([t.Literal('address'), t.Literal('domain')]),
  value: t.String(),
  projectId: t.Number(),
  projectKey: t.String(),
  projectName: t.String(),
});

export const MailRuleListResponse = t.Array(MailRuleResponse);

export const createRuleBody = t.Object({
  accountId: t.Nullable(t.Integer({ minimum: 1 })),
  matchType: t.Union([t.Literal('address'), t.Literal('domain')]),
  value: t.String({ minLength: 3, maxLength: 320 }),
  projectId: t.Integer({ minimum: 1 }),
  // Moves the threads that already match into the project too.
  applyToExisting: t.Optional(t.Boolean()),
});

export const CreateRuleResponse = t.Object({
  rule: MailRuleResponse,
  movedThreads: t.Number(),
});

export const ruleParams = t.Object({ teamId: t.Numeric(), ruleId: t.Numeric() });
