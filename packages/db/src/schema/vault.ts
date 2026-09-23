// The index of the knowledge vault (PROJECT_VAULT_ROOT). The Markdown and other files
// in the vault are the source of truth; these rows are rebuilt from them by the vault
// watcher in the worker and by the API right after its own writes, and can be dropped
// and rebuilt at any time.
import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { project } from './app';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export type VaultEntryKind = 'note' | 'file' | 'folder';

// none: nothing to extract (a folder, or a note whose text is its body)
// pending: queued for the worker
// done / failed / skipped (an unsupported type or over the size limit)
// unavailable: the program that reads this type is not installed; retried once it is
export type VaultExtractionStatus =
  'none' | 'pending' | 'done' | 'failed' | 'skipped' | 'unavailable';

// The search document is capped per part: a tsvector is limited to 1 MB, so the text of
// a very long file is searchable in its first 100,000 characters.
export const vaultEntry = pgTable(
  'vault_entry',
  {
    id: serial('id').primaryKey(),
    // Relative to the vault root, '/'-separated: "Projects/VOL/Docs/Spec.md".
    path: text('path').notNull().unique(),
    // Resolved from the key in Projects/<KEY>/ when the row is written.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    kind: text('kind').$type<VaultEntryKind>().notNull(),
    mime: text('mime'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    mtime: timestamp('mtime', { withTimezone: true }),
    sha256: text('sha256'),
    title: text('title').notNull().default(''),
    frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().notNull().default({}),
    text: text('text'),
    search: tsvector('search').generatedAlwaysAs(
      sql`setweight(to_tsvector('german'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || translate(path, '/._-', '    ') || ' ' || coalesce(frontmatter ->> 'tags', '')), 'A') || setweight(to_tsvector('german'::regconfig, left(coalesce(text, ''), 100000)), 'B') || setweight(to_tsvector('simple'::regconfig, left(coalesce(text, ''), 100000)), 'D')`,
    ),
    extractionStatus: text('extraction_status')
      .$type<VaultExtractionStatus>()
      .notNull()
      .default('none'),
    extractionError: text('extraction_error'),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('vault_entry_path_prefix_idx').using('btree', t.path.op('text_pattern_ops')),
    index('vault_entry_project_idx').on(t.projectId),
    index('vault_entry_sha_idx').on(t.sha256),
    index('vault_entry_search_idx').using('gin', t.search),
    index('vault_entry_extraction_idx').on(t.extractionStatus),
  ],
);

export type VaultLinkKind = 'note' | 'task' | 'url';

// The links a note makes, parsed from its text: a wikilink or relative Markdown link to
// another vault file (target as written, without ".md"), a task identifier such as
// "VOL-12" from [[VOL-12]], or an http(s) URL. A note target is matched against a path
// when it is read, so a link keeps working when the file it names is created later.
export const vaultLink = pgTable(
  'vault_link',
  {
    id: serial('id').primaryKey(),
    entryId: integer('entry_id')
      .notNull()
      .references(() => vaultEntry.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<VaultLinkKind>().notNull(),
    target: text('target').notNull(),
  },
  (t) => [
    index('vault_link_entry_idx').on(t.entryId),
    index('vault_link_target_idx').on(t.kind, t.target),
  ],
);

// Every move or rename the index saw: a file whose sha256 disappeared at one path and
// appeared at another, or a move made through Plan. A reference that stored a path and
// a sha finds the file's current path through these rows.
export const vaultMove = pgTable(
  'vault_move',
  {
    id: serial('id').primaryKey(),
    fromPath: text('from_path').notNull(),
    toPath: text('to_path').notNull(),
    sha256: text('sha256'),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vault_move_from_idx').on(t.fromPath, t.movedAt)],
);
