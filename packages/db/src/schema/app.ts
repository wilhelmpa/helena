// Task planner tables: projects, workflow columns, issue types, labels, custom
// fields, issues, and their dependent rows. Exposed to the web app over HTTP by
// the API.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  smallint,
  check,
  type AnyPgColumn,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

// Global key-value settings for the instance, not scoped to a project. The value is
// a jsonb blob owned by whatever feature reads the key, so one table backs many
// settings.
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const helenaPaperOrderIntent = pgTable(
  'helena_paper_order_intent',
  {
    accountId: text('account_id').notNull(),
    clientOrderId: text('client_order_id').notNull(),
    requestHash: text('request_hash').notNull(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    state: text('state').notNull().default('uncertain'),
    brokerOrder: jsonb('broker_order'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.clientOrderId] }),
    index('helena_paper_order_intent_account_state_idx').on(t.accountId, t.state),
    check(
      'helena_paper_order_intent_state_check',
      sql`${t.state} IN ('uncertain', 'active', 'terminal')`,
    ),
  ],
);

// Instance-wide secrets, the encrypted counterpart of app_setting. One row per key
// (e.g. 'auth.email' for the instance mail provider); the value is a JSON blob
// encrypted as a whole, so a key can hold several credentials. `redacted` mirrors the
// same blob with every secret replaced by a boolean, for the settings UI to read
// without decrypting. Encryption is AES-256-GCM with APP_ENCRYPTION_KEY — changing
// that env value makes stored rows undecryptable.
export const appSecret = pgTable('app_secret', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  redacted: jsonb('redacted').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A team owns projects and holds its own member list. Every account is given one at
// registration, named after its username, and every project belongs to exactly one
// team.
export const team = pgTable('team', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  agentContextLimits: jsonb('agent_context_limits').notNull().default({}),
  // Whether the team is reachable through the MCP server at all. Off closes both the
  // team's own resources (agents, skills, tools, roles, integrations) and every
  // project it owns, whatever each project's own flag says.
  mcpEnabled: boolean('mcp_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Team membership and the role it carries. The roles are fixed, unlike the
// per-project ones: 'owner' is the account the team was created for, 'manager' and
// 'member' are the ranks below it, and 'agent' is the bot user of an ai_agent — it
// belongs to the team and shows up in its member list, but never manages it, so the
// owner and manager guards stay closed to it. What an agent may do comes from
// ai_agent.role_id, not from this column.
export const teamMember = pgTable(
  'team_member',
  {
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    // How this membership came about, read the same way as project_member.source:
    // 'scim' is a row the SCIM group reconciliation created and therefore owns, so
    // deprovisioning removes it again; everything else is 'invite' and a sync never
    // touches it.
    source: text('source').notNull().default('invite'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    check('team_member_role_check', sql`${t.role} IN ('owner', 'manager', 'member', 'agent')`),
    check('team_member_source_check', sql`${t.source} IN ('invite', 'scim')`),
    index('team_member_user_idx').on(t.userId),
  ],
);

// A project groups its own columns, issue types, labels, custom fields, and
// issues. next_sequence is the atomic counter behind each issue's human
// identifier (e.g. "MKT-42"): incrementing it under a row lock keeps concurrent
// creates from colliding.
export const project = pgTable(
  'project',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    // The instance's one Home root is a project with a distinct role. Other projects
    // retain their ordinary project permissions and lifecycle.
    projectRole: text('project_role').notNull().default('project'),
    description: text('description').notNull().default(''),
    nextSequence: integer('next_sequence').notNull().default(1),
    // Whether this project is in the team's MCP reach. Managed from the team's MCP
    // settings, not from the project, and only counts while team.mcp_enabled is on.
    // The starting value is the instance-wide project default set in god mode.
    mcpEnabled: boolean('mcp_enabled').notNull().default(false),
    // Optional sections of the app, toggled per project in Settings -> Features. All
    // on by default. Turning one off only hides its UI; the rows it owns stay and
    // come back with it.
    initiativesEnabled: boolean('initiatives_enabled').notNull().default(true),
    dashboardsEnabled: boolean('dashboards_enabled').notNull().default(true),
    documentsEnabled: boolean('documents_enabled').notNull().default(true),
    notesEnabled: boolean('notes_enabled').notNull().default(true),
    cyclesEnabled: boolean('cycles_enabled').notNull().default(true),
    subtasksEnabled: boolean('subtasks_enabled').notNull().default(true),
    checklistsEnabled: boolean('checklists_enabled').notNull().default(true),
    issueStatsEnabled: boolean('issue_stats_enabled').notNull().default(true),
    // Which kinds of estimate the issues of this project carry, set in Settings ->
    // Configuration. Both off by default; turning one off hides its UI and keeps the
    // values, which show again when it is turned back on.
    pointsEstimateEnabled: boolean('points_estimate_enabled').notNull().default(false),
    timeEstimateEnabled: boolean('time_estimate_enabled').notNull().default(false),
    // Whether members log the time they spend on the issues of this project, set in
    // the same place. Independent of the time estimate: a team can log time without
    // estimating first. Turning it off hides the entries and keeps them.
    timeLoggingEnabled: boolean('time_logging_enabled').notNull().default(false),
    // Deprecated: the project's budgets live in helena_budget since the Autopilot
    // migration, which copied this value there. Nothing reads or writes it any more; the
    // column goes with the rename step.
    monthlyTokenCeiling: bigint('monthly_token_ceiling', { mode: 'number' }),
    // How independently the agents of this project act (Helena's Autopilot): 0 they only
    // propose, 1 consequential actions need approval, 2 they act and report and only
    // outward or risky actions need approval, 3 autonomous within the budget. An agent may
    // carry a stricter level of its own (ai_agent.autopilot_level).
    autopilotLevel: smallint('autopilot_level').notNull().default(3),
    // The fields the project's task views show by default (a project admin saved them from
    // a view's "Felder" control): the property keys per layout, e.g. { kanban: ['id',
    // 'priority'] }. Null while the project keeps the built-in or the member's own default.
    displayDefaults: jsonb('display_defaults').$type<Record<string, string[]>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('project_role_check', sql`${t.projectRole} IN ('project', 'home')`),
    uniqueIndex('project_one_home_uq')
      .on(t.projectRole)
      .where(sql`${t.projectRole} = 'home'`),
  ],
);

// Durable handoff to the external project provisioner. A row is inserted in the
// same transaction as its project, then claimed and delivered by the worker. The
// stable UUID lets the receiver make resource creation idempotent across retries.
export const projectProvisioningJob = pgTable(
  'project_provisioning_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    requestedResources: jsonb('requested_resources').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    result: jsonb('result'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('project_provisioning_job_project_unique').on(t.projectId),
    check(
      'project_provisioning_job_status_check',
      sql`${t.status} IN ('pending', 'succeeded', 'failed')`,
    ),
    index('project_provisioning_job_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// Durable cleanup request created in the same transaction that deletes a project.
// It keeps the project identity after the project row and its provisioning job have
// cascaded away, but contains no credentials or global runtime paths.
export const projectDeprovisioningJob = pgTable(
  'project_deprovisioning_job',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: integer('project_id').notNull(),
    project: jsonb('project')
      .$type<{ id: number; teamId: number; key: string; name: string; description: string }>()
      .notNull(),
    requestedResources: jsonb('requested_resources').$type<string[]>().notNull().default([]),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    result: jsonb('result'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('project_deprovisioning_job_project_unique').on(t.projectId),
    check(
      'project_deprovisioning_job_status_check',
      sql`${t.status} IN ('pending', 'succeeded', 'failed')`,
    ),
    index('project_deprovisioning_job_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// Per-project key-value settings, mirroring app_setting but scoped to a project.
// The value is a jsonb blob owned by whatever feature reads the key, so one table
// backs many project settings (e.g. auto-archive thresholds under key
// 'auto_archive'). Composite PK (project_id, key).
export const projectSetting = pgTable(
  'project_setting',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.key] })],
);

// A user's own interface preferences, held per account rather than per project so
// the same choices apply on every device. timezone is an IANA zone name used by the
// web app to render stored UTC timestamps; the API keeps storing and returning UTC.
// locale is the interface language, also used for the emails and the Telegram bot
// messages this user receives; it has no CHECK, unlike the columns below, so adding a
// language costs no migration.
// theme is 'light' | 'dark' | 'system', issue_open_mode is 'panel' | 'page' (how a
// clicked issue opens), start_page is the section the app root lands on. Absent row
// means the user has not changed anything and the defaults below apply.
// last_project_id is the project the user was in last, so the app root reopens it
// after signing in on any device; the FK clears it when that project is deleted.
// show_chat_by_default keeps the floating AI chat button on screen from the start,
// with the chat window collapsed. hotkeys holds the keyboard shortcuts this user
// rebound. issue_stats_open and issue_stats_view are how the status stats section of
// an issue starts out: expanded or collapsed, and 'compact' (one bar per status) or
// 'timeline' (a lane per status on a time axis). issue_activity_view is how the
// activity log below it starts out: 'flat' (every entry newest first) or 'grouped'
// (a block per stretch the issue spent in a status). Switching either on an issue is
// not stored — it lasts as long as that issue stays open. auto_watch is whether the
// user is subscribed to the issues they create, are assigned, comment on or are
// mentioned in (see issue_watcher); off means they only ever subscribe by hand.
export const userPreference = pgTable(
  'user_preference',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('system'),
    issueOpenMode: text('issue_open_mode').notNull().default('panel'),
    // 'single' merges the app header and the page's view tabs/filters into the one
    // row docs/volition-design-helena-ui.md calls for, and moves the language/theme/
    // account controls into the sidebar footer; 'classic' is today's two-row header
    // with those controls in it, kept as a full fallback (an owner decision, not a
    // deprecation: see CLAUDE.md).
    headerLayout: text('header_layout').notNull().default('single'),
    startPage: text('start_page').notNull().default('work-items'),
    showChatByDefault: boolean('show_chat_by_default').notNull().default(false),
    issueStatsOpen: boolean('issue_stats_open').notNull().default(true),
    issueStatsView: text('issue_stats_view').notNull().default('compact'),
    issueActivityView: text('issue_activity_view').notNull().default('flat'),
    autoWatch: boolean('auto_watch').notNull().default(true),
    // The user's own keyboard shortcut overrides, as { hotkeyId: combo }. Only the
    // bindings they changed are stored; the rest come from the instance defaults
    // (app_setting key 'hotkeys') and then the built-in ones.
    hotkeys: jsonb('hotkeys').$type<Record<string, string>>(),
    lastProjectId: integer('last_project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    // Start as this user arranged it (docs/helena-decisions/dashboard.md): the order of its
    // widgets, the ones hidden, the ones shown although off by default, and the failures of
    // "Braucht dich" they hid. Null until they change anything; widget ids only.
    homeDashboard: jsonb('home_dashboard').$type<{
      order: string[];
      hidden: string[];
      shown: string[];
      dismissed: string[];
    }>(),
    // The release whose "what's new" screen this user has closed. Null until they
    // close one, which is what an account created before the screen existed reads as.
    seenVersion: text('seen_version'),
    // The fields the member's task views show by default in every project without a
    // default of its own, per layout: { table: ['priority', 'dueDate'] }. Null until saved.
    fieldDefaults: jsonb('field_defaults').$type<Record<string, string[]>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('user_preference_theme_check', sql`${t.theme} IN ('light', 'dark', 'system')`),
    check('user_preference_issue_open_mode_check', sql`${t.issueOpenMode} IN ('panel', 'page')`),
    check('user_preference_header_layout_check', sql`${t.headerLayout} IN ('single', 'classic')`),
    check(
      'user_preference_start_page_check',
      sql`${t.startPage} IN ('inbox', 'dashboard', 'work-items', 'initiatives')`,
    ),
    check(
      'user_preference_issue_stats_view_check',
      sql`${t.issueStatsView} IN ('compact', 'timeline')`,
    ),
    check(
      'user_preference_issue_activity_view_check',
      sql`${t.issueActivityView} IN ('flat', 'grouped')`,
    ),
  ],
);

// Custom roles per team, shared by every project the team owns. A role carries a
// permission matrix: for each resource (work_items, dashboards, ...) the
// create/edit/read/delete flags. The matrix is a jsonb blob owned and enforced by
// the API (see apps/api/src/shared/permissions.ts). Exactly one role per team is
// the default ("Member"): it is assigned to members that join through an invite
// and is the fallback for a member row with no explicit role. Owners bypass roles
// entirely (they always have full access), so their project_member.role_id stays
// NULL. A member of a project may only be put on a role of that project's team;
// the API checks it, no foreign key can.
export const teamRole = pgTable(
  'team_role',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    permissions: jsonb('permissions').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    // At most one default role per team.
    uniqueIndex('team_role_default_uq')
      .on(t.teamId)
      .where(sql`${t.isDefault}`),
    index('team_role_team_idx').on(t.teamId),
  ],
);

// Project membership: which users can access a project and their role in it.
// A user reaches a project's columns, issues, labels, and every other
// project-scoped entity only through a row here. The creator is inserted as
// "owner"; a project can have several owners. Owners always have full access and
// manage the member list. A "member" row carries role_id pointing at a
// team_role of the project's team, whose permission matrix decides what that member
// may do; a NULL role_id falls back to the team's default role. Access checks resolve
// the owning project of any entity and look for the current user here.
export const projectMember = pgTable(
  'project_member',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    roleId: integer('role_id').references(() => teamRole.id, {
      onDelete: 'set null',
    }),
    // What this member does in the project. Free text set by an owner, shown on the
    // members page and given to agents so they can pick who to tag on an unassigned
    // issue. Empty string when unset.
    description: text('description').notNull().default(''),
    // How this membership came about. 'invite' is a person accepting an invite;
    // 'scim' is a row the SCIM group reconciliation created and therefore owns —
    // it only ever updates or removes its own rows, so a sync never undoes a
    // membership someone set up by hand.
    source: text('source').notNull().default('invite'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    check('project_member_role_check', sql`${t.role} IN ('owner', 'member')`),
    check('project_member_source_check', sql`${t.source} IN ('invite', 'scim')`),
    index('project_member_user_project_idx').on(t.userId, t.projectId),
  ],
);

// An invite is a token-addressed grant of membership: always into a team, and, when
// it names a project, straight into that project too. team_role is the rank the
// invitee joins the team on; project_role is whether they own or belong to the
// project, and role_id the team role a project member works under. Accepting creates
// the team_member row, plus the project_member row when a project is named; an
// invitee already in the team keeps the rank they have. At most one pending invite
// per email into a team and per email into a project. email is stored lowercased.
// Revoking a pending invite removes its row.
export const teamInvite = pgTable(
  'team_invite',
  {
    id: serial('id').primaryKey(),
    token: uuid('token').notNull().defaultRandom().unique(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // NULL for an invite into the team alone.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // An invite that names a project always brings its invitee into the team as a
    // plain member; a rank above that is granted by an invite into the team itself.
    teamRole: text('team_role').notNull().default('member'),
    projectRole: text('project_role'),
    // The team role the invitee joins the project on when project_role is "member".
    // NULL falls back to the team's default role. Project owners bypass roles, so an
    // owner invite keeps this NULL.
    roleId: integer('role_id').references(() => teamRole.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('pending'),
    invitedByUserId: text('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    acceptedByUserId: text('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    check('team_invite_team_role_check', sql`${t.teamRole} IN ('owner', 'manager', 'member')`),
    check(
      'team_invite_project_role_check',
      sql`(${t.projectId} IS NULL AND ${t.projectRole} IS NULL)
        OR (${t.projectId} IS NOT NULL AND ${t.projectRole} IN ('owner', 'member'))`,
    ),
    check('team_invite_status_check', sql`${t.status} IN ('pending', 'accepted', 'rejected')`),
    uniqueIndex('team_invite_team_pending_uq')
      .on(t.teamId, t.email)
      .where(sql`${t.status} = 'pending' AND ${t.projectId} IS NULL`),
    uniqueIndex('team_invite_project_pending_uq')
      .on(t.projectId, t.email)
      .where(sql`${t.status} = 'pending' AND ${t.projectId} IS NOT NULL`),
    index('team_invite_team_idx').on(t.teamId),
    index('team_invite_project_idx').on(t.projectId),
  ],
);

export const projectColumn = pgTable(
  'project_column',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    stateType: text('state_type').notNull().default('unstarted'),
    color: text('color').notNull().default('#6b7280'),
    position: integer('position').notNull(),
    // The work-in-progress limit: how many issues the column should hold. NULL is
    // no limit, which is what every column starts as. wipMode decides what happens
    // at the limit — 'soft' only warns, 'hard' refuses further issues — and is only
    // read when wipLimit is set.
    wipLimit: integer('wip_limit'),
    wipMode: text('wip_mode').notNull().default('soft'),
    // The member an issue is assigned to when it enters this column, replacing
    // whoever held it. NULL leaves the assignee alone.
    autoAssignUserId: text('auto_assign_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'project_column_state_type_check',
      sql`${t.stateType} IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')`,
    ),
    check('project_column_wip_mode_check', sql`${t.wipMode} IN ('soft', 'hard')`),
    check('project_column_wip_limit_check', sql`${t.wipLimit} IS NULL OR ${t.wipLimit} > 0`),
    unique().on(t.projectId, t.position),
  ],
);

export const issueType = pgTable(
  'issue_type',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default(''),
    color: text('color').notNull().default('#6b7280'),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

// Optional container a label can belong to. A label has at most one group;
// deleting a group ungroups its labels (label.groupId -> SET NULL).
export const labelGroup = pgTable(
  'label_group',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6b7280'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

export const label = pgTable(
  'label',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    groupId: integer('group_id').references(() => labelGroup.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    color: text('color').notNull().default('#6b7280'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

// AI agents owned by a team. Each agent is backed by a hidden bot user
// (user_id -> user.id): that user is what a work item is delegated to, what a
// comment/activity is authored by, and what owns the agent's API key (better-auth
// apikey.reference_id points at it). An agent is driven by a runner that holds that
// key; Helena itself never runs a model. Which projects
// of the team an agent works in is its project_member rows, written by the routes
// that attach it; what it may do there is the intersection of the tools it is
// granted and the role that membership carries, which is per project like a
// person's.
export const aiAgent = pgTable(
  'ai_agent',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    // Home is an explicit identity; its handle remains a mention address only.
    agentRole: text('agent_role').notNull().default('agent'),
    // Membership rows still enforce the per-project permission matrix. `all` keeps
    // the agent attached when another project of its team is created.
    projectScope: text('project_scope').notNull().default('selected'),
    // Always 'external': the one kind left once the in-process runtime was removed.
    // Kept so the rows and the clients that name it read the same shape.
    kind: text('kind').notNull(),
    // The model ref the agent's runtime runs on (null: the runtime's own default) and
    // the operator's instructions, both projected into the runtime by its runner.
    model: text('model'),
    instructions: text('instructions'),
    // Run triggers. A mention in a comment enqueues a run when
    // trigger_on_mention is set; being set as an issue's delegate enqueues one when
    // trigger_on_assign is set.
    triggerOnMention: boolean('trigger_on_mention').notNull().default(true),
    triggerOnAssign: boolean('trigger_on_assign').notNull().default(false),
    heartbeatIntervalMinutes: integer('heartbeat_interval_minutes'),
    heartbeatTimezone: text('heartbeat_timezone').notNull().default('UTC'),
    heartbeatDays: jsonb('heartbeat_days').notNull().default([1, 2, 3, 4, 5]).$type<number[]>(),
    heartbeatStart: text('heartbeat_start').notNull().default('09:00'),
    heartbeatEnd: text('heartbeat_end').notNull().default('17:00'),
    heartbeatInstructions: text('heartbeat_instructions').notNull().default(''),
    heartbeatLastAt: timestamp('heartbeat_last_at', { withTimezone: true }),
    heartbeatNextAt: timestamp('heartbeat_next_at', { withTimezone: true }),
    // How long a delegation run waits before it becomes claimable, which leaves time
    // to keep editing the issue after delegating it. Applies to delegation only: a
    // mention is a question already asked, and its author waits for the reply.
    delegationDelaySec: integer('delegation_delay_sec').notNull().default(120),
    // How many of this agent's chats a member may leave answering at once. The
    // composer checks it before sending, and sendMessage refuses (409) past it, so a
    // runner already carrying its share of a member's turns is not asked to
    // interleave more than the owner decided it should.
    maxConcurrentChats: integer('max_concurrent_chats').notNull().default(3),
    // Runtime-owned policy. The agent row stays the single control-plane record; the
    // agent's runner projects this non-secret
    // policy into its mapped runtime. File contents are limited and validated by the
    // API before they reach this JSON document.
    runtimePolicy: jsonb('runtime_policy').notNull().default({}),
    // Latest non-secret adapter report. This is operational state, not a second
    // configuration store: external runners such as Hermes use the same shape.
    runtimeState: jsonb('runtime_state').notNull().default({}),
    // The content of the skills the agent created in its runtime, from the same report.
    // Kept apart from runtime_state, which every read of the agent returns.
    runtimeLearnedSkills: jsonb('runtime_learned_skills').notNull().default([]),
    volitionLearnedSkills: jsonb('volition_learned_skills').notNull().default([]),
    // The member who created the agent. An external agent's runner authenticates
    // with the agent's key, so `owner` scope means the runner only receives runs
    // this member triggered; `team` scope, the default, means any member's.
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    runnerScope: text('runner_scope').notNull().default('team'),
    // A template runs nowhere and joins no project. A project adds a copy of it as a
    // specialist of its own.
    template: boolean('template').notNull().default(false),
    // The template this row was copied from (copyTemplateIntoProject), kept so a later
    // edit to the template can be synced into this copy. NULL for a template itself and
    // for an agent nobody copied. set null on the template's deletion: the copy keeps
    // working, it just stops following a (now gone) template.
    sourceTemplateId: integer('source_template_id').references((): AnyPgColumn => aiAgent.id, {
      onDelete: 'set null',
    }),
    // Field groups (see agents/core/template-sync.ts TEMPLATE_FIELD_GROUPS) this copy's
    // owner changed by hand after the copy was made. A synced field is skipped for this
    // copy the next time its template changes, until "reset to template" clears it.
    // Meaningless (stays []) for a template itself.
    templateOverrides: jsonb('template_overrides').notNull().default([]).$type<string[]>(),
    // Last time this copy was synced from its template (creation counts as the first
    // sync). NULL for a template itself and for an agent nobody copied.
    templateSyncedAt: timestamp('template_synced_at', { withTimezone: true }),
    // Last time a runner claimed work or sent a heartbeat for this agent, which is
    // what the UI shows as its presence. NULL for an agent no runner ever polled.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    // Set while the agent takes no new work: its queued runs and chat answers wait, a
    // mention or a delegation starts nothing, and an agent-team stage is refused.
    // pause_reason says why, whether a member paused it or a token ceiling did.
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pauseReason: text('pause_reason'),
    // Deprecated: the agent's budgets live in helena_budget since the Autopilot
    // migration, which copied these values there. Nothing reads or writes them any more;
    // the columns go with the rename step.
    dailyTokenCeiling: bigint('daily_token_ceiling', { mode: 'number' }),
    monthlyTokenCeiling: bigint('monthly_token_ceiling', { mode: 'number' }),
    // The agent's own Autopilot level; null follows the project's. The stricter of the two
    // applies, unless the owner set autopilot_raise, which lets this level exceed the
    // project's.
    autopilotLevel: smallint('autopilot_level'),
    autopilotRaise: boolean('autopilot_raise').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_agent_team_username_uq').on(t.teamId, sql`lower(${t.username})`),
    check('ai_agent_role_check', sql`${t.agentRole} IN ('agent', 'home')`),
    check('ai_agent_project_scope_check', sql`${t.projectScope} IN ('selected', 'all')`),
    uniqueIndex('ai_agent_one_home_uq')
      .on(t.agentRole)
      .where(sql`${t.agentRole} = 'home'`),
    unique().on(t.userId),
    check('ai_agent_kind_check', sql`${t.kind} = 'external'`),
    check(
      'ai_agent_autopilot_level_check',
      sql`${t.autopilotLevel} IS NULL OR ${t.autopilotLevel} BETWEEN 0 AND 3`,
    ),
    check('ai_agent_runner_scope_check', sql`${t.runnerScope} IN ('owner', 'team')`),
    check(
      'ai_agent_heartbeat_interval_check',
      sql`${t.heartbeatIntervalMinutes} IS NULL OR ${t.heartbeatIntervalMinutes} BETWEEN 5 AND 10080`,
    ),
    check(
      'ai_agent_delegation_delay_check',
      sql`${t.delegationDelaySec} >= 0 AND ${t.delegationDelaySec} <= 86400`,
    ),
    check(
      'ai_agent_max_concurrent_chats_check',
      sql`${t.maxConcurrentChats} >= 1 AND ${t.maxConcurrentChats} <= 20`,
    ),
    index('ai_agent_team_idx').on(t.teamId),
    index('ai_agent_source_template_idx').on(t.sourceTemplateId),
    check(
      'ai_agent_template_no_source_check',
      sql`NOT (${t.template} AND ${t.sourceTemplateId} IS NOT NULL)`,
    ),
  ],
);

// A cheap heartbeat check leaves one record whether it queued a model run or skipped it.
export const agentHeartbeatEvent = pgTable(
  'agent_heartbeat_event',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    runId: integer('run_id'),
  },
  (t) => [
    check('agent_heartbeat_event_outcome_check', sql`${t.outcome} IN ('queued', 'skipped')`),
    index('agent_heartbeat_event_agent_idx').on(t.agentId, t.checkedAt.desc()),
  ],
);

// Queued autonomous runs of an agent. Mentions and delegations carry an issue; manual
// runs do not, and an approval decision carries the issue of its request when it has
// one. The agent's runner claims due rows with a lease, runs the agent, and records the
// result for history and retries.
export const agentRun = pgTable(
  'agent_run',
  {
    id: serial('id').primaryKey(),
    rootOrigin: text('root_origin').notNull().default('system'),
    observedRuntime: text('observed_runtime'),
    taintSources: jsonb('taint_sources').$type<string[]>().notNull().default([]),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    // The project the run works in, taken from what triggered it: the issue for a
    // mention or a delegation, the call for a manual one. Stored on the row so the run
    // keeps its project after the agent leaves that project, and so the worker hands
    // one to the runtime without reading the agent.
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    // 'schedule' only marks older runs; nothing queues one any more.
    trigger: text('trigger').notNull().default('delegation'),
    // The comment that mentioned the agent, kept for traceability. The prompt is
    // snapshotted into `prompt` so a run still works if the comment is later deleted.
    sourceActivityId: integer('source_activity_id').references(() => issueActivity.id, {
      onDelete: 'set null',
    }),
    // The mention comment body at enqueue time, framed into the agent's prompt.
    prompt: text('prompt').notNull(),
    // pending -> success | failed | canceled. Like webhook_delivery, a claim keeps the row
    // 'pending' and pushes next_attempt_at forward by a lease, so a run whose poller
    // crashes mid-flight becomes claimable again after the lease expires.
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    output: text('output'),
    // What the run read, cache included, and wrote: the totals of every model call of the
    // run where the agent reports them (the Hermes runner does), otherwise the last model
    // call. Null for a run that finished before this was recorded, and for one whose agent
    // reports no counts; the run history shows nothing for either.
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    // The limits the runner hands to the agent's command for this run: tool-calling
    // iterations and wall-clock seconds. Null takes the agent's runtime policy default.
    maxTurns: integer('max_turns'),
    runBudgetSeconds: integer('run_budget_seconds'),
    // The model of this run when a workflow step overrides the agent's own. Null runs
    // the agent's model.
    model: text('model'),
    // The reasoning effort of this run when it overrides the agent's own (a digest run of
    // the update center). Null runs the agent's.
    reasoning: text('reasoning'),
    // The kind of work the run is for Lokale KI (a task class of @helena/sdk
    // localAiTaskClasses: `summaries` for a digest, `routines` for a routine's task,
    // `coordinator-triage` for a coordinator's first plan). While the class runs locally the
    // claim hands the run the class's local model; otherwise, and whenever the local server
    // does not answer, it runs on `model` (or the agent's), exactly as without local AI
    // (docs/helena-decisions/local-ai-platform.md §7.1). Null for all other work.
    workClass: text('work_class'),
    // The question the agent asked when it reported itself blocked during the run. A
    // blocked run ends as a success: the agent did what it could and waits for input.
    blockedQuestion: text('blocked_question'),
    // The Autopilot level that applied when the run was claimed.
    autopilotLevel: smallint('autopilot_level'),
    // The model and reasoning the run was configured to use next to what its session
    // really ran on, as the runner read them back, with any mismatch named. Null for a run
    // whose runner reports neither.
    modelCheck: jsonb('model_check'),
    // Why the run failed, where the runtime's words said (@helena/sdk RuntimeFailure: a
    // model the provider does not serve this account, a refusal no retry passes). A
    // failure that is not retryable is never run again, by the queue or the engine.
    failure: jsonb('failure'),
    // The follow-up turn in which the agent kept what the run taught it, when Plan asked
    // its runner for one: why, how it went, what it saved and what it cost. Its tokens are
    // also added to the run's own.
    reflection: jsonb('reflection'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    // Every claim by a runner counts one up, and nothing counts it down: the runner names
    // it on its heartbeats and its result, so one whose run was claimed since is refused.
    // `attempts` cannot do this, since a release and a replayed stage lower it.
    claims: integer('claims').notNull().default(0),
    // When the latest claim was made, which is when the run's current attempt started.
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // The coding agent session of this run, saved as soon as the runner reads it off the
    // command's own output rather than only at the end. A claim after a runner died mid
    // run resumes this session instead of starting over, as long as `resumes` is under
    // the instance's limit.
    sessionId: text('session_id'),
    // How many times this run has been resumed in the same session after an interruption.
    // Distinct from `attempts`, which a release or a replayed stage lowers; this only
    // grows, and is what the instance's resume limit checks.
    resumes: integer('resumes').notNull().default(0),
    // The run whose session this one continues with a new instruction ("continue from
    // here"). Its first claim sends that instruction instead of the resume prompt.
    continuedFromRunId: integer('continued_from_run_id').references(
      (): AnyPgColumn => agentRun.id,
      {
        onDelete: 'set null',
      },
    ),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // A run is never deleted to tidy up: a finished run that should leave the lists (a
    // failure that was dealt with, a test) is archived. Lists and counts leave archived runs
    // out unless asked for them; the history and the statistics keep them.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'agent_run_status_check',
      sql`${t.status} IN ('pending', 'success', 'failed', 'canceled')`,
    ),
    check(
      'agent_run_trigger_check',
      sql`${t.trigger} IN ('mention', 'delegation', 'subtask', 'field', 'schedule', 'manual', 'approval', 'workspace', 'digest', 'heartbeat', 'escalation')`,
    ),
    index('agent_run_due_idx').on(t.status, t.nextAttemptAt),
    index('agent_run_project_idx').on(t.projectId),
    // The token ceilings sum an agent's runs of the current day and month.
    index('agent_run_agent_finished_idx').on(t.agentId, t.finishedAt),
  ],
);

// Every agent_run row that is deleted anyway, kept whole. A run goes when its agent, its
// project or its ticket is deleted (the foreign keys cascade), or when someone deletes it
// by hand; a trigger on agent_run (migration 0208) copies the row here first, so failures
// and counts stay honest (code audit 2026-09-28: ~120 of 293 runs were gone). Nothing
// reads it in the product yet: counts over all runs ever made union agent_run with it.
export const helenaAgentRunTombstone = pgTable(
  'helena_agent_run_tombstone',
  {
    runId: integer('run_id').primaryKey(),
    agentId: integer('agent_id'),
    projectId: integer('project_id'),
    issueId: integer('issue_id'),
    status: text('status').notNull(),
    trigger: text('trigger').notNull(),
    lastError: text('last_error'),
    failure: jsonb('failure'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // The whole row as it was (to_jsonb), columns added later included.
    row: jsonb('row').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
    // The database role and application that deleted it.
    deletedBy: text('deleted_by'),
  },
  (t) => [
    index('helena_agent_run_tombstone_project_idx').on(t.projectId),
    index('helena_agent_run_tombstone_agent_idx').on(t.agentId, t.finishedAt),
  ],
);

// One execution lease per task, shared by heartbeats, routines and delegated runs.
// The run claim number fences an old runner after its lease expires.
export const issueWorkClaim = pgTable(
  'issue_work_claim',
  {
    issueId: integer('issue_id')
      .primaryKey()
      .references(() => issue.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    claim: integer('claim').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('issue_work_claim_expiry_idx').on(t.expiresAt)],
);

// What the egress proxy of isolated agents (deployment/volition-stack/isolation) let
// through or refused, summed per unit, destination and decision over a short window. It
// names hosts and counts bytes; it never holds what was sent. The agent and the run come
// from the unit the proxy saw the connection come from, so they are null for work that
// ran outside a run (a chat answer names its message in the unit, not here).
export const agentEgressEvent = pgTable(
  'agent_egress_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // The slug of the Unix user the connection came from: a project's, or 'home' for the
    // Home agent, which works in no project of its own (project_id is null then).
    slug: text('slug').notNull(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    // 'allowed' or 'blocked'; `reason` says why a connection was refused.
    decision: text('decision').notNull(),
    reason: text('reason'),
    connections: integer('connections').notNull().default(1),
    bytesOut: bigint('bytes_out', { mode: 'number' }).notNull().default(0),
    bytesIn: bigint('bytes_in', { mode: 'number' }).notNull().default(0),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_egress_event_decision_check', sql`${t.decision} IN ('allowed', 'blocked')`),
    check('agent_egress_event_port_check', sql`${t.port} >= 0 AND ${t.port} <= 65535`),
    index('agent_egress_event_project_idx').on(t.projectId, t.id),
    index('agent_egress_event_last_idx').on(t.lastAt),
    index('agent_egress_event_run_idx').on(t.runId),
  ],
);

// The browser gateway's own audit trail (design: docs/volition-design-browser-gateway.md §5,
// §9): every tool call the gateway ran for a project browser, without any value it saw —
// login fill/2FA are logged through integration_credential_use instead (label and origin,
// never the secret), because they already had that audit and it is agent-scoped there too.
// `target` is a short, non-secret label the tool itself chose: a tab title, an origin, a
// file name, never a URL's query string or a page's content.
export const browserGatewayEvent = pgTable(
  'browser_gateway_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    agentName: text('agent_name').notNull(),
    // 'agent' while the calling agent held the control lock, 'owner' for an action the
    // live view's Übernehmen banner attributes to the person instead.
    actor: text('actor').notNull(),
    tool: text('tool').notNull(),
    // The call's action category (read, write, send, publish, delete, pay, execute), which
    // Helena's policy decided on; null for an event from before categories.
    category: text('category'),
    target: text('target'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('browser_gateway_event_actor_check', sql`${t.actor} IN ('agent', 'owner')`),
    index('browser_gateway_event_project_idx').on(t.projectId, t.id),
  ],
);

// When a Volition service was last seen working, for the health overview. A service
// that reports itself writes its row; one that is probed gets the result of the probe:
// `error` is null when the last check succeeded, and `lastSeenAt` stays at the last
// success.
export const serviceHeartbeat = pgTable('service_heartbeat', {
  service: text('service').primaryKey(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  error: text('error'),
});

// The last run of one of the api's janitor loops, for the health overview: when it last
// ran, how much it cleaned up (null while a run failed before it could count, which
// keeps the count of the last run that did), and why it failed, if it did.
export const janitorRun = pgTable('janitor_run', {
  job: text('job').primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  cleaned: integer('cleaned'),
  error: text('error'),
});

// An agent's request to take an action outside Plan (send, publish, pay, delete), which
// a person with the ai_agents edit permission of the project approves or rejects. The
// decision queues a run of the agent with the decision in its prompt (followUpRunId).
export const approvalRequest = pgTable(
  'approval_request',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    // The run that asked, when the request came from one.
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    action: text('action').notNull(),
    details: text('details').notNull().default(''),
    // The exact command a blocked tool call asked to run. Hermes' approval guard lets the
    // follow-up run execute exactly this command once the request is approved.
    command: text('command'),
    // The policy engine's view of the request: the action category, the Autopilot level
    // that applied and why the action needs a person, as the card shows it.
    category: text('category'),
    autopilotLevel: smallint('autopilot_level'),
    policyReason: text('policy_reason'),
    // What a 'budget' card is about: the budget, its use and its limit.
    payload: jsonb('payload'),
    status: text('status').notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    followUpRunId: integer('follow_up_run_id').references(() => agentRun.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'approval_request_kind_check',
      sql`${t.kind} IN ('send', 'publish', 'pay', 'delete', 'write', 'execute', 'credentials', 'budget', 'other')`,
    ),
    check('approval_request_status_check', sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    index('approval_request_project_status_idx').on(t.projectId, t.status, t.id.desc()),
    index('approval_request_agent_idx').on(t.agentId),
    // One pending request per action and command of a run, so a repeated tool call cannot
    // queue the same outward action twice. The command is indexed by its hash: a long one
    // exceeds the size of a b-tree index entry.
    uniqueIndex('approval_request_pending_run_uq')
      .on(t.runId, t.kind, t.action, sql`md5(coalesce(${t.command}, ''))`)
      .where(sql`${t.status} = 'pending' AND ${t.runId} IS NOT NULL`),
  ],
);

// A conversation between one member and one agent. The agent is driven by a runner on
// its operator's machine, which has no memory of its own, so the conversation lives
// here. The id reads `chat:<agent id>:<user id>:<uuid>` (see agents/chat/service).
export const agentChatThread = pgTable(
  'agent_chat_thread',
  {
    id: text('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title'),
    // The session the runner's coding agent keeps for this thread on its own machine.
    // Set once the runner reports the session it started; null means the next message
    // starts a fresh one and is sent with the conversation framed into its prompt.
    cliSessionId: text('cli_session_id'),
    // Requested external-runner session settings. Null means the mapped agent's current
    // default, so a later model-default change is inherited without rewriting chats.
    model: text('model'),
    thinkingLevel: text('thinking_level'),
    jevFirstStage: text('jev_first_stage')
      .$type<'inherit' | 'on' | 'off'>()
      .notNull()
      .default('inherit'),
    jevFirstStageRevision: integer('jev_first_stage_revision').notNull().default(0),
    // The project the chat was started in; null for a Home chat. Home lists every chat
    // of the member, a project only its own.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    // The task the member linked the chat to, which lists it on its detail.
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'set null' }),
    // The message the chat shows last. The messages form a tree (see
    // agent_chat_message.parent_id); the shown branch is this message and its
    // ancestors. No foreign key: the message references the thread.
    activeMessageId: integer('active_message_id'),
    // Archived and deleted chats leave the list. A deleted one stays restorable until
    // it is deleted for good.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_chat_thread_agent_user_idx').on(t.agentId, t.userId, t.updatedAt.desc()),
    index('agent_chat_thread_user_idx').on(t.userId, t.updatedAt.desc()),
    index('agent_chat_thread_issue_idx').on(t.issueId),
  ],
);

// The conversation the member last chose in Home or one project. A null thread is
// an explicit new chat; deleting a thread also clears the reference automatically.
export const volitionActiveChat = pgTable(
  'volition_active_chat',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    threadId: text('thread_id').references(() => agentChatThread.id, { onDelete: 'set null' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.scope] })],
);

// The non-secret model catalog an external runner publishes for one agent. The
// The external runner stays authoritative and Plan only stores the choices the chat may
// present. A runner refreshes this row periodically and after startup.
export const agentChatCatalog = pgTable('agent_chat_catalog', {
  agentId: integer('agent_id')
    .primaryKey()
    .references(() => aiAgent.id, { onDelete: 'cascade' }),
  models: jsonb('models').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// One turn of a chat thread, and for an agent turn also the queue row the runner
// drains. A member's message is written 'success' with its text; the agent's answer is
// inserted empty and 'pending', goes 'streaming' when a runner claims it, and is filled
// in from the events that runner reports. A claim pushes next_attempt_at forward by a
// lease, so an answer whose runner dies is claimable again once the lease expires —
// which is why the due index covers both live states. agent_id repeats the thread's
// agent so a runner finds its due turns with one index.
export const agentChatMessage = pgTable(
  'agent_chat_message',
  {
    id: serial('id').primaryKey(),
    rootOrigin: text('root_origin').notNull().default('system'),
    observedRuntime: text('observed_runtime'),
    taintSources: jsonb('taint_sources').$type<string[]>().notNull().default([]),
    threadId: text('thread_id')
      .notNull()
      .references(() => agentChatThread.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    // The message this one follows. An edited question or a regenerated answer is a
    // second child of the same parent, so the thread is a tree of versions.
    parentId: integer('parent_id').references((): AnyPgColumn => agentChatMessage.id, {
      onDelete: 'cascade',
    }),
    // The turn's text: what the member wrote, or what the agent has said so far. It is
    // appended to as text events arrive, so the transcript reads correctly mid-answer.
    content: text('content').notNull().default(''),
    // Vault files and tasks the member attached to the question: `{ kind: 'file', path,
    // name, contentType, sizeBytes }` with the vault path, or `{ kind: 'task', issueId,
    // identifier, title }`.
    attachments: jsonb('attachments'),
    // How the turn came about, when not typed (docs/helena-decisions/voice-2.md): a question
    // `voice` was said in the conversation mode (its answer is read aloud, so the agent is
    // asked to answer short and speakable); an answer `voice` was given by Helena's voice
    // reply (a fast local model, modules/voice/reply.ts) instead of the agent's runtime.
    via: text('via'),
    // The runner session that produced the answer. The next answer resumes it only
    // while this answer is the last one produced in it.
    sessionId: text('session_id'),
    // The model the runner reported for the answer, and the tokens its last call read
    // and wrote.
    model: text('model'),
    // The configured model and reasoning next to what the answer's session ran on (as on
    // agent_run). Null for an answer whose runner reports neither.
    modelCheck: jsonb('model_check'),
    // Why the answer failed, where the runtime's words said (as on agent_run).
    failure: jsonb('failure'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_chat_message_role_check', sql`${t.role} IN ('user', 'assistant')`),
    check(
      'agent_chat_message_status_check',
      sql`${t.status} IN ('pending', 'streaming', 'success', 'failed', 'canceled')`,
    ),
    check('agent_chat_message_via_check', sql`${t.via} IS NULL OR ${t.via} IN ('voice')`),
    index('agent_chat_message_thread_idx').on(t.threadId, t.id),
    index('agent_chat_message_parent_idx').on(t.parentId),
    index('agent_chat_message_due_idx')
      .on(t.agentId, t.nextAttemptAt)
      .where(sql`${t.status} IN ('pending', 'streaming')`),
  ],
);

// What the runner reported while producing one agent turn, as AG-UI events (text
// deltas, tool calls, the run's lifecycle). Append-only: the id is the cursor a reader
// resumes from, which is what lets the browser reconnect mid-answer without replaying
// what it already has.
export const agentChatEvent = pgTable(
  'agent_chat_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    messageId: integer('message_id')
      .notNull()
      .references(() => agentChatMessage.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_chat_event_message_idx').on(t.messageId, t.id)],
);

// The token counts of the last completed answer of one chat thread, which is what the
// chat panel shows as the size of that conversation's context. One row per thread,
// overwritten by every answer: only the last number says how close the conversation is
// to the agent's limit. Null counts mean the agent reports none that can be read as a
// context size, which the panel shows as a dash. An autonomous run keeps its own counts
// on agent_run instead, one row per run.
//
// The row carries no foreign key to its agent_chat_thread. It is deleted where the
// thread is deleted, and the cascade covers the deletion of the agent.
export const agentChatUsage = pgTable(
  'agent_chat_usage',
  {
    threadId: text('thread_id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_chat_usage_agent_idx').on(t.agentId)],
);

// The conversations a member has starred, so they stay within reach in the chat
// history. Like agent_chat_usage the row carries no foreign key to the thread. Deleting
// a thread deletes its row; a row left behind is harmless, since the history is built
// from the threads.
export const agentChatFavorite = pgTable(
  'agent_chat_favorite',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.threadId] })],
);

// A member's saved chat prompt, inserted with `/<command>` in the composer. `{{name}}`
// in the text is a variable the member fills in before it is inserted. A prompt with
// no project is offered in every chat; one with a project only in that project's.
export const chatPrompt = pgTable(
  'chat_prompt',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    command: text('command').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chat_prompt_user_scope_command_uq').on(
      t.userId,
      sql`coalesce(${t.projectId}, 0)`,
      t.command,
    ),
  ],
);

// Stored credentials for a team's integrations, shared by every project it owns: the
// credentials of tool integrations (kind 'tool', bound to configured tools).
// integration_key names the integration in the catalog;
// the credential's fields (and which are secret) come from that integration's
// credentialSchema. The full credential object is stored encrypted (AES-256-GCM, see
// apps/api/src/shared/crypto.ts): ciphertext + iv + auth_tag. `redacted` is the same
// object with secret fields masked, kept in plaintext for a masked display. The
// secret is never returned to the client. A team may hold several credentials per
// integration (e.g. two Jina keys), told apart by `label`.
//
// The credentials of the Credentials page (integration keys 'web_login', 'api_key',
// 'ssh_key' and 'secret') use the same table: their ciphertext holds only the secret
// fields, `redacted` the other fields and `true` for every secret field that is set.
// Only they are limited to one project (`project_id`) and granted to agents
// (integration_credential_grant).
export const integrationCredential = pgTable(
  'integration_credential',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    integrationKey: text('integration_key').notNull(),
    label: text('label'),
    // Null for a credential of the whole team.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    // The credential with secret fields masked; non-secret fields verbatim. Owned by
    // the store, derived from the integration's credential schema.
    redacted: jsonb('redacted').notNull().default({}),
    // The health of a connector account (a Google account, an MCP/OAuth connection), as
    // its last check found it: 'ok', 'needs_auth' (the owner has to sign in again) or
    // 'error'. Null for a credential that has no check, and before the first one.
    status: text('status'),
    statusDetail: text('status_detail'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The runner replaces a login it delivered once this moves.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'integration_credential_status_check',
      sql`${t.status} IS NULL OR ${t.status} IN ('ok', 'needs_auth', 'error')`,
    ),
    index('integration_credential_team_idx').on(t.teamId),
    index('integration_credential_project_idx').on(t.projectId),
    // An environment variable name is used by one credential of the team, and by one of
    // each project (apps/api/src/modules/agents/credentials/env.ts).
    uniqueIndex('integration_credential_env_name_uq')
      .on(t.teamId, sql`coalesce(${t.projectId}, 0)`, sql`(${t.redacted}->>'envName')`)
      .where(sql`(${t.redacted}->>'envName') IS NOT NULL`),
  ],
);

// Who may use a credential of the access center: one agent, or every agent working in one
// project. `service` narrows the grant to one service of a connector account ('mail',
// 'calendar' …); null covers all of them. `access` is 'read' (only actions of the read
// category) or 'write' (every action; the policy may still ask for an approval). A
// credential limited to a project is granted only to that project and its agents. A web
// login, API key, SSH key or secret has no services and ignores `access`.
export const integrationCredentialGrant = pgTable(
  'integration_credential_grant',
  {
    id: serial('id').primaryKey(),
    credentialId: integer('credential_id')
      .notNull()
      .references(() => integrationCredential.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    service: text('service'),
    access: text('access').notNull().default('write'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'integration_credential_grant_subject_check',
      sql`(${t.agentId} IS NULL) <> (${t.projectId} IS NULL)`,
    ),
    check('integration_credential_grant_access_check', sql`${t.access} IN ('read', 'write')`),
    uniqueIndex('integration_credential_grant_uq').on(
      t.credentialId,
      sql`coalesce(${t.agentId}, 0)`,
      sql`coalesce(${t.projectId}, 0)`,
      sql`coalesce(${t.service}, '')`,
    ),
    index('integration_credential_grant_agent_idx').on(t.agentId),
    index('integration_credential_grant_project_idx').on(t.projectId),
  ],
);

// The audit log of the access center. What an agent's runner received ('delivered'),
// every login it filled ('used'), every connector tool it called ('called'), refused by a
// grant or the policy ('denied') or held for the owner's approval ('approval'), and what
// the owner changed ('changed': connected, granted, reset …). `category` is the action
// category of a tool call. The label and the agent's name are copied, so an entry
// outlives the credential, the agent and the run.
export const integrationCredentialUse = pgTable(
  'integration_credential_use',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    credentialLabel: text('credential_label').notNull(),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    agentName: text('agent_name').notNull(),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    category: text('category'),
    // What the credential served: the Hermes vault or an MCP server for a delivery, the
    // tool and the site for a use, the tool and its target for a call.
    purpose: text('purpose').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'integration_credential_use_action_check',
      sql`${t.action} IN ('delivered', 'used', 'called', 'denied', 'approval', 'changed')`,
    ),
    index('integration_credential_use_credential_idx').on(t.credentialId, t.createdAt),
    index('integration_credential_use_team_idx').on(t.teamId, t.createdAt),
  ],
);

// A connector tool call that waits for the owner: stored exactly as the agent asked, so
// what runs after the approval is what the approval card showed. The API carries it out
// once the approval request is approved ('done' or 'failed'), or closes it when rejected.
export const connectorAction = pgTable(
  'connector_action',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    connector: text('connector').notNull(),
    tool: text('tool').notNull(),
    category: text('category').notNull(),
    service: text('service'),
    input: jsonb('input').notNull().default({}),
    summary: text('summary').notNull(),
    status: text('status').notNull().default('pending'),
    approvalRequestId: integer('approval_request_id').references(() => approvalRequest.id, {
      onDelete: 'set null',
    }),
    result: jsonb('result'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'connector_action_status_check',
      sql`${t.status} IN ('pending', 'running', 'done', 'failed', 'rejected')`,
    ),
    index('connector_action_pending_idx').on(t.status, t.id),
    index('connector_action_team_idx').on(t.teamId, t.createdAt),
  ],
);

// A sign-in that is under way: the owner opened the provider's page and has not brought
// the code back yet. `id` is the OAuth `state`. The PKCE verifier and whatever else the
// flow needs to finish are encrypted like a credential. Rows expire after a few minutes.
export const connectorAuthSession = pgTable(
  'connector_auth_session',
  {
    id: text('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connector: text('connector').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('connector_auth_session_expires_idx').on(t.expiresAt)],
);

export const gitProviderConnection = pgTable(
  'git_provider_connection',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    baseUrl: text('base_url').notNull(),
    accountLogin: text('account_login').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('git_provider_connection_project_provider_url_account_unique').on(
      t.projectId,
      t.provider,
      t.baseUrl,
      t.accountLogin,
    ),
    index('git_provider_connection_project_idx').on(t.projectId),
  ],
);

export const gitManagedRepository = pgTable(
  'git_managed_repository',
  {
    id: serial('id').primaryKey(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => gitProviderConnection.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    fullName: text('full_name').notNull(),
    webUrl: text('web_url').notNull(),
    webhookExternalId: text('webhook_external_id').notNull(),
    status: text('status').notNull().default('connected'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('git_managed_repository_connection_external_unique').on(t.connectionId, t.externalId),
    index('git_managed_repository_connection_idx').on(t.connectionId, t.fullName),
  ],
);

// Per-team notification provider credentials: the outbound channels every project
// of the team delivers through (SMTP or Resend for email, a Telegram bot). One row
// per team, managed by its owner. The config carries secrets (SMTP password, Resend
// API key, Telegram bot token), so it is stored encrypted (AES-256-GCM, see
// apps/api/src/shared/crypto.ts): ciphertext + iv + auth_tag. `redacted` is the
// same config with secret values dropped, kept in plaintext so the settings UI can
// render the non-secret fields and show which secrets are set. Secrets are never
// returned to the client. The plaintext config is read only by the delivery sender.
// Which events reach a given member is a per-user choice held in
// user_notification_preference, not here. The Telegram bot token here is optional: a
// team that sets one delivers through its own bot, otherwise delivery falls back
// to the instance bot in app_secret key 'telegram.bot'.
export const teamNotificationSetting = pgTable('team_notification_setting', {
  teamId: integer('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  redacted: jsonb('redacted').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A member's own notification preferences for one project: for each issue event
// type, whether they want it by email and/or Telegram. One row per (user, project);
// absent means the member has not opted in and receives nothing.
// email_events/telegram_events are EventToggles jsonb keyed by the four inbox
// notification types (assigned/mentioned/commented/state_changed). Email is sent to
// the member's account address; Telegram to the chat of the account they linked in
// user_telegram_account, which is instance-wide rather than per project.
export const userNotificationPreference = pgTable(
  'user_notification_preference',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    emailEvents: jsonb('email_events').notNull().default({}),
    telegramEvents: jsonb('telegram_events').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_notification_pref_user_project_unique').on(t.userId, t.projectId)],
);

// The Telegram account a user has linked, instance-wide (one row per user, whatever
// the project). Linking runs through the instance bot: the user asks for a link, the
// row is created with a one-time link_code, and the bot fills chat_id when that code
// arrives as `/start <code>`. So the row is "pending" while chat_id is null and
// "linked" once it is set — link_code is cleared at that point. chat_id is unique, so
// one Telegram account cannot serve two product accounts.
export const userTelegramAccount = pgTable(
  'user_telegram_account',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: text('chat_id'),
    telegramUserId: text('telegram_user_id'),
    pairingId: uuid('pairing_id').notNull().defaultRandom(),
    selectedAgentId: integer('selected_agent_id').references(() => aiAgent.id, {
      onDelete: 'set null',
    }),
    selectedProjectId: integer('selected_project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    currentThreadId: text('current_thread_id'),
    // Display only, refreshed on every link: what to show the user so they can tell
    // which Telegram account this is. A Telegram account may have no @username.
    username: text('username'),
    firstName: text('first_name'),
    linkCode: text('link_code'),
    linkCodeExpiresAt: timestamp('link_code_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_telegram_account_chat_id_unique')
      .on(t.chatId)
      .where(sql`${t.chatId} IS NOT NULL`),
    uniqueIndex('user_telegram_account_telegram_user_id_unique')
      .on(t.telegramUserId)
      .where(sql`${t.telegramUserId} IS NOT NULL`),
    uniqueIndex('user_telegram_account_link_code_unique')
      .on(t.linkCode)
      .where(sql`${t.linkCode} IS NOT NULL`),
  ],
);

export const telegramChannelEvent = pgTable(
  'telegram_channel_event',
  {
    id: serial('id').primaryKey(),
    botId: text('bot_id').notNull(),
    pairingId: uuid('pairing_id'),
    updateId: integer('update_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    text: text('text'),
    approvalId: integer('approval_id').references(() => approvalRequest.id, {
      onDelete: 'set null',
    }),
    approved: boolean('approved'),
    state: text('state').notNull().default('pending'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    answerMessageId: integer('answer_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    responseText: text('response_text'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('telegram_channel_event_update_uq').on(t.botId, t.updateId),
    check('telegram_channel_event_kind_check', sql`${t.kind} IN ('message', 'decision')`),
    check(
      'telegram_channel_event_state_check',
      sql`${t.state} IN ('pending', 'processing', 'done', 'failed')`,
    ),
    index('telegram_channel_event_pending_idx').on(t.state, t.id),
  ],
);

export const telegramApprovalNotice = pgTable(
  'telegram_approval_notice',
  {
    id: serial('id').primaryKey(),
    approvalId: integer('approval_id')
      .notNull()
      .references(() => approvalRequest.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('telegram_approval_notice_uq').on(t.approvalId, t.userId)],
);

export const telegramAlertNotice = pgTable(
  'telegram_alert_notice',
  {
    id: serial('id').primaryKey(),
    alertKey: text('alert_key').notNull(),
    alertOpenedAt: timestamp('alert_opened_at', { withTimezone: true }).notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('telegram_alert_notice_uq').on(t.alertKey, t.alertOpenedAt, t.userId),
    check(
      'telegram_alert_notice_status_check',
      sql`${t.status} IN ('pending', 'acknowledged', 'dismissed')`,
    ),
  ],
);

export const standingOrder = pgTable(
  'standing_order',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    source: text('source').notNull(),
    authorUserId: text('author_user_id').notNull(),
    status: text('status').notNull().default('proposed'),
    active: boolean('active').notNull().default(false),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('standing_order_scope_check', sql`(${t.projectId} IS NULL) <> (${t.agentId} IS NULL)`),
    check('standing_order_status_check', sql`${t.status} IN ('proposed', 'confirmed', 'rejected')`),
    index('standing_order_project_idx').on(t.projectId, t.status, t.active),
    index('standing_order_agent_idx').on(t.agentId, t.status, t.active),
  ],
);

// Outbox for outbound notification delivery. One row per (recipient, channel,
// message) to send: an email or a Telegram message to one member for an issue event,
// or a Web Push message to one of a person's devices. Email and Telegram rows are
// enqueued when inbox notifications are created (see
// apps/api/src/modules/notifications/outbound.ts) and drained by the worker
// following the same claim/retry pattern as webhook_delivery; push rows are enqueued
// and drained by @helena/push in the api and the worker alike (an emergency must reach
// the phone while the worker is down; docs/helena-decisions/push.md). The message text
// is composed at enqueue time and stored in `payload`; the channel credentials are read
// at send time (team_notification_setting, the instance's VAPID keys). channel is
// 'email' | 'telegram' | 'push' ('email' picks SMTP or Resend from the team config).
// recipient is the member's email address for email rows, their Telegram chat id for
// telegram rows, and the id of the push subscription (helena_push_subscription) for
// push rows. A push row belongs to no project.
// The stored message on a notification_delivery row, composed at enqueue time by the
// api and read by the worker that sends it. `subject`/`html` are channel-specific:
// email uses `subject` and builds its own HTML from `text`; Telegram sends `html`
// (parse_mode HTML) and falls back to `text`. The sender appends `url` to plain-text
// bodies. `dedupeKey` is what the enqueue side matches to avoid queuing the same
// message twice; `projectInviteId` ties an invite email to its invite, so a delivery
// whose invite is no longer pending is dropped instead of sent.
export interface DeliveryPayload {
  subject?: string;
  text: string;
  html?: string;
  url?: string;
  emailSource?: 'project' | 'instance';
  idempotencyKey?: string;
  dedupeKey?: string;
  projectInviteId?: number;
  // A push row's message, rendered for the device (@helena/push).
  push?: PushDeliveryMessage;
}

// What a device shows for a push row: the notification's title and body, where a tap
// leads inside Helena, the tag a later message replaces it by (a recovery replaces the
// alarm), and how the push service is to treat it (RFC 8030 §5).
export interface PushDeliveryMessage {
  category: string;
  title: string;
  body: string;
  // A path inside Helena, `/god/server/disks`.
  url: string;
  tag: string;
  // Ring and vibrate again although a notification with the tag is shown.
  renotify?: boolean;
  // Stay on screen until the person acts (desktop browsers).
  requireInteraction?: boolean;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  ttlSeconds: number;
  // RFC 8030 §5.4: a newer message with the topic replaces one still waiting at the push
  // service. At most 32 characters of the base64url alphabet.
  topic?: string;
  // ISO 8601: when it happened.
  at: string;
}

export const notificationDelivery = pgTable(
  'notification_delivery',
  {
    id: serial('id').primaryKey(),
    // Null for a push row, which belongs to a person, not a project.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    recipient: text('recipient'),
    payload: jsonb('payload').$type<DeliveryPayload>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'notification_delivery_channel_check',
      sql`${t.channel} IN ('email', 'telegram', 'push')`,
    ),
    // Only a push row may go without a project.
    check(
      'notification_delivery_project_check',
      sql`${t.projectId} IS NOT NULL OR ${t.channel} = 'push'`,
    ),
    // Backs the worker's claim query: due pending rows ordered by next_attempt_at.
    index('notification_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    // The same push message is queued once per device while it waits (an alert checked
    // by two api replicas, an event handed over twice).
    uniqueIndex('notification_delivery_push_dedupe_idx')
      .on(t.recipient, sql`(${t.payload} ->> 'dedupeKey')`)
      .where(
        sql`${t.channel} = 'push' AND ${t.status} = 'pending' AND (${t.payload} ->> 'dedupeKey') IS NOT NULL`,
      ),
  ],
);

// Skill library of a team, shared by every project it owns. A skill is a unit of
// knowledge given to an agent (Anthropic Agent Skill format): a SKILL.md
// with YAML frontmatter (name/description) plus optional reference files, no
// executable scripts. The markdown and reference bytes live in the S3 object store
// under s3_prefix; `files` lists the reference file paths and their object keys.
// Sourced from an upload, inline text, or a GitHub URL. Enabled on an agent via
// agent_skill_link.
export const agentSkill = pgTable(
  'agent_skill',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    // Object-store prefix holding SKILL.md and reference files for this skill.
    s3Prefix: text('s3_prefix').notNull(),
    // Reference files beyond SKILL.md: [{ path, s3Key, size }]. Owned by the store.
    files: jsonb('files').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    check('agent_skill_source_check', sql`${t.source} IN ('upload', 'inline', 'github')`),
    index('agent_skill_team_idx').on(t.teamId),
  ],
);

// An owner's decision on what an external agent learned in its runtime: discard or pin a
// skill it created, or write one of its memory files. The agent's runner receives the
// pending ones with its runtime policy and reports each result. A done action is deleted;
// a failed one keeps its error until a newer action on the same target replaces it.
export const agentRuntimeAction = pgTable(
  'agent_runtime_action',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    // The skill's directory in the runtime, or the memory file.
    target: text('target').notNull(),
    payload: jsonb('payload').notNull().default({}),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'agent_runtime_action_kind_check',
      sql`${t.kind} IN ('discard-skill', 'pin-skill', 'write-memory', 'rewrite-profile')`,
    ),
    index('agent_runtime_action_agent_idx').on(t.agentId, t.id),
  ],
);

// The token ledger: one row per run, chat answer or reflection a runner reported (and per
// browser_task a decision model answered, kind 'tool'), with the
// model that actually ran. Usage per agent, model, project and day and the budgets are read
// from here; cost is computed when read, from the price of the model at that time. The token
// columns follow the OpenTelemetry GenAI conventions (gen_ai.usage.*): input_tokens includes
// the cached reads and writes, output_tokens includes the reasoning tokens.
export const agentUsage = pgTable(
  'agent_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    // Null for work outside a project, such as a Home chat.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    // The runner preset that ran it ('hermes', 'claude', 'codex', ...), null for a custom one.
    runtime: text('runtime'),
    // gen_ai.response.model and gen_ai.provider.name, as the runtime reported them.
    model: text('model'),
    provider: text('provider'),
    // gen_ai.conversation.id: the runtime session the tokens were spent in.
    sessionId: text('session_id'),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }).notNull().default(0),
    reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }).notNull().default(0),
    // Wall-clock time of the run, chat answer or reflection, when the runner measured it.
    durationMs: integer('duration_ms'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_usage_kind_check', sql`${t.kind} IN ('run', 'chat', 'reflection', 'tool')`),
    index('agent_usage_agent_time_idx').on(t.agentId, t.occurredAt),
    index('agent_usage_project_time_idx').on(t.projectId, t.occurredAt),
    index('agent_usage_time_idx').on(t.occurredAt),
    index('agent_usage_run_idx').on(t.runId),
  ],
);

// A question Helena asks an agent's runtime through its runner: a session list, a
// transcript, the logs, a health check, a curator run. The runner claims it, answers it
// with the adapter of the agent's runtime, and the waiting request reads the answer. Rows
// are kept only for a few minutes; the janitor deletes answered and stale ones.
export const agentRuntimeRequest = pgTable(
  'agent_runtime_request',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    // The request as the runner receives it: `{ op, ...params }` (packages/runner readers).
    request: jsonb('request').notNull(),
    // pending -> claimed -> answered | failed
    status: text('status').notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'agent_runtime_request_status_check',
      sql`${t.status} IN ('pending', 'claimed', 'answered', 'failed')`,
    ),
    index('agent_runtime_request_agent_idx').on(t.agentId, t.status, t.id),
    index('agent_runtime_request_created_idx').on(t.createdAt),
  ],
);

// What a run's command wrote, as the AG-UI events the runner read from it, redacted: the
// run's timeline in Helena, live while it runs and as a replay afterwards. Bounded per run
// by the API; the janitor removes the events of old runs.
export const agentRunEvent = pgTable(
  'agent_run_event',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    // The claim the events came from: a run claimed again starts a new attempt.
    claim: integer('claim').notNull().default(0),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('agent_run_event_run_idx').on(t.runId, t.id)],
);

export const agentRunOutput = pgTable(
  'agent_run_output',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => agentRun.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    target: text('target').notNull(),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_run_output_kind_check', sql`${t.kind} IN ('file', 'preview', 'pr', 'screenshot')`),
    check('agent_run_output_source_check', sql`${t.source} IN ('reported', 'inferred')`),
    uniqueIndex('agent_run_output_unique_idx').on(t.runId, t.kind, t.target),
  ],
);

// A change the owner decides on before it takes effect, raised by an agent's runtime rather
// than by the agent asking: a memory write Hermes staged (memory.write_approval), an update
// of Hermes itself. Listed with the approvals; approving one has the runner carry it out.
export const agentProposal = pgTable(
  'agent_proposal',
  {
    id: serial('id').primaryKey(),
    // Null for a proposal of the instance, such as a Hermes update.
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    // The runtime's own id of the proposal (Hermes' pending id), so a report repeats it
    // instead of adding it twice.
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    payload: jsonb('payload').notNull().default({}),
    // pending -> approved | rejected; approved -> applied | failed once the runner did it.
    status: text('status').notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    note: text('note'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_proposal_kind_check', sql`${t.kind} IN ('memory-write', 'hermes-update')`),
    check(
      'agent_proposal_status_check',
      sql`${t.status} IN ('pending', 'approved', 'rejected', 'applied', 'failed')`,
    ),
    uniqueIndex('agent_proposal_external_uq').on(
      sql`coalesce(${t.agentId}, 0)`,
      t.kind,
      t.externalId,
    ),
    index('agent_proposal_status_idx').on(t.status, t.id),
  ],
);

// Every version of an agent's memory files Helena has seen: what the agent wrote and the
// owner approved, what the owner wrote, and changes found in the runtime otherwise.
export const agentMemoryRevision = pgTable(
  'agent_memory_revision',
  {
    id: serial('id').primaryKey(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    file: text('file').notNull(),
    content: text('content').notNull(),
    sha256: text('sha256').notNull(),
    source: text('source').notNull(),
    sourceContext: jsonb('source_context'),
    proposalId: integer('proposal_id').references(() => agentProposal.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The two memory files, and the daily notes of Helena's own runtime (notes/<date>.md).
    check(
      'agent_memory_revision_file_check',
      sql`${t.file} IN ('MEMORY.md', 'USER.md') OR ${t.file} ~ '^notes/[0-9]{4}-[0-9]{2}-[0-9]{2}[.]md$'`,
    ),
    check('agent_memory_revision_source_check', sql`${t.source} IN ('agent', 'owner', 'observed')`),
    index('agent_memory_revision_agent_idx').on(t.agentId, t.file, t.id),
  ],
);

// Which skills are enabled on which agents (many-to-many). Deleting an agent or a
// skill removes the link.
export const agentSkillLink = pgTable(
  'agent_skill_link',
  {
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    skillId: integer('skill_id')
      .notNull()
      .references(() => agentSkill.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('agent_skill_link_skill_idx').on(t.skillId),
  ],
);

// A tool configured for a team, shared by every project it owns: a tool from the
// catalog (tool_key) bound to one integration_credential. The tool's integration owns
// the secret, so the tool holds no secret of its own — it references the credential
// the runtime decrypts at call time. Different tools of the same integration may be
// bound to different credentials (e.g. two Jina keys). Enabled on an agent via
// agent_tool_link.
export const agentTool = pgTable(
  'agent_tool',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    toolKey: text('tool_key').notNull(),
    credentialId: integer('credential_id')
      .notNull()
      .references(() => integrationCredential.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.toolKey, t.credentialId),
    index('agent_tool_team_idx').on(t.teamId),
    index('agent_tool_credential_idx').on(t.credentialId),
  ],
);

// Which configured tools are enabled on which agents (many-to-many). Deleting an
// agent or a configured tool removes the link.
export const agentToolLink = pgTable(
  'agent_tool_link',
  {
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    agentToolId: integer('agent_tool_id')
      .notNull()
      .references(() => agentTool.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.agentToolId] }),
    index('agent_tool_link_tool_idx').on(t.agentToolId),
  ],
);

// An MCP server of the team's library, which an external agent's Hermes profile starts
// once the server is enabled on the agent (agent_mcp_server_link). `name` is the key of
// the server in Hermes' mcp_servers and the name of its toolset. A stdio server has
// `command` and `args`, an http or sse server `url`. `env` (stdio) and `headers`
// (http, sse) hold [{ name, value }] for a literal, or [{ name, credentialId }] for the
// value of a team secret (an integration_credential of the 'secret' integration),
// which only the agent's runner receives.
export const agentMcpServer = pgTable(
  'agent_mcp_server',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    transport: text('transport').notNull(),
    command: text('command'),
    args: jsonb('args').notNull().default([]),
    url: text('url'),
    env: jsonb('env').notNull().default([]),
    headers: jsonb('headers').notNull().default([]),
    // A server the instance itself seeded (today: "Projekt-Browser", the browser gateway,
    // and "Hermes-eigener Browser (alt)", the pre-gateway fallback). A team cannot edit or
    // delete these rows; only whether they are on for an agent (agent_mcp_server_link).
    builtin: boolean('builtin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    check('agent_mcp_server_transport_check', sql`${t.transport} IN ('stdio', 'http', 'sse')`),
    index('agent_mcp_server_team_idx').on(t.teamId),
  ],
);

export const agentMcpServerLink = pgTable(
  'agent_mcp_server_link',
  {
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    mcpServerId: integer('mcp_server_id')
      .notNull()
      .references(() => agentMcpServer.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.mcpServerId] }),
    index('agent_mcp_server_link_server_idx').on(t.mcpServerId),
  ],
);

// One row per field-group actually propagated from a template into one of its copies
// (see agents/core/template-sync.ts), so a copy's page can show "picked up <groups>
// from the template <when>" and a template's page can show its last fan-out. A group a
// copy has overridden is skipped and logs nothing. This is a narrow, template-specific
// trail, not the team's general activity feed.
export const agentTemplateSyncLog = pgTable(
  'agent_template_sync_log',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    templateId: integer('template_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    copyId: integer('copy_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    groups: jsonb('groups').notNull().$type<string[]>(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_template_sync_log_team_idx').on(t.teamId),
    index('agent_template_sync_log_template_idx').on(t.templateId, t.syncedAt),
    index('agent_template_sync_log_copy_idx').on(t.copyId, t.syncedAt),
  ],
);

// Custom fields. Always scoped to a project. A NULL issue_type_id applies the
// field to every issue in that project; a non-null issue_type_id scopes it to
// that one type.
export const customField = pgTable(
  'custom_field',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueTypeId: integer('issue_type_id').references(() => issueType.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    fieldType: text('field_type').notNull(),
    // Who a 'member' field may hold: every candidate, the people only, or the
    // agents only. NULL for every other field type.
    memberScope: text('member_scope'),
    // When true the field renders in the issue body (under the description),
    // like a second description; when false it renders as a Properties row.
    showInBody: boolean('show_in_body').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'custom_field_field_type_check',
      sql`${t.fieldType} IN ('text', 'markdown', 'url', 'number', 'boolean', 'date', 'datetime', 'datetime_range', 'select', 'multi_select', 'member')`,
    ),
    check(
      'custom_field_member_scope_check',
      sql`(${t.fieldType} = 'member') = (${t.memberScope} IS NOT NULL) AND (${t.memberScope} IS NULL OR ${t.memberScope} IN ('all', 'humans', 'agents'))`,
    ),
  ],
);

export const customFieldOption = pgTable(
  'custom_field_option',
  {
    id: serial('id').primaryKey(),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    color: text('color').notNull().default('#6b7280'),
    position: integer('position').notNull().default(0),
  },
  (t) => [unique().on(t.fieldId, t.value)],
);

// Which member custom fields an agent reacts to. Setting the agent into one of the
// listed fields enqueues a run for it, the way being made an issue's delegate does
// with trigger_on_assign. A field the agent is not linked to holds it without
// starting anything.
export const agentFieldTrigger = pgTable(
  'agent_field_trigger',
  {
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    // How long this field's run waits before it becomes claimable. Each field carries
    // its own, the way delegation carries delegation_delay_sec.
    delaySec: integer('delay_sec').notNull().default(120),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.fieldId] }),
    check('agent_field_trigger_delay_check', sql`${t.delaySec} >= 0 AND ${t.delaySec} <= 86400`),
    index('agent_field_trigger_field_idx').on(t.fieldId),
  ],
);

// A preset a new issue can be created from. It carries the title and description
// the issue starts with plus the properties applied on top of it — every one of
// them optional, and one left NULL leaves the create dialog on its own default.
// The labels are in issue_template_label.
export const issueTemplate = pgTable(
  'issue_template',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // What the template is for, shown under its name in the picker.
    description: text('description').notNull().default(''),
    // The title and body the issue starts with, both editable before it is created.
    titleTemplate: text('title_template').notNull().default(''),
    descriptionTemplate: text('description_template').notNull().default(''),
    typeId: integer('type_id').references(() => issueType.id, { onDelete: 'set null' }),
    columnId: integer('column_id').references(() => projectColumn.id, { onDelete: 'set null' }),
    priority: text('priority'),
    assigneeUserId: text('assignee_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

export const issueTemplateLabel = pgTable(
  'issue_template_label',
  {
    templateId: integer('template_id')
      .notNull()
      .references(() => issueTemplate.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.labelId] })],
);

// A strategic grouping of issues inside a project (project-scoped, not
// cross-project). Issues point at it through issue.initiative_id. status is a
// fixed lifecycle enum; health is not stored — it is computed on the fly from the
// initiative's issue progress against its timeline. owner_user_id is the person
// accountable. start_date/target_date bound the timeline (start defaults to
// created_at when null); priority mirrors issue.priority (free text).
export const initiative = pgTable(
  'initiative',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull().default('planned'),
    ownerUserId: text('owner_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    priority: text('priority'),
    startDate: date('start_date'),
    targetDate: date('target_date'),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'initiative_status_check',
      sql`${t.status} IN ('proposed', 'planned', 'active', 'completed', 'canceled')`,
    ),
    index('initiative_project_idx').on(t.projectId, t.position),
  ],
);

// Labels attached to an initiative. Reuses the project's labels (label table);
// mirrors issue_label. Composite PK, no id, no timestamps.
export const initiativeLabel = pgTable(
  'initiative_label',
  {
    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.initiativeId, t.labelId] })],
);

// File attachments on an initiative. Mirrors issue_attachment: bytes live in the
// S3-compatible object store, this table holds the metadata and the object key,
// and public_id is the unguessable id used in the public download URL.
export const initiativeAttachment = pgTable(
  'initiative_attachment',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key'),
    vaultPath: text('vault_path'),
    sha256: text('sha256'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('initiative_attachment_initiative_idx').on(t.initiativeId),
    index('initiative_attachment_vault_path_idx').on(t.vaultPath),
    check(
      'initiative_attachment_storage_check',
      sql`${t.s3Key} IS NOT NULL OR ${t.vaultPath} IS NOT NULL`,
    ),
  ],
);

// A time-boxed period of work inside a project (a sprint). Issues point at it
// through issue.cycle_id. The state of a cycle — upcoming, active, completed — is
// not stored: it follows from start_date/end_date against the current date, so a
// cycle never has to be started or closed by hand. completed_at is the one override:
// a cycle finished ahead of its dates counts as completed from that moment on.
// Cycles of one project may not overlap, which is what makes at most one of them
// active; the API enforces that.
export const cycle = pgTable(
  'cycle',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // What the team commits to in this cycle (the sprint goal). Empty when unset.
    goal: text('goal').notNull().default(''),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    // When the cycle was finished before its planned end date. NULL while it still
    // runs on its dates; once set it is never cleared, and end_date keeps the date
    // the cycle was planned to run until.
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cycle_dates_check', sql`${t.endDate} >= ${t.startDate}`),
    index('cycle_project_idx').on(t.projectId, t.startDate),
  ],
);

export const issue = pgTable(
  'issue',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    typeId: integer('type_id').references(() => issueType.id, {
      onDelete: 'set null',
    }),
    // The initiative this issue belongs to (project-scoped). Nullable; deleting an
    // initiative unlinks its issues rather than deleting them (like type_id).
    initiativeId: integer('initiative_id').references(() => initiative.id, {
      onDelete: 'set null',
    }),
    // The cycle this issue is planned into (project-scoped). Nullable; deleting a
    // cycle unlinks its issues rather than deleting them.
    cycleId: integer('cycle_id').references(() => cycle.id, {
      onDelete: 'set null',
    }),
    // The area (project_view_folder) this issue belongs to, at most one. Deleting an
    // area keeps its issues in the project.
    folderId: integer('folder_id').references(() => projectViewFolder.id, {
      onDelete: 'set null',
    }),
    columnId: integer('column_id')
      .notNull()
      .references(() => projectColumn.id),
    // The issue this one is a subtask of (same project). One level deep: an issue
    // with a parent cannot itself be a parent, which the API enforces. Deleting or
    // archiving a parent asks what to do with its subtasks, so the ON DELETE here
    // only covers the paths that bypass that choice (a deleted project).
    parentId: integer('parent_id').references((): AnyPgColumn => issue.id, {
      onDelete: 'set null',
    }),
    assigneeUserId: text('assignee_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    // The AI agent an issue is delegated to. Like assignee this points at a bot
    // user (ai_agent.user_id); assignee holds a project member, delegate holds an
    // agent. Setting a delegate on an agent with trigger_on_assign enqueues an agent
    // run.
    delegateUserId: text('delegate_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: text('priority'),
    // How big the work is, one column per estimate kind the project can turn on.
    // Time is held in minutes; the UI enters and shows it as hours and minutes.
    estimatePoints: numeric('estimate_points'),
    estimateMinutes: integer('estimate_minutes'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    position: doublePrecision('position').notNull().default(0),
    // When set, the issue is archived: hidden from the board and lists but kept and
    // restorable. Set manually (archive action) or by the worker's auto-archive
    // sweep for issues that sat in a completed/canceled column past the project's
    // configured threshold. NULL means active (on the board).
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Unguessable token for the public read-only share link. NULL means the issue
    // is not shared; setting it enables the link, clearing it revokes access.
    shareToken: uuid('share_token').unique(),
    // How much the share link exposes, the same choice a shared view carries.
    shareExtended: boolean('share_extended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.projectId, t.sequenceNumber),
    check('issue_estimate_points_check', sql`${t.estimatePoints} >= 0`),
    check('issue_estimate_minutes_check', sql`${t.estimateMinutes} >= 0`),
    // Backs the board/list read (active issues of a project) and the worker's
    // auto-archive sweep (still-active issues in a project).
    index('issue_project_active_idx')
      .on(t.projectId, t.columnId)
      .where(sql`${t.archivedAt} IS NULL`),
    // Backs the import duplicate check: the titles a project already holds,
    // archived ones included, normalised the way titleKey compares them.
    index('issue_project_title_idx').on(t.projectId, sql`lower(btrim(${t.title}))`),
    // Backs reading a parent's subtasks, on the issue page and on every write that
    // has to know whether an issue has any.
    index('issue_parent_idx')
      .on(t.parentId)
      .where(sql`${t.parentId} IS NOT NULL`),
    // Backs the progress counts of a cycles list, the transfer of a cycle's issues,
    // and the ON DELETE SET NULL a cycle delete runs.
    index('issue_cycle_idx')
      .on(t.cycleId)
      .where(sql`${t.cycleId} IS NOT NULL`),
    index('issue_folder_idx')
      .on(t.folderId)
      .where(sql`${t.folderId} IS NOT NULL`),
  ],
);

// One stretch an issue spent on a cycle: a record is opened when the issue is
// planned into the cycle and closed when it leaves it. This is what the cycle
// history of an issue reads, and what carry-over metrics are counted from.
// Deleting a cycle removes its records, so an issue stops counting a cycle that no
// longer exists.
export const issueCycle = pgTable(
  'issue_cycle',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    cycleId: integer('cycle_id')
      .notNull()
      .references(() => cycle.id, { onDelete: 'cascade' }),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    // NULL while the issue still sits on the cycle.
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    index('issue_cycle_issue_idx').on(t.issueId, t.enteredAt),
    // The ON DELETE CASCADE a cycle delete runs.
    index('issue_cycle_cycle_idx').on(t.cycleId),
    // An issue sits on one cycle at a time, so it never holds two open records for
    // the same cycle.
    uniqueIndex('issue_cycle_open_idx')
      .on(t.issueId, t.cycleId)
      .where(sql`${t.leftAt} IS NULL`),
  ],
);

// One stretch an issue spent in one column: a row is opened when the issue enters
// the column and closed when it leaves it. This is what the status timeline reads,
// and what the closing metrics are counted from. The name and the state type are
// copied in rather than read through column_id, because both are editable: renaming
// a column or switching its type would otherwise rewrite what past stretches say.
export const issueStatus = pgTable(
  'issue_status',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    // NULL once the column is deleted, which keeps the stretches spent in it.
    columnId: integer('column_id').references(() => projectColumn.id, { onDelete: 'set null' }),
    // The name the column had at that moment. NULL only in a backfilled row whose
    // change-log entry recorded none.
    columnName: text('column_name'),
    // The type the column had at that moment. NULL only in a backfilled row whose
    // column could not be resolved; such a stretch never counts as completed.
    stateType: text('state_type'),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    // NULL while the issue still sits in the column.
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    index('issue_status_issue_idx').on(t.issueId, t.enteredAt),
    // The ON DELETE SET NULL a column delete runs.
    index('issue_status_column_idx')
      .on(t.columnId)
      .where(sql`${t.columnId} IS NOT NULL`),
    // An issue sits in one column at a time, so it never holds two open rows.
    uniqueIndex('issue_status_open_idx')
      .on(t.issueId)
      .where(sql`${t.leftAt} IS NULL`),
  ],
);

export const issueLabel = pgTable(
  'issue_label',
  {
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    labelId: integer('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

// A relation between two issues of the same project. One row per relation: the
// inverse side ("blocked by" for 'blocks', "duplicated by" for 'duplicates') is
// read from the same row by matching target_issue_id.
export const issueLink = pgTable(
  'issue_link',
  {
    id: serial('id').primaryKey(),
    sourceIssueId: integer('source_issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    targetIssueId: integer('target_issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('issue_link_kind_check', sql`${t.kind} IN ('blocks', 'relates', 'duplicates')`),
    check('issue_link_self_check', sql`${t.sourceIssueId} <> ${t.targetIssueId}`),
    // A pair of issues carries a kind at most once, in either order: "A blocks B"
    // and "B blocks A" are the same relation stated twice and contradict each
    // other. Indexing the ordered pair makes the database reject the second one,
    // which a read-then-insert in the application cannot do without a race.
    uniqueIndex('issue_link_pair_kind_idx').on(
      sql`least(${t.sourceIssueId}, ${t.targetIssueId})`,
      sql`greatest(${t.sourceIssueId}, ${t.targetIssueId})`,
      t.kind,
    ),
    // The pair index is on least/greatest, so it serves neither column on its
    // own; these back the reads that match one side — an issue's own relations
    // (either side) and the board's marker (the source side).
    index('issue_link_source_idx').on(t.sourceIssueId),
    index('issue_link_target_idx').on(t.targetIssueId),
  ],
);

// Who follows an issue. A watcher receives every notification the issue produces;
// the assignment and mention notifications are addressed to one person and reach
// them whether they watch it or not. `subscribed` false is an unsubscription: the
// row stays so the auto-subscribe rules (see watchers.ts) cannot put the member
// back on the next comment they write.
export const issueWatcher = pgTable(
  'issue_watcher',
  {
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subscribed: boolean('subscribed').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.userId] })],
);

export const issueFieldValue = pgTable(
  'issue_field_value',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    valueText: text('value_text'),
    valueNumber: numeric('value_number'),
    valueBool: boolean('value_bool'),
    valueDate: date('value_date'),
    // datetime and datetime_range fields. A datetime_range keeps its end here;
    // for a datetime the end stays NULL.
    valueDatetime: timestamp('value_datetime', { withTimezone: true }),
    valueDatetimeEnd: timestamp('value_datetime_end', { withTimezone: true }),
    // member fields. Deleting the user clears the field rather than the row, so the
    // issue keeps the rest of its values.
    valueUserId: text('value_user_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [unique().on(t.issueId, t.fieldId)],
);

export const issueFieldOption = pgTable(
  'issue_field_option',
  {
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    fieldId: integer('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    optionId: integer('option_id')
      .notNull()
      .references(() => customFieldOption.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.fieldId, t.optionId] })],
);

// File attachments on issues. The file is in the vault (vault_path, relative to
// PROJECT_VAULT_ROOT), or, for a row not yet moved there, in the object store
// (s3_key). sha256 finds the file again after it was moved outside Plan. A linked
// row points at a vault file that existed before it and is never deleted with it.
// public_id is the unguessable id used in the public download URL.
export const issueAttachment = pgTable(
  'issue_attachment',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key'),
    vaultPath: text('vault_path'),
    sha256: text('sha256'),
    linked: boolean('linked').notNull().default(false),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('issue_attachment_issue_idx').on(t.issueId),
    index('issue_attachment_vault_path_idx').on(t.vaultPath),
    check(
      'issue_attachment_storage_check',
      sql`${t.s3Key} IS NOT NULL OR ${t.vaultPath} IS NOT NULL`,
    ),
  ],
);

export const issueDevelopmentLink = pgTable(
  'issue_development_link',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    repository: text('repository').notNull(),
    kind: text('kind').notNull().default('pull_request'),
    externalKey: text('external_key').notNull(),
    number: integer('number'),
    title: text('title').notNull(),
    url: text('url'),
    state: text('state').notNull(),
    draft: boolean('draft').notNull().default(false),
    sourceBranch: text('source_branch'),
    targetBranch: text('target_branch').notNull(),
    headSha: text('head_sha'),
    pipelineStatus: text('pipeline_status'),
    pipelineUrl: text('pipeline_url'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.issueId, t.provider, t.repository, t.externalKey),
    index('issue_development_link_issue_idx').on(t.issueId, t.updatedAt.desc()),
    index('issue_development_link_pr_idx').on(t.provider, t.repository, t.number),
    index('issue_development_link_sha_idx').on(t.provider, t.repository, t.headSha),
  ],
);

export const issueDevelopmentCheck = pgTable(
  'issue_development_check',
  {
    id: serial('id').primaryKey(),
    developmentLinkId: integer('development_link_id')
      .notNull()
      .references(() => issueDevelopmentLink.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    appId: text('app_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    url: text('url'),
    headSha: text('head_sha').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.developmentLinkId, t.appId, t.name),
    index('issue_development_check_link_sha_idx').on(t.developmentLinkId, t.headSha),
  ],
);

// A file uploaded in an agent chat. Bytes live in the S3-compatible object store;
// this table holds the metadata and the object key. public_id is the unguessable
// id used in the public download URL. Kept free of any workflow state so an
// upload can serve more than one purpose (an issue import, a spec, a log).
export const chatAttachment = pgTable(
  'chat_attachment',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    s3Key: text('s3_key'),
    vaultPath: text('vault_path'),
    sha256: text('sha256'),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('chat_attachment_project_idx').on(t.projectId),
    index('chat_attachment_vault_path_idx').on(t.vaultPath),
    check(
      'chat_attachment_storage_check',
      sql`${t.s3Key} IS NOT NULL OR ${t.vaultPath} IS NOT NULL`,
    ),
  ],
);

// An import of issues from a chat attachment: the column mapping an agent saved
// and the state of the draft. The file itself is the referenced chat_attachment;
// creating the issues happens only through the confirm route, never by the model
// itself.
export const issueImport = pgTable(
  'issue_import',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    attachmentId: integer('attachment_id')
      .notNull()
      .references(() => chatAttachment.id, { onDelete: 'cascade' }),
    // mapped: an agent saved a column mapping. confirmed: the issues were
    // created. canceled and failed are terminal, with errorText on a failure.
    status: text('status').notNull().default('mapped'),
    mapping: jsonb('mapping'),
    errorText: text('error_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_import_project_idx').on(t.projectId)],
);

// Checklists on an issue: a lightweight list of steps that does not warrant a
// subtask of its own. An issue holds several checklists, each ordered by position
// among the issue's checklists.
export const issueChecklist = pgTable(
  'issue_checklist',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_checklist_issue_idx').on(t.issueId, t.position)],
);

// One checkbox line of a checklist, ordered by position within its checklist.
export const issueChecklistItem = pgTable(
  'issue_checklist_item',
  {
    id: serial('id').primaryKey(),
    checklistId: integer('checklist_id')
      .notNull()
      .references(() => issueChecklist.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    done: boolean('done').notNull().default(false),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_checklist_item_checklist_idx').on(t.checklistId, t.position)],
);

// The time a member spent on an issue, one row per entry. The time an issue took is
// the sum of its entries and the time left is the estimate minus that sum; neither
// is stored, since two numbers kept next to the entries drift apart. Each entry
// belongs to the member who logged it, so several people log their own days on the
// same issue and one member's correction never overwrites another's.
export const issueWorklog = pgTable(
  'issue_worklog',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    // Who logged the entry. Their entries go with the account when it is deleted.
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    minutes: integer('minutes').notNull(),
    // The day the work happened on, which is not the day it was logged: a member
    // enters yesterday's work today.
    spentOn: date('spent_on').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('issue_worklog_minutes_check', sql`${t.minutes} > 0`),
    // Backs the entries of an issue, read newest day first, and the sums the issue
    // payload carries.
    index('issue_worklog_issue_idx').on(t.issueId, t.spentOn.desc()),
  ],
);

// One side of a change: the text the feed shows, and the id of the row behind it
// when the side names one. The text is a snapshot, so an entry still reads
// correctly after that row is renamed or deleted; the id is what makes the entry
// readable as data. Some actions carry more: a status change carries the state
// type its column had at the time, a pull request its repository and number.
export interface ActivitySide {
  value: string | null;
  id?: number | string | null;
  stateType?: string | null;
  repo?: string;
  number?: number;
  // A 'worklog' side carries the day its time was spent on: a change of an entry
  // can move it to another day.
  date?: string | null;
}

// What an activity entry says changed. `subject` names the sub-item the action
// applies to (the custom field for 'field', the checklist for a checklist item);
// `from` and `to` are the two sides of the change. A side the action does not
// have is absent, and an action that describes nothing carries {}.
export interface ActivityPayload {
  subject?: ActivitySide;
  from?: ActivitySide;
  to?: ActivitySide;
}

// Timeline of comments and change-log activity for issues and initiatives, in one
// table. Each row belongs to exactly one owner: an issue (issue_id) or an
// initiative (initiative_id) — enforced by owner_check. kind selects which columns
// a row uses — a comment sets body; activity sets action and payload.
// actor_user_id is the author, taken from the session user (a member or an
// agent's bot user). actor_name is a snapshot so an entry still reads correctly
// after that user is renamed or deleted.
export const issueActivity = pgTable(
  'issue_activity',
  {
    id: serial('id').primaryKey(),
    issueId: integer('issue_id').references(() => issue.id, {
      onDelete: 'cascade',
    }),
    initiativeId: integer('initiative_id').references(() => initiative.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').notNull(),
    // The comment this one replies to, for the threaded feed. Only comments carry
    // it, and the parent belongs to the same issue. Deleting a comment deletes its
    // replies with it.
    replyToId: integer('reply_to_id').references((): AnyPgColumn => issueActivity.id, {
      onDelete: 'cascade',
    }),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name'),
    body: text('body'),
    action: text('action'),
    payload: jsonb('payload').$type<ActivityPayload>().notNull().default({}),
    // Set when a comment is edited; null on entries never changed.
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('issue_activity_kind_check', sql`${t.kind} IN ('comment', 'activity')`),
    // Exactly one owner: an issue row or an initiative row, never both or neither.
    check(
      'issue_activity_owner_check',
      sql`(${t.issueId} IS NOT NULL) <> (${t.initiativeId} IS NOT NULL)`,
    ),
    index('issue_activity_issue_idx').on(t.issueId, t.createdAt.desc(), t.id.desc()),
    index('issue_activity_reply_idx').on(t.replyToId),
    index('issue_activity_initiative_idx').on(t.initiativeId, t.createdAt.desc(), t.id.desc()),
  ],
);

// The areas of a project (one level): each holds saved views and the issues planned
// in it, and a view inside an area shows only that area's issues. The columns, types,
// labels and fields stay the project's, shared by every area.
export const projectViewFolder = pgTable(
  'project_view_folder',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // The area's directory, relative to the project workspace and to the project's
    // vault folder. The integration service creates, moves and trashes both.
    folder: text('folder').notNull(),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('project_view_folder_project_name_unique').on(t.projectId, t.name),
    unique('project_view_folder_project_folder_unique').on(t.projectId, t.folder),
    index('project_view_folder_project_idx').on(t.projectId, t.position),
  ],
);

// Saved views (the tabs above a project's work items view). filters and display are jsonb
// blobs owned by the UI; the server stores and returns them without inspecting
// them. position orders the tabs within the optional folder.
export const projectView = pgTable(
  'project_view',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id').references(() => projectViewFolder.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    icon: text('icon'),
    filters: jsonb('filters').notNull().default({}),
    display: jsonb('display').notNull().default({}),
    position: doublePrecision('position').notNull().default(0),
    // Unguessable token for the public read-only share link of this view. NULL
    // means not shared; setting it enables the link, clearing it revokes access.
    shareToken: uuid('share_token').unique(),
    // How much of each issue the share link exposes. False keeps the public
    // payload to the issue's title, description, state, type, priority, dates,
    // subtasks and links; true adds the assignees, labels, custom fields and
    // activity the members see.
    shareExtended: boolean('share_extended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_view_project_idx').on(t.projectId, t.folderId, t.position)],
);

// The saved views a user marked as favorite. Favorites are personal: they pin the
// view's tab to the front of the tab row and list it under Work items in the
// sidebar, for that user only.
export const projectViewFavorite = pgTable(
  'project_view_favorite',
  {
    viewId: integer('view_id')
      .notNull()
      .references(() => projectView.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.viewId, t.userId] })],
);

// Saved dashboards (the analytics tabs of a project). layout is a jsonb blob
// owned by the UI: an ordered list of widget entries, each carrying its type,
// width, title, and widget-specific config. The server stores and returns it
// without inspecting it. position orders the tabs.
export const projectDashboard = pgTable(
  'project_dashboard',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    layout: jsonb('layout').notNull().default([]),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_dashboard_project_idx').on(t.projectId, t.position)],
);

// Note boards: a freeform canvas of sticky notes. owner_user_id NULL means a public
// board visible to every project member; a set owner_user_id means a private board,
// seen by its owner and by the members listed in note_board_member. Only the creator
// (created_by_user_id) may change any of it.
//
// A public board's canvas is a JSON Canvas file in the project's vault folder
// (vault_path, normally Projects/<KEY>/Boards/<Name>.canvas): versioned, found by the
// search, read by agents and opened by Obsidian. vault_sha256 finds it again after it
// was moved outside Helena. A private or restricted board keeps its canvas here in
// `canvas` (the UI's React Flow graph), because the vault's access is per folder and
// cannot keep a board to a few members.
export const noteBoard = pgTable(
  'note_board',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    canvas: jsonb('canvas').notNull().default({}),
    vaultPath: text('vault_path'),
    vaultSha256: text('vault_sha256'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Listed by updatedAt within a project; the index covers the project filter.
  (t) => [
    index('note_board_project_idx').on(t.projectId, t.updatedAt),
    uniqueIndex('note_board_vault_path_key')
      .on(t.vaultPath)
      .where(sql`${t.vaultPath} IS NOT NULL`),
  ],
);

// The members granted access to a private board besides its owner. A private board
// with at least one row here is what the UI calls "restricted".
export const noteBoardMember = pgTable(
  'note_board_member',
  {
    boardId: integer('board_id')
      .notNull()
      .references(() => noteBoard.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  // The board list filters by the viewer, so it reads this table by user first.
  (t) => [
    primaryKey({ columns: [t.boardId, t.userId] }),
    index('note_board_member_user_idx').on(t.userId),
  ],
);

// Declarative actions: saved issue patches that run manually, when an issue moves
// to another state, or after an authorized inbox message is linked. Conditions and
// effects are schema-validated by the API.
export const projectAction = pgTable(
  'project_action',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Icon key for the action, resolved to a lucide icon by the UI (empty = default).
    icon: text('icon').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    trigger: text('trigger').notNull().default('manual'),
    condition: jsonb('condition').notNull().default({}),
    effect: jsonb('effect').notNull().default({}),
    workflow: jsonb('workflow'),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'project_action_trigger_check',
      sql`${t.trigger} IN ('manual', 'issue_state_changed', 'issue_comment_added')`,
    ),
    index('project_action_project_idx').on(t.projectId, t.position),
  ],
);

// Durable execution log and outbox for actions. A state change or linked inbox
// comment inserts pending rows in the same transaction as its evidence. root_event_id,
// action_id and the target column make a step idempotent while still allowing a chain
// to reach a new state.
export const projectActionRun = pgTable(
  'project_action_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actionId: integer('action_id').references(() => projectAction.id, { onDelete: 'set null' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    // Keep the audit record when a work item is deleted. Pending runs with no
    // work item are terminally skipped by the runner.
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'set null' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    actionName: text('action_name').notNull(),
    trigger: text('trigger').notNull(),
    fromColumnId: integer('from_column_id').notNull(),
    toColumnId: integer('to_column_id').notNull(),
    rootEventId: uuid('root_event_id').notNull(),
    depth: integer('depth').notNull().default(0),
    condition: jsonb('condition').notNull().default({}),
    effect: jsonb('effect').notNull().default({}),
    workflow: jsonb('workflow'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    result: jsonb('result').$type<{ changedFields: string[] }>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'project_action_run_trigger_check',
      sql`${t.trigger} IN ('manual', 'issue_state_changed', 'issue_comment_added')`,
    ),
    check(
      'project_action_run_status_check',
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'skipped', 'failed')`,
    ),
    uniqueIndex('project_action_run_step_uq').on(t.rootEventId, t.actionId, t.toColumnId),
    index('project_action_run_due_idx').on(t.status, t.nextAttemptAt),
    index('project_action_run_project_idx').on(t.projectId, t.createdAt.desc()),
  ],
);

// Outgoing webhook subscription. On a subscribed event the API posts the event
// payload to `url`, signed with `secret` (HMAC-SHA256). `events` is the list of
// event types this subscription wants (e.g. "issue.created"); `is_active` gates
// delivery without deleting the row. Delivery itself is handled separately.
export const webhook = pgTable(
  'webhook',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    events: jsonb('events').notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    // Count of consecutive failed deliveries. Reset to 0 on a successful delivery.
    // When it crosses the worker's threshold the webhook is auto-disabled
    // (is_active set false) so one dead endpoint cannot occupy the worker.
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_project_idx').on(t.projectId)],
);

// Delivery queue (transactional outbox) for webhooks. One row per (event ×
// subscribed webhook), inserted in the same transaction as the domain change so
// it is atomic with it. The worker claims due rows, posts the payload to the
// webhook, and records the outcome. event_id is stable across retries so the
// receiver can deduplicate. status: pending | success | failed.
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: serial('id').primaryKey(),
    webhookId: integer('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    // Response from the last delivery attempt, for the delivery history view.
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Backs the worker's claim query: due pending rows ordered by next_attempt_at.
    index('webhook_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('webhook_delivery_webhook_idx').on(t.webhookId),
  ],
);

// External message sources discovered through the host integration service. Secrets
// and provider credentials stay in that service; this row only reports health and
// controls triage and optional task creation for one account.
export const hubInboxSource = pgTable(
  'hub_inbox_source',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    account: text('account').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    status: text('status').notNull().default('disabled'),
    cursor: text('cursor'),
    confidenceThreshold: doublePrecision('confidence_threshold').notNull().default(0.75),
    autoCreateTasks: boolean('auto_create_tasks').notNull().default(false),
    autoTaskProjectId: integer('auto_task_project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    automationActorUserId: text('automation_actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    nextSyncAt: timestamp('next_sync_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('hub_inbox_source_channel_check', sql`${t.channel} IN ('mail', 'whatsapp')`),
    check(
      'hub_inbox_source_status_check',
      sql`${t.status} IN ('disabled', 'connecting', 'connected', 'error')`,
    ),
    check(
      'hub_inbox_source_confidence_check',
      sql`${t.confidenceThreshold} >= 0 AND ${t.confidenceThreshold} <= 1`,
    ),
    unique().on(t.teamId, t.channel, t.account),
    index('hub_inbox_source_due_idx').on(t.enabled, t.nextSyncAt),
  ],
);

// Durable normalized events returned by the host adapter. The unique provider id
// makes overlapping sync windows and push redeliveries idempotent. Only bounded
// metadata and a short snippet are stored; provider message bodies stay at source.
export const hubInboxEvent = pgTable(
  'hub_inbox_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => hubInboxSource.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    externalEventId: text('external_event_id').notNull(),
    externalThreadId: text('external_thread_id').notNull(),
    externalMessageId: text('external_message_id').notNull(),
    issueActivityId: integer('issue_activity_id').references(() => issueActivity.id, {
      onDelete: 'set null',
    }),
    sender: text('sender').notNull(),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'hub_inbox_event_status_check',
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed')`,
    ),
    unique().on(t.sourceId, t.externalEventId),
    unique().on(t.issueActivityId),
    index('hub_inbox_event_due_idx').on(t.status, t.nextAttemptAt),
    index('hub_inbox_event_thread_idx').on(t.sourceId, t.externalThreadId, t.receivedAt.desc()),
  ],
);

// One unified inbox row per provider thread. Triage is asynchronous because the
// The classifier hook may return a run id before classification completes. A project and
// issue link always reference validated local rows.
export const hubInboxThread = pgTable(
  'hub_inbox_thread',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => hubInboxSource.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    externalThreadId: text('external_thread_id').notNull(),
    latestExternalMessageId: text('latest_external_message_id').notNull(),
    sender: text('sender').notNull(),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    externalUrl: text('external_url'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(1),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('new'),
    priority: text('priority'),
    triageSummary: text('triage_summary'),
    triageStatus: text('triage_status').notNull().default('pending'),
    triageRunId: text('triage_run_id'),
    triageGeneration: integer('triage_generation').notNull().default(0),
    triageAttempts: integer('triage_attempts').notNull().default(0),
    nextTriageAt: timestamp('next_triage_at', { withTimezone: true }).notNull().defaultNow(),
    lastTriageError: text('last_triage_error'),
    confidence: doublePrecision('confidence'),
    requiresAction: boolean('requires_action'),
    ticketStatus: text('ticket_status').notNull().default('none'),
    ticketAttempts: integer('ticket_attempts').notNull().default(0),
    nextTicketAt: timestamp('next_ticket_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'hub_inbox_thread_status_check',
      sql`${t.status} IN ('new', 'assigned', 'waiting', 'done')`,
    ),
    check(
      'hub_inbox_thread_priority_check',
      sql`${t.priority} IS NULL OR ${t.priority} IN ('low', 'medium', 'high', 'urgent')`,
    ),
    check(
      'hub_inbox_thread_triage_status_check',
      sql`${t.triageStatus} IN ('pending', 'queued', 'running', 'succeeded', 'needs_review', 'failed', 'skipped')`,
    ),
    check(
      'hub_inbox_thread_ticket_status_check',
      sql`${t.ticketStatus} IN ('none', 'pending', 'running', 'created', 'failed', 'skipped')`,
    ),
    check(
      'hub_inbox_thread_confidence_check',
      sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
    ),
    unique().on(t.sourceId, t.externalThreadId),
    index('hub_inbox_thread_team_idx').on(t.teamId, t.receivedAt.desc()),
    index('hub_inbox_thread_project_idx').on(t.projectId, t.receivedAt.desc()),
    index('hub_inbox_thread_triage_due_idx').on(t.triageStatus, t.nextTriageAt),
    index('hub_inbox_thread_ticket_due_idx').on(t.ticketStatus, t.nextTicketAt),
  ],
);

// Per-user inbox notifications. One row per (recipient, event): a user is notified
// about an issue they are involved in (assigned to them, mentioned, or watching it
// when it is commented on or moved). The actor's own actions never notify the actor.
// project_id is denormalized from the issue so the inbox can filter and scope by
// project. source_activity_id points at the issue_activity row that produced the
// notification (set null if that entry is later removed). type selects the kind.
// read_at NULL means unread; snoozed_until, when set and still in the future, hides
// the row from the default inbox until then.
export const notification = pgTable(
  'notification',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    issueId: integer('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    sourceActivityId: integer('source_activity_id').references(() => issueActivity.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name'),
    readAt: timestamp('read_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'notification_type_check',
      sql`${t.type} IN ('assigned', 'mentioned', 'commented', 'state_changed', 'approval_requested')`,
    ),
    // Backs the inbox list: a user's notifications newest first.
    index('notification_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    // Backs the unread count and the unread-only inbox view.
    index('notification_user_unread_idx')
      .on(t.userId, t.id.desc())
      .where(sql`${t.readAt} IS NULL`),
  ],
);

// Change markers for live refresh: one counter per scope, bumped by the triggers
// in migration 0070 on every write to the tables that scope covers. A scope names
// what a screen watches — 'board:<projectId>', 'issue:<issueId>',
// 'initiative:<initiativeId>', 'inbox:<projectId>:<userId>'. Clients poll the
// counters they watch and refetch the matching queries when one moves; the value
// itself is opaque to them, only equality matters.
//
// project_id carries no foreign key on purpose. Deleting a project cascades into
// its issues, and each of those deletes fires a trigger that inserts a row here
// for a project that is already gone — a foreign key would abort the delete. The
// rows are removed by the trigger on project instead.
export const revision = pgTable(
  'revision',
  {
    scope: text('scope').primaryKey(),
    projectId: integer('project_id').notNull(),
    rev: bigint('rev', { mode: 'number' }).notNull().default(0),
  },
  // Backs both the project cleanup and the membership join the read does.
  (t) => [index('revision_project_idx').on(t.projectId)],
);

// A step-up terminal grant: the owner re-authenticated (TOTP or passkey) and may open
// Claude Code, Codex and Shell sessions on the host as `wilhelmpa` for 12 hours. Only
// the instance owner ever holds one — enforced in the service, not by a column here.
// One active row per owner: a new step-up replaces it (`ownerTerminalGrant` in the
// service revokes the previous row rather than stacking). `sessionId` binds the grant
// to the better-auth session it was issued for, so signing out or a session revoke
// invalidates it without a separate check.
export const ownerTerminalGrant = pgTable(
  'owner_terminal_grant',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    method: text('method').notNull(),
    device: text('device').notNull(),
    ipAddress: text('ip_address').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('owner_terminal_grant_method_check', sql`${t.method} IN ('totp', 'passkey')`),
    uniqueIndex('owner_terminal_grant_session_uq').on(t.sessionId),
    // Backs "the owner's current grant": newest first, filtered to unrevoked in the query.
    index('owner_terminal_grant_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);

// Audit trail for the owner terminal: every step-up attempt, rate-limit lockout, grant
// revocation, session start/end and rejected token. Shown at Home -> Security. `kind` and
// `sessionName` are set for a session event, null for a step-up/grant event.
export const ownerTerminalAudit = pgTable(
  'owner_terminal_audit',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    kind: text('kind'),
    sessionName: text('session_name'),
    device: text('device'),
    ipAddress: text('ip_address'),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'owner_terminal_audit_event_check',
      sql`${t.event} IN ('step_up_ok', 'step_up_fail', 'rate_limited', 'grant_revoked', 'session_start', 'session_end', 'token_rejected', 'sudo_changed')`,
    ),
    index('owner_terminal_audit_user_idx').on(t.userId, t.createdAt.desc()),
    // Backs the rate-limit window query: failures of one user in the last 15 minutes.
    index('owner_terminal_audit_event_idx').on(t.userId, t.event, t.createdAt),
  ],
);

// Durable admission for explicit project mail-triage batches. No TTL/takeover.
export interface MailTriageRuntime {
  version: 1;
  machineId: string;
  bootId: string;
  pid: number;
  startTicks: string;
  pidNamespace: string;
  uid: number;
  instance: string;
  databaseRuntimeName: string;
}

export const helenaMailTriageClaim = pgTable('helena_mail_triage_claim', {
  projectId: integer('project_id')
    .primaryKey()
    .references(() => project.id, { onDelete: 'cascade' }),
  runToken: text('run_token').notNull(),
  runtime: jsonb('runtime').$type<MailTriageRuntime>().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
});
