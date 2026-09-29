import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { agentChatMessage, agentRun, aiAgent, approvalRequest } from './app';

export const volitionRootExecution = pgTable('volition_root_execution', {
  id: text('id').primaryKey(),
  agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
  runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
  messageId: integer('message_id').references(() => agentChatMessage.id, { onDelete: 'set null' }),
  approvalId: integer('approval_id').references(() => approvalRequest.id, { onDelete: 'set null' }),
  command: text('command').notNull(),
  reason: text('reason').notNull(),
  origin: text('origin').notNull(),
  runtime: text('runtime').notNull(),
  taintSources: jsonb('taint_sources').$type<string[]>().notNull(),
  persistence: jsonb('persistence').$type<string[]>().notNull(),
  epoch: integer('epoch').notNull(),
  status: text('status').notNull().default('pending'),
  unit: text('unit'),
  exitCode: integer('exit_code'),
  output: text('output'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});
