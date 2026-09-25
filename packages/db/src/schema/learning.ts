import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agentChatThread, aiAgent } from './app';

// A reflection on a chat (docs/helena-decisions/agent-context.md §5): a short follow-up turn
// in the chat's session, in which the agent keeps what the conversation taught it about the
// person and their work (memory, skills), the way a run's reflection does for a run. It is
// queued when a chat has gone quiet for a while, or after several turns, and drained by the
// agent's runner like its chat answers; the thread's answers and its reflection never run at
// the same time, since both continue the same session. One waits per thread at most.
export const helenaChatReflection = pgTable(
  'helena_chat_reflection',
  {
    id: serial('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => agentChatThread.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    // Why it was queued: 'idle' (the chat went quiet) or 'turns' (many turns since the last).
    reason: text('reason').notNull(),
    // The last answer of the conversation it looks back on; the next reflection of the
    // thread starts after it.
    uptoMessageId: integer('upto_message_id').notNull(),
    // The owner's turns it covers.
    turns: integer('turns').notNull().default(0),
    // pending -> success | failed | canceled. A claim keeps it 'pending' and pushes
    // next_attempt_at forward by a lease, like a chat answer.
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    claims: integer('claims').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    // The session it continued and the model it ran on, as the claim handed them out.
    sessionId: text('session_id'),
    model: text('model'),
    // What the agent saved (memory and skill writes that took), its answer and its cost.
    saved: jsonb('saved'),
    summary: text('summary'),
    lastError: text('last_error'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'helena_chat_reflection_status_check',
      sql`${t.status} IN ('pending', 'success', 'failed', 'canceled')`,
    ),
    check('helena_chat_reflection_reason_check', sql`${t.reason} IN ('idle', 'turns')`),
    index('helena_chat_reflection_due_idx')
      .on(t.agentId, t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('helena_chat_reflection_thread_idx').on(t.threadId, t.id),
    uniqueIndex('helena_chat_reflection_waiting_uq')
      .on(t.threadId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
