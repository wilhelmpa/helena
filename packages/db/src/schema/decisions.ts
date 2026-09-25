// Typed decisions (docs/helena-decisions/decisions.md) and the features built on them: the
// model router of agents' runs and chat answers, and the mail classifier.
//
// - helena_decision_class_setting: per team and decision class, whether it is on, which
//   decision model connection (a `decision_model` credential in Zugänge) answers it, a second
//   one tried when the first fails, the confidence threshold, the failsafe, whether the log
//   may keep the input, and the class's own settings (the mail classifier's actions …).
// - helena_decision: one row per question asked: what was chosen with which probability and
//   confidence, by which backend and model, how long it took, what it cost, whether it was
//   above the threshold, and later the right answer (the owner's correction, or what the
//   caller learned). The input itself only where the class allows it and the owner switched
//   it on; otherwise its SHA-256.
// - helena_decision_eval: every eval of a class against a backend: precision above the
//   threshold, coverage, latency and cost. A class may be switched on only after its newest
//   eval on the chosen connection passed.
// - helena_model_router_setting / helena_model_route: the model router's switches (per agent,
//   per project) and what it did for each run and chat answer (from → to, and why).
// - helena_mail_classification: what the classifier decided for a new mail and what Helena
//   did about it.
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  agentChatMessage,
  agentRun,
  aiAgent,
  integrationCredential,
  issue,
  project,
  team,
} from './app';
import { mailMessage, mailThread } from './mail';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const helenaDecisionClassSetting = pgTable(
  'helena_decision_class_setting',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    classId: text('class_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    fallbackCredentialId: integer('fallback_credential_id').references(
      () => integrationCredential.id,
      { onDelete: 'set null' },
    ),
    // Null: the class's default.
    threshold: doublePrecision('threshold'),
    timeoutMs: integer('timeout_ms'),
    storeInput: boolean('store_input').notNull().default(false),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('helena_decision_class_setting_team_class_idx').on(t.teamId, t.classId),
    check(
      'helena_decision_class_setting_threshold_check',
      sql`${t.threshold} IS NULL OR (${t.threshold} >= 0 AND ${t.threshold} <= 1)`,
    ),
    check(
      'helena_decision_class_setting_timeout_check',
      sql`${t.timeoutMs} IS NULL OR (${t.timeoutMs} >= 200 AND ${t.timeoutMs} <= 30000)`,
    ),
  ],
);

export const helenaDecision = pgTable(
  'helena_decision',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    classId: text('class_id').notNull(),
    // What the decision is about: `run:12`, `chat:34`, `mail:56`, `receipt:7`,
    // `workflow:<run>:<step>`, `claude-code:<session>`, `mcp`.
    subject: text('subject'),
    // The question's id within its class (`route`, `needs_context`, `project`, …).
    questionId: text('question_id').notNull(),
    kind: text('kind').notNull(),
    // The option ids offered (`yes`/`no` for a yes/no question).
    options: jsonb('options').$type<string[]>().notNull().default([]),
    // What was asked, so the log reads without the feature: the question and each option's
    // label (Helena's own wording or the caller's; the context stays out, see input_text).
    question: text('question'),
    optionLabels: jsonb('option_labels').$type<Record<string, string>>(),
    choice: text('choice'),
    probabilities: jsonb('probabilities').$type<Record<string, number>>(),
    confidence: doublePrecision('confidence'),
    threshold: doublePrecision('threshold').notNull(),
    status: text('status').notNull(),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    // The kind of backend (`typesafe`, `compatible`, `local-logit`, …) and the model as the
    // backend reported it.
    backend: text('backend'),
    model: text('model'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costEur: doublePrecision('cost_eur'),
    error: text('error'),
    inputHash: text('input_hash').notNull(),
    inputText: text('input_text'),
    outcome: text('outcome'),
    // 'owner' (a correction in Helena) or 'caller' (what the feature learned later).
    outcomeSource: text('outcome_source'),
    outcomeAt: timestamp('outcome_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check('helena_decision_kind_check', sql`${t.kind} IN ('choice', 'yesno')`),
    check(
      'helena_decision_status_check',
      sql`${t.status} IN ('decided', 'unsure', 'off', 'no_backend', 'timeout', 'error')`,
    ),
    check(
      'helena_decision_outcome_source_check',
      sql`${t.outcomeSource} IS NULL OR ${t.outcomeSource} IN ('owner', 'caller')`,
    ),
    index('helena_decision_team_class_idx').on(t.teamId, t.classId, t.createdAt.desc()),
    index('helena_decision_subject_idx').on(t.subject),
    index('helena_decision_run_idx').on(t.runId),
  ],
);

export interface DecisionEvalFailure {
  case: string;
  question: string;
  expected: string[];
  got: string | null;
  confidence: number | null;
}

export const helenaDecisionEval = pgTable(
  'helena_decision_eval',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    classId: text('class_id').notNull(),
    credentialId: integer('credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    backendLabel: text('backend_label').notNull().default(''),
    model: text('model'),
    threshold: doublePrecision('threshold').notNull(),
    // Questions asked, answered above the threshold, right overall, right above it.
    questions: integer('questions').notNull().default(0),
    answered: integer('answered').notNull().default(0),
    correct: integer('correct').notNull().default(0),
    correctAnswered: integer('correct_answered').notNull().default(0),
    precision: doublePrecision('precision'),
    coverage: doublePrecision('coverage'),
    accuracy: doublePrecision('accuracy'),
    passed: boolean('passed').notNull().default(false),
    latencyP50Ms: integer('latency_p50_ms'),
    latencyP95Ms: integer('latency_p95_ms'),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    costEur: doublePrecision('cost_eur'),
    failures: jsonb('failures').$type<DecisionEvalFailure[]>().notNull().default([]),
    // The report's details: precision and coverage at other thresholds, per question.
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    // Null while the eval runs.
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('helena_decision_eval_team_class_idx').on(t.teamId, t.classId, t.createdAt.desc())],
);

// The router's switches: per agent (off by default) and per project (on unless switched off).
// Exactly one of agent_id and project_id is set.
export const helenaModelRouterSetting = pgTable(
  'helena_model_router_setting',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(false),
    // A stronger model than the configured one is never chosen unless the owner allows it
    // here (per agent).
    allowUpgrade: boolean('allow_upgrade').notNull().default(false),
    updatedByUserId: text('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'helena_model_router_setting_scope_check',
      sql`(${t.agentId} IS NULL) <> (${t.projectId} IS NULL)`,
    ),
    uniqueIndex('helena_model_router_setting_agent_idx')
      .on(t.agentId)
      .where(sql`${t.agentId} IS NOT NULL`),
    uniqueIndex('helena_model_router_setting_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} IS NOT NULL`),
  ],
);

export const helenaModelRoute = pgTable(
  'helena_model_route',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'cascade' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'cascade',
    }),
    fromModel: text('from_model').notNull(),
    toModel: text('to_model').notNull(),
    routed: boolean('routed').notNull().default(false),
    // The tier chosen (the model id of the tier), its confidence, and P(the request depends
    // on the earlier conversation).
    tier: text('tier'),
    confidence: doublePrecision('confidence'),
    needsContext: doublePrecision('needs_context'),
    // Why: cheaper_tier | upgrade | same_tier | needs_context | unsure | no_candidates |
    // off | timeout | error | no_backend.
    reason: text('reason').notNull(),
    decisionId: bigint('decision_id', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('helena_model_route_run_idx')
      .on(t.runId)
      .where(sql`${t.runId} IS NOT NULL`),
    uniqueIndex('helena_model_route_chat_idx')
      .on(t.chatMessageId)
      .where(sql`${t.chatMessageId} IS NOT NULL`),
    index('helena_model_route_agent_idx').on(t.agentId, t.createdAt.desc()),
  ],
);

export interface MailClassificationAnswer {
  choice: string | null;
  confidence: number | null;
  decided: boolean;
}

export interface MailClassificationAction {
  // 'moved' | 'suggested' | 'category' | 'task' | 'approval' | 'agent' | 'receipt' | 'skipped'
  kind: string;
  projectId?: number | null;
  issueId?: number | null;
  approvalId?: number | null;
  agentId?: number | null;
  receiptIds?: number[];
  note?: string | null;
}

export const helenaMailClassification = pgTable(
  'helena_mail_classification',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    threadId: integer('thread_id')
      .notNull()
      .references(() => mailThread.id, { onDelete: 'cascade' }),
    messageId: integer('message_id')
      .notNull()
      .references(() => mailMessage.id, { onDelete: 'cascade' }),
    // classified | unsure (nothing decided above the threshold) | failed
    status: text('status').notNull(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'set null' }),
    category: text('category'),
    priority: text('priority'),
    needsReply: boolean('needs_reply'),
    createTask: boolean('create_task'),
    answers: jsonb('answers')
      .$type<Record<string, MailClassificationAnswer>>()
      .notNull()
      .default({}),
    actions: jsonb('actions').$type<MailClassificationAction[]>().notNull().default([]),
    issueId: integer('issue_id').references(() => issue.id, { onDelete: 'set null' }),
    error: text('error'),
    correctedByUserId: text('corrected_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'helena_mail_classification_status_check',
      sql`${t.status} IN ('classified', 'unsure', 'failed')`,
    ),
    uniqueIndex('helena_mail_classification_message_idx').on(t.messageId),
    index('helena_mail_classification_thread_idx').on(t.threadId),
    index('helena_mail_classification_team_idx').on(t.teamId, t.createdAt.desc()),
  ],
);
