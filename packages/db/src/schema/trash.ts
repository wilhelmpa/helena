import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { project, team } from './app';

export const volitionTrashPurge = pgTable(
  'volition_trash_purge',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    teamId: integer('team_id').references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    kind: text('kind').$type<'chat' | 'vault'>().notNull(),
    trigger: text('trigger').$type<'manual' | 'schedule'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('volition_trash_purge_kind_check', sql`${t.kind} in ('chat', 'vault')`),
    index('volition_trash_purge_project_idx').on(t.projectId, t.createdAt),
    index('volition_trash_purge_batch_idx').on(t.batchId),
  ],
);
