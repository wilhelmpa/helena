// How much of each subscription's limits is used (docs/helena-decisions/provider-limits.md):
// the newest snapshot per provider account, and which agents work on that account. The
// numbers come from the usage-limit sources (@helena/sdk usage-limits.ts): a runner probing
// through a runtime's own login, a run's output, or the owner reporter's spool file. Tokens,
// e-mails and the providers' raw answers never reach these tables.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { UsageLimitExtra, UsageLimitWindow } from '@helena/sdk';
import { aiAgent } from './app';

export const helenaProviderLimit = pgTable(
  'helena_provider_limit',
  {
    id: serial('id').primaryKey(),
    // `openai-codex` (the ChatGPT plan), `anthropic` (the Claude plan), or a plugin's.
    provider: text('provider').notNull(),
    // A hash of the provider's account id, or of where the login is stored; never the id.
    account: text('account').notNull(),
    // The usage-limit source that measured the newest numbers, and the login it read.
    source: text('source').notNull(),
    login: text('login'),
    plan: text('plan'),
    windows: jsonb('windows').$type<UsageLimitWindow[]>().notNull().default([]),
    extra: jsonb('extra').$type<UsageLimitExtra | null>(),
    resetCredits: integer('reset_credits'),
    // The provider's verdict on ordinary use; null where it gives none.
    allowed: boolean('allowed'),
    via: text('via').notNull().default('probe'),
    unavailable: text('unavailable'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('helena_provider_limit_account_idx').on(t.provider, t.account),
    check('helena_provider_limit_via_check', sql`${t.via} IN ('probe', 'passive')`),
  ],
);

// The agents whose runtime reported the account: the account they work on, for the list of
// agents per account and their tokens in a window (agent_usage).
export const helenaProviderLimitAgent = pgTable(
  'helena_provider_limit_agent',
  {
    limitId: integer('limit_id')
      .notNull()
      .references(() => helenaProviderLimit.id, { onDelete: 'cascade' }),
    agentId: integer('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.limitId, t.agentId] }),
    index('helena_provider_limit_agent_agent_idx').on(t.agentId),
  ],
);
