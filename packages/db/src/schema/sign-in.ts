// The sign-ins Helena opens a session for without a password: the Cloudflare sign-in
// (Access assertion through the tunnel entry, `edge`) and the LAN owner sign-in
// (`local_owner`). Every one is written here, refused ones too, so the owner can see in
// Administrator → Sicherheit who came in how and from where. Design and threat model:
// docs/helena-decisions/security-hardening.md §4.8.
import { sql } from 'drizzle-orm';
import { check, index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const SIGN_IN_METHODS = ['edge', 'local_owner'] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

export const SIGN_IN_OUTCOMES = ['ok', 'refused'] as const;
export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

export const helenaSignInEvent = pgTable(
  'helena_sign_in_event',
  {
    id: serial('id').primaryKey(),
    // The account a session was opened for; null for a refusal that named no account.
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    method: text('method').$type<SignInMethod>().notNull(),
    outcome: text('outcome').$type<SignInOutcome>().notNull(),
    // Why it was refused (a stable code: disabled, entry, not_configured, invalid_assertion,
    // identity_not_allowed, no_account, not_eligible, deactivated); null when it went through.
    reason: text('reason'),
    // The identity the edge provider signed (Cloudflare Access: the e-mail address), and the
    // provider's id. Null for the LAN sign-in.
    identity: text('identity'),
    provider: text('provider'),
    // The client as nginx saw it (through the tunnel: Cloudflare's CF-Connecting-IP).
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('helena_sign_in_event_method_check', sql`${t.method} IN ('edge', 'local_owner')`),
    check('helena_sign_in_event_outcome_check', sql`${t.outcome} IN ('ok', 'refused')`),
    index('helena_sign_in_event_created_idx').on(t.createdAt.desc()),
    index('helena_sign_in_event_method_idx').on(t.method, t.createdAt.desc()),
  ],
);
