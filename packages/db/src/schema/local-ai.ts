// Local AI (docs/helena-decisions/local-ai-platform.md): the model servers on Helena's own
// machine or in its LAN (Lemonade on the Strix Halo), what Helena last read from each, and
// the evals a local model passed or failed for a kind of work. The policy itself (master
// switch, units, task classes) is one app_setting row, `localAi.policy`. A server's key is
// never stored here: it is read from a key file the installer wrote, or from app_secret.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { LocalModel, ModelServerStatus } from '@helena/sdk';
import { user } from './auth';

export const helenaModelServer = pgTable(
  'helena_model_server',
  {
    id: serial('id').primaryKey(),
    // Names the server's Hermes provider (`helena-<slug>`) and its models
    // (`helena-<slug>/<model>`); never changes once agents use it.
    slug: text('slug').notNull(),
    // The model server type (@helena/sdk ModelServerType): `lemonade`, `openai-compatible`.
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    // The base of its OpenAI-compatible API, ending in /v1.
    baseUrl: text('base_url').notNull(),
    // Where its key comes from: a key file below /etc/helena (the installer's), a key the
    // Administrator entered (app_secret `localAi.server.<slug>`), or none.
    keySource: text('key_source').notNull().default('file'),
    keyFile: text('key_file'),
    enabled: boolean('enabled').notNull().default(true),
    // The context window Hermes is told the server serves (Hermes needs at least 64k).
    contextLength: integer('context_length').notNull().default(65536),
    // What Helena last read: the models and the status, and when.
    models: jsonb('models').$type<LocalModel[]>().notNull().default([]),
    status: jsonb('status').$type<ModelServerStatus | null>(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_model_server_slug_idx').on(t.slug),
    check(
      'helena_model_server_key_source_check',
      sql`${t.keySource} IN ('file', 'stored', 'none')`,
    ),
  ],
);

// One eval of a local model for a task class: its score and whether it passed the class's
// threshold. The newest passing eval of a class's model is what lets the owner switch the
// class to local.
export const helenaLocalAiEval = pgTable(
  'helena_local_ai_eval',
  {
    id: serial('id').primaryKey(),
    classId: text('class_id').notNull(),
    serverId: integer('server_id')
      .notNull()
      .references(() => helenaModelServer.id, { onDelete: 'cascade' }),
    // The model's id on the server.
    model: text('model').notNull(),
    score: real('score').notNull(),
    threshold: real('threshold').notNull(),
    passed: boolean('passed').notNull(),
    cases: integer('cases').notNull(),
    // The failed cases (short English notes), clipped.
    details: jsonb('details').notNull().default([]),
    latencyMsP50: integer('latency_ms_p50'),
    tokensPerSecond: real('tokens_per_second'),
    error: text('error'),
    // The version of the class's eval it ran (@helena/sdk LocalAiTaskClass.evalVersion): an
    // eval of an older version no longer gates the class.
    evalVersion: integer('eval_version').notNull().default(1),
    // `running` while the eval asks its cases (it runs in the background: a class takes minutes
    // on a local model), `done` once its score is in. Only a done eval gates a class.
    status: text('status').notNull().default('done'),
    ranBy: text('ran_by').references(() => user.id, { onDelete: 'set null' }),
    // When it started; `finishedAt` when its score came in.
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('helena_local_ai_eval_class_idx').on(t.classId, t.ranAt),
    check('helena_local_ai_eval_status_check', sql`${t.status} IN ('running', 'done')`),
  ],
);
