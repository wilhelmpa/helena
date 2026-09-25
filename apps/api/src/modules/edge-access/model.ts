import { t } from 'elysia';
import { oneOf } from '#shared/schemas';

const State = oneOf(['pass', 'fail', 'warn', 'skip']);
const Severity = oneOf(['critical', 'high', 'medium', 'low']);

export const AuditCheckDto = t.Object({
  id: t.String(),
  group: t.String(),
  state: State,
  severity: Severity,
  code: t.String(),
  params: t.Record(t.String(), t.Union([t.String(), t.Number()])),
  detail: t.String(),
});

export const EdgeAccessSettingsDto = t.Object({
  provider: t.String(),
  teamDomain: t.String(),
  audiences: t.Array(t.String()),
  allowedEmails: t.Array(t.String()),
  updatedAt: t.Union([t.String(), t.Null()]),
  configured: t.Boolean(),
});

export const EdgeAccessPatchBody = t.Object({
  provider: t.Optional(t.String({ maxLength: 64 })),
  teamDomain: t.Optional(t.String({ maxLength: 100 })),
  audiences: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 10 })),
  allowedEmails: t.Optional(t.Array(t.String({ maxLength: 254 }), { maxItems: 50 })),
});

export const SecurityStatusDto = t.Object({
  audit: t.Union([
    t.Object({
      ranAt: t.String(),
      host: t.String(),
      stale: t.Boolean(),
      summary: t.Object({ pass: t.Number(), fail: t.Number(), warn: t.Number(), skip: t.Number() }),
      checks: t.Array(AuditCheckDto),
    }),
    t.Null(),
  ]),
  health: t.Object({
    id: t.String(),
    state: oneOf(['ok', 'attention', 'critical', 'unknown']),
    code: t.String(),
    values: t.Record(t.String(), t.Number()),
  }),
  edge: t.Object({
    configured: t.Boolean(),
    provider: t.String(),
    teamDomain: t.String(),
    audiences: t.Array(t.String()),
    allowedEmails: t.Array(t.String()),
    updatedAt: t.Union([t.String(), t.Null()]),
  }),
  owner: t.Object({
    totp: t.Boolean(),
    passkey: t.Boolean(),
    stepUpRequired: t.Boolean(),
    activeSessions: t.Number(),
  }),
});
