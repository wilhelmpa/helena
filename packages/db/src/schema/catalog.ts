import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { team, agentSkill, agentMcpServer, aiAgent } from './app';
import { user } from './auth';

// Only a team owner can curate a source. A source names one GitHub repository or one
// package; discovery cannot expand the trust boundary to another repository/registry.
export const catalogSource = pgTable(
  'volition_catalog_source',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    locator: text('locator').notNull(),
    role: text('role').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.kind, t.locator),
    check(
      'volition_catalog_source_kind_check',
      sql`${t.kind} IN ('github-skills', 'npm-mcp', 'pypi-mcp', 'github-mcp')`,
    ),
  ],
);

export const catalogItem = pgTable(
  'volition_catalog_item',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => catalogSource.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    latestRevisionId: integer('latest_revision_id'),
  },
  (t) => [unique().on(t.sourceId, t.path), index('volition_catalog_item_name_idx').on(t.name)],
);

// Immutable inspected bytes and findings. The pin is a commit or exact package version.
export const catalogRevision = pgTable(
  'volition_catalog_revision',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => catalogItem.id, { onDelete: 'cascade' }),
    pin: text('pin').notNull(),
    sha256: text('sha256').notNull(),
    license: text('license'),
    size: integer('size').notNull(),
    manifest: jsonb('manifest').notNull(),
    findings: jsonb('findings').notNull(),
    approved: text('approved').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.itemId, t.pin),
    check(
      'volition_catalog_revision_approved_check',
      sql`${t.approved} IN ('pending', 'accepted', 'rejected')`,
    ),
  ],
);

export const catalogInstall = pgTable(
  'volition_catalog_install',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => catalogItem.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    revisionId: integer('revision_id')
      .notNull()
      .references(() => catalogRevision.id),
    previousRevisionId: integer('previous_revision_id').references(() => catalogRevision.id),
    skillId: integer('skill_id').references(() => agentSkill.id, { onDelete: 'set null' }),
    mcpServerId: integer('mcp_server_id').references(() => agentMcpServer.id, {
      onDelete: 'set null',
    }),
    scope: jsonb('scope').notNull().default({}),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.teamId, t.itemId)],
);

export const catalogProposal = pgTable(
  'volition_catalog_proposal',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    itemId: integer('item_id')
      .notNull()
      .references(() => catalogItem.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    proposedBy: text('proposed_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('volition_catalog_proposal_team_idx').on(t.teamId, t.state),
    check(
      'volition_catalog_proposal_state_check',
      sql`${t.state} IN ('pending', 'accepted', 'rejected')`,
    ),
  ],
);
