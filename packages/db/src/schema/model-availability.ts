// What Helena learned about the models the agents' providers serve this installation
// (docs/helena-decisions/model-availability.md): a model a provider refused this account
// ('unavailable') or served ('works'), per runtime and provider. A refusal takes the model
// out of the pickers and fails a workflow stage on it at once, until a use of it succeeds or
// the owner lets it be tried again; a success confirms a model the account's own list does
// not name. The provider's words are kept short; no credential or answer ever lands here.
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { agentChatMessage, agentRun, aiAgent } from './app';

export const helenaModelAvailability = pgTable(
  'helena_model_availability',
  {
    id: serial('id').primaryKey(),
    // The runtime that reached the model ('hermes', 'claude', 'codex', a plugin's), and the
    // provider it reached it through ('openai-codex', 'anthropic'; '' where it names none).
    // Claude Code and Codex sign in with logins of their own, so their findings stay theirs.
    runtime: text('runtime').notNull(),
    provider: text('provider').notNull().default(''),
    model: text('model').notNull(),
    state: text('state').notNull(),
    // For a refusal: the failure code (@helena/sdk RuntimeFailureCode) and the provider's
    // own words, short.
    reason: text('reason'),
    detail: text('detail'),
    // Where it was learned: the agent, and its run or chat answer.
    agentId: integer('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    runId: integer('run_id').references(() => agentRun.id, { onDelete: 'set null' }),
    chatMessageId: integer('chat_message_id').references(() => agentChatMessage.id, {
      onDelete: 'set null',
    }),
    // When the state began, and when it was last seen again.
    since: timestamp('since', { withTimezone: true }).notNull().defaultNow(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_model_availability_route_idx').on(t.runtime, t.provider, t.model),
    check('helena_model_availability_state_check', sql`${t.state} IN ('unavailable', 'works')`),
  ],
);
