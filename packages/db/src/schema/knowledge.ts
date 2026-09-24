// The second brain's search index: one row per item of every knowledge source (tasks,
// comments, vault notes and files, mail, chats, agent runs, a plugin's own). The
// sources stay the truth; these rows are derived by the knowledge indexer
// (@helena/knowledge) and can be dropped and rebuilt at any time. See
// docs/helena-decisions/second-brain.md.
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { project, team } from './app';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

// Who may see an item (the @helena/sdk KnowledgeScope):
// - project: members of project_id whose role reads `permission` there (any member
//   when it is null);
// - team: items of no project; the team's owners and admins, and the members whose
//   reach names `permission` (every member when it is null);
// - private: owner_id only.
export type KnowledgeVisibility = 'project' | 'team' | 'private';

export type KnowledgeMetadata = Record<string, string | number | boolean | string[] | null>;

// The text is searchable in its first 100,000 characters, like vault_entry (a tsvector
// is capped at 1 MB); the stored text itself is capped by the indexer.
export const knowledgeItem = pgTable(
  'knowledge_item',
  {
    id: serial('id').primaryKey(),
    // The registered source (`vault`, `issue`, `comment`, `mail`, `chat`, `run`, a
    // plugin's id) and the item's id within it.
    source: text('source').notNull(),
    itemId: text('item_id').notNull(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    visibility: text('visibility').$type<KnowledgeVisibility>().notNull(),
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    // The role-matrix resource a reader needs (`work_items`, `documents`, `mail`, …).
    permission: text('permission'),
    title: text('title').notNull().default(''),
    text: text('text').notNull().default(''),
    // Where the item opens: a Helena route, or an outside URL.
    href: text('href').notNull(),
    mimeType: text('mime_type'),
    language: text('language'),
    // Results of one group (the messages of a mail thread, the comments of a task)
    // collapse into the best-ranked one.
    groupKey: text('group_key'),
    metadata: jsonb('metadata').$type<KnowledgeMetadata>().notNull().default({}),
    // Provenance: `user:<id>`, `agent:<id>`, `system`, `extern`, `plugin:<id>`; the
    // outside origin (a page URL, a Message-ID); the agent run that wrote it.
    author: text('author'),
    origin: text('origin'),
    runId: integer('run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    // sha256 of what was indexed, so an unchanged item is skipped.
    contentHash: text('content_hash').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('german'::regconfig, left(coalesce(text, ''), 100000)), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce(text, ''), 100000)), 'D')`,
    ),
  },
  (t) => [
    unique('knowledge_item_source_item_key').on(t.source, t.itemId),
    index('knowledge_item_search_idx').using('gin', t.search),
    index('knowledge_item_scope_idx').on(t.teamId, t.projectId),
    index('knowledge_item_owner_idx').on(t.ownerId),
    index('knowledge_item_updated_idx').on(t.updatedAt.desc()),
  ],
);

export type KnowledgeLinkKind = 'mentions' | 'parent' | 'attachment' | 'reply' | 'related';

// The links an item makes, resolved to another item (`<source>:<id>`) where the target
// source knows the reference, else kept as written (a URL, an unresolved wikilink). Read
// backwards they are the backlinks shown on a task, a note or a mail.
export const knowledgeLink = pgTable(
  'knowledge_link',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => knowledgeItem.id, { onDelete: 'cascade' }),
    target: text('target').notNull(),
    kind: text('kind').$type<KnowledgeLinkKind>().notNull(),
  },
  (t) => [
    index('knowledge_link_item_idx').on(t.itemId),
    index('knowledge_link_target_idx').on(t.target),
  ],
);

// How far the indexer got with each source: the newest change it has indexed (with an
// overlap on the next run, since rows commit out of order), when it last walked the
// whole source to drop deleted items, and what went wrong last.
export const knowledgeSourceState = pgTable('knowledge_source_state', {
  source: text('source').primaryKey(),
  watermark: timestamp('watermark', { withTimezone: true }),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSweepAt: timestamp('last_sweep_at', { withTimezone: true }),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Passages of an item for semantic search: the item's text split into chunks, each
// with its embedding once an embedding model is enabled (Administrator → Wissen). The
// vectors are plain real[] so the table needs no extension; with pgvector installed
// the indexer adds an indexed vector column beside it (see @helena/knowledge vectors).
export const knowledgeChunk = pgTable(
  'knowledge_chunk',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .notNull()
      .references(() => knowledgeItem.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    text: text('text').notNull(),
    contentHash: text('content_hash').notNull(),
    // The model that embedded it, so a model change re-embeds.
    model: text('model'),
    embedding: real('embedding').array(),
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),
  },
  (t) => [
    unique('knowledge_chunk_item_ordinal_key').on(t.itemId, t.ordinal),
    index('knowledge_chunk_pending_idx')
      .on(t.id)
      .where(sql`${t.embedding} IS NULL`),
  ],
);
