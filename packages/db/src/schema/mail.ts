// Mail imported over IMAP and sent over SMTP. The worker imports every folder of an
// account into these tables; the raw .eml of a message is a file in STORAGE_ROOT and
// its attachments are files in the vault (PROJECT_VAULT_ROOT).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { approvalRequest, issue, project, team } from './app';
import { user } from './auth';

export interface MailAddressRow {
  name: string;
  address: string;
}

// A file a draft sends: bytes uploaded into STORAGE_ROOT ('storage', ref is the object
// key) or a file of the vault ('vault', ref is the vault-relative path).
export interface MailDraftAttachment {
  source: 'storage' | 'vault';
  ref: string;
  filename: string;
  contentType: string;
  size: number;
}

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// A mailbox Plan imports and sends through. project_id NULL makes it a Home account.
// The password is encrypted with APP_ENCRYPTION_KEY (@repo/crypto) and never returned.
// sync_status is written by the worker: 'importing' until every folder is imported
// once, 'synced' after, 'error' with sync_error while it cannot connect.
export const mailAccount = pgTable(
  'mail_account',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    address: text('address').notNull(),
    imapHost: text('imap_host').notNull(),
    imapPort: integer('imap_port').notNull().default(993),
    imapTls: boolean('imap_tls').notNull().default(true),
    smtpHost: text('smtp_host').notNull(),
    smtpPort: integer('smtp_port').notNull().default(465),
    smtpTls: boolean('smtp_tls').notNull().default(true),
    username: text('username').notNull(),
    passwordCiphertext: text('password_ciphertext'),
    passwordIv: text('password_iv'),
    passwordAuthTag: text('password_auth_tag'),
    enabled: boolean('enabled').notNull().default(true),
    syncTrash: boolean('sync_trash').notNull().default(false),
    syncSpam: boolean('sync_spam').notNull().default(false),
    // New inbox mail is handed to the inbox triage (hub_inbox_event) only when set.
    triageEnabled: boolean('triage_enabled').notNull().default(false),
    syncStatus: text('sync_status').notNull().default('idle'),
    syncError: text('sync_error'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'mail_account_sync_status_check',
      sql`${t.syncStatus} IN ('idle', 'importing', 'synced', 'error')`,
    ),
    unique().on(t.teamId, t.address),
    index('mail_account_project_idx').on(t.projectId),
  ],
);

// One IMAP folder of an account. uid_validity, uid_next and highest_modseq are what
// the last complete pass saw; a pass that finds them unchanged skips the folder.
// A folder with sync false (Trash or Spam while their switch is off) is listed only so
// the archive and delete actions know where to move a message.
export const mailFolder = pgTable(
  'mail_folder',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    role: text('role'),
    sync: boolean('sync').notNull().default(true),
    uidValidity: bigint('uid_validity', { mode: 'number' }),
    uidNext: bigint('uid_next', { mode: 'number' }).notNull().default(0),
    highestModseq: text('highest_modseq'),
    totalCount: integer('total_count').notNull().default(0),
    syncedCount: integer('synced_count').notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'mail_folder_role_check',
      sql`${t.role} IS NULL OR ${t.role} IN ('inbox', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all')`,
    ),
    unique().on(t.accountId, t.path),
  ],
);

// A conversation. project_id NULL means Home. It starts as the account's project or
// the project a routing rule names, and the owner moves it with "Move to project".
// suggested_project_id is a project proposed by the inbox triage for the owner to
// confirm. The last_* columns and snippet copy the newest message for the list.
export const mailThread = pgTable(
  'mail_thread',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    suggestedProjectId: integer('suggested_project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    threadKey: text('thread_key').notNull(),
    subject: text('subject').notNull().default(''),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
    lastFromName: text('last_from_name').notNull().default(''),
    lastFromAddress: text('last_from_address').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.accountId, t.threadKey),
    index('mail_thread_team_idx').on(t.teamId, t.lastMessageAt.desc(), t.id.desc()),
    index('mail_thread_project_idx').on(t.projectId, t.lastMessageAt.desc(), t.id.desc()),
  ],
);

// One message, stored once per account whatever number of folders hold it
// (mail_message_folder). message_id is the normalized Message-ID header. html_body is
// sanitized, with remote images blocked. attachment_folder is the vault folder of its
// attachments. deleted_at is set once no imported folder holds the message any more.
export const mailMessage = pgTable(
  'mail_message',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id')
      .notNull()
      .references(() => mailThread.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    inReplyTo: text('in_reply_to'),
    references: jsonb('references').$type<string[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    fromName: text('from_name').notNull().default(''),
    fromAddress: text('from_address').notNull().default(''),
    toAddresses: jsonb('to_addresses').$type<MailAddressRow[]>().notNull().default([]),
    ccAddresses: jsonb('cc_addresses').$type<MailAddressRow[]>().notNull().default([]),
    bccAddresses: jsonb('bcc_addresses').$type<MailAddressRow[]>().notNull().default([]),
    replyTo: jsonb('reply_to').$type<MailAddressRow[]>().notNull().default([]),
    // Names, addresses, their local parts and domains, for the search vector.
    addressText: text('address_text').notNull().default(''),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    snippet: text('snippet').notNull().default(''),
    textBody: text('text_body').notNull().default(''),
    htmlBody: text('html_body'),
    hasRemoteImages: boolean('has_remote_images').notNull().default(false),
    allowRemoteImages: boolean('allow_remote_images').notNull().default(false),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    attachmentFolder: text('attachment_folder'),
    size: integer('size').notNull().default(0),
    rawKey: text('raw_key').notNull(),
    seen: boolean('seen').notNull().default(false),
    flagged: boolean('flagged').notNull().default(false),
    answered: boolean('answered').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple'::regconfig, coalesce("subject", '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce("from_name", '') || ' ' || coalesce("address_text", '')), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce("text_body", ''), 100000)), 'C')`,
    ),
  },
  (t) => [
    unique().on(t.accountId, t.messageId),
    index('mail_message_thread_idx').on(t.threadId, t.sentAt),
    index('mail_message_attachment_folder_idx').on(t.attachmentFolder),
    index('mail_message_search_idx').using('gin', t.search),
  ],
);

// Which folders hold a message, under which UID. Gmail lists one message in All Mail
// and in the folder of each of its labels.
export const mailMessageFolder = pgTable(
  'mail_message_folder',
  {
    folderId: integer('folder_id')
      .notNull()
      .references(() => mailFolder.id, { onDelete: 'cascade' }),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    messageId: integer('message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.folderId, t.uid] }),
    index('mail_message_folder_message_idx').on(t.messageId),
  ],
);

// A file the sender attached, stored in the vault at vault_path.
export const mailAttachment = pgTable(
  'mail_attachment',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    vaultPath: text('vault_path').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('mail_attachment_message_idx').on(t.messageId)],
);

// A change made in Plan that the worker still has to make on the server: a flag, or a
// move out of the folder (folder_id, uid). The api writes the change to the message
// rows at once; the worker deletes the action once the server has it.
export const mailAction = pgTable(
  'mail_action',
  {
    id: serial('id').primaryKey(),
    accountId: integer('account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    messageId: integer('message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id')
      .notNull()
      .references(() => mailFolder.id, { onDelete: 'cascade' }),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'mail_action_kind_check',
      sql`${t.kind} IN ('seen', 'unseen', 'flag', 'unflag', 'archive', 'trash')`,
    ),
    index('mail_action_account_idx').on(t.accountId, t.id),
  ],
);

// A mail being written in Plan. body_text is the Markdown the editor holds and is sent
// as the text part; body_html is the HTML part. Sending sets status 'queued' with
// send_at ten seconds ahead, which is the time to undo; the worker sends it once due.
// A draft an agent wants sent waits in 'pending_approval' until the owner decides the
// approval request.
export const mailDraft = pgTable(
  'mail_draft',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    accountId: integer('account_id')
      .notNull()
      .references(() => mailAccount.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    threadId: integer('thread_id').references(() => mailThread.id, { onDelete: 'set null' }),
    replyToMessageId: integer('reply_to_message_id').references(() => mailMessage.id, {
      onDelete: 'set null',
    }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'set null' }),
    mode: text('mode').notNull().default('new'),
    toAddresses: jsonb('to_addresses').$type<MailAddressRow[]>().notNull().default([]),
    ccAddresses: jsonb('cc_addresses').$type<MailAddressRow[]>().notNull().default([]),
    bccAddresses: jsonb('bcc_addresses').$type<MailAddressRow[]>().notNull().default([]),
    subject: text('subject').notNull().default(''),
    bodyText: text('body_text').notNull().default(''),
    bodyHtml: text('body_html').notNull().default(''),
    attachments: jsonb('attachments').$type<MailDraftAttachment[]>().notNull().default([]),
    status: text('status').notNull().default('draft'),
    sendAt: timestamp('send_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    approvalRequestId: integer('approval_request_id').references(() => approvalRequest.id, {
      onDelete: 'set null',
    }),
    sentMessageId: text('sent_message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('mail_draft_mode_check', sql`${t.mode} IN ('new', 'reply', 'reply_all', 'forward')`),
    check(
      'mail_draft_status_check',
      sql`${t.status} IN ('draft', 'pending_approval', 'queued', 'sending', 'sent', 'failed')`,
    ),
    index('mail_draft_due_idx').on(t.status, t.sendAt),
    index('mail_draft_team_idx').on(t.teamId, t.updatedAt.desc()),
  ],
);

// Routes new mail by sender to a project: an exact address or a whole domain, for one
// account or (account_id NULL) for every account of the team. An address rule wins over
// a domain rule, and a rule of the account over one of the team.
export const mailRule = pgTable(
  'mail_rule',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    accountId: integer('account_id').references(() => mailAccount.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull(),
    value: text('value').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('mail_rule_match_type_check', sql`${t.matchType} IN ('address', 'domain')`),
    index('mail_rule_team_idx').on(t.teamId),
  ],
);

// Everyone the team exchanged mail with, for recipient autocomplete.
export const mailContact = pgTable(
  'mail_contact',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    name: text('name').notNull().default(''),
    messageCount: integer('message_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.address] })],
);

// A thread a task was made from, or that a task links to.
export const mailThreadIssue = pgTable(
  'mail_thread_issue',
  {
    threadId: integer('thread_id')
      .notNull()
      .references(() => mailThread.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.issueId] }),
    index('mail_thread_issue_issue_idx').on(t.issueId),
  ],
);
