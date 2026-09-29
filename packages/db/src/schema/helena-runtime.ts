// Helena's own agent loop (runtime `helena`, packages/agent-runtime,
// docs/helena-decisions/zentrale-laufzeit.md): its sessions, and the fact store every runtime
// reaches through Helena's MCP server. The memory files and daily notes stay in
// agent_memory_revision (app.ts); their vectors and the fact vectors live in the knowledge
// index (knowledge.ts), fed by the knowledge sources `agent-session`, `agent-memory` and
// `fact`.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { agentRun, aiAgent, project, team } from './app';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// One conversation of the loop: a run's or a chat thread's. Resumed by its id after the runner
// restarts (`--resume`).
export const helenaAgentSession = pgTable(
  'helena_agent_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // Null for the Home agent's own work.
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatThreadId: text('chat_thread_id'),
    model: text('model'),
    // The summary that stands in the prompt for the items up to `compacted_through`; the
    // items stay.
    summary: text('summary'),
    compactedThrough: integer('compacted_through').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('helena_agent_session_kind_check', sql`${t.kind} IN ('run', 'chat', 'reflection')`),
    index('helena_agent_session_agent_idx').on(t.agentId, t.updatedAt),
    index('helena_agent_session_run_idx').on(t.runId),
  ],
);

// The messages of a session, in the AI SDK's ModelMessage shape, one per row. Appended with
// their sequence number, so the same step saved twice (a retry) is stored once.
export const helenaAgentSessionItem = pgTable(
  'helena_agent_session_item',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => helenaAgentSession.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    step: integer('step').notNull(),
    role: text('role').notNull(),
    content: jsonb('content').notNull(),
    // What the knowledge index reads of it (the session search).
    text: text('text').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('helena_agent_session_item_seq_unique').on(t.sessionId, t.seq),
    check(
      'helena_agent_session_item_role_check',
      sql`${t.role} IN ('system', 'user', 'assistant', 'tool')`,
    ),
  ],
);

// A fact an agent (or the owner) keeps, with the trust it has earned. Its vector for the
// algebraic queries (HRR, @helena/facts) is here; its text vector is the knowledge index's.
export const helenaFact = pgTable(
  'helena_fact',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    // Null: team-wide (the Home agent's).
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    // The agent that added it; null when the owner did.
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    category: text('category').notNull().default('general'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    trust: real('trust').notNull().default(0.5),
    helpfulCount: integer('helpful_count').notNull().default(0),
    unhelpfulCount: integer('unhelpful_count').notNull().default(0),
    confirmations: integer('confirmations').notNull().default(0),
    retrievalCount: integer('retrieval_count').notNull().default(0),
    contradictedBy: integer('contradicted_by').references((): AnyPgColumn => helenaFact.id, {
      onDelete: 'set null',
    }),
    hrr: bytea('hrr'),
    // Where it came from: { runId, messageId, sessionId, userId }.
    source: jsonb('source')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Removed facts are hidden, not deleted.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('helena_fact_trust_check', sql`${t.trust} >= 0 AND ${t.trust} <= 1`),
    index('helena_fact_scope_idx').on(t.teamId, t.projectId),
    index('helena_fact_agent_idx').on(t.agentId),
    index('helena_fact_updated_idx').on(t.updatedAt),
  ],
);

export const helenaFactEntity = pgTable(
  'helena_fact_entity',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameLower: text('name_lower').notNull(),
  },
  (t) => [
    uniqueIndex('helena_fact_entity_name_unique').on(
      t.teamId,
      sql`coalesce(${t.projectId}, 0)`,
      t.nameLower,
    ),
  ],
);

export const helenaFactEntityLink = pgTable(
  'helena_fact_entity_link',
  {
    factId: integer('fact_id')
      .notNull()
      .references(() => helenaFact.id, { onDelete: 'cascade' }),
    entityId: integer('entity_id')
      .notNull()
      .references(() => helenaFactEntity.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.factId, t.entityId] }),
    index('helena_fact_entity_link_entity_idx').on(t.entityId),
  ],
);
