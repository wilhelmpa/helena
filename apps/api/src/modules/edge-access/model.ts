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
  signIn: t.Boolean(),
  homeAutoConnect: t.Boolean(),
  // Service tokens acting for an allowed identity; the client id only as its first characters.
  serviceTokens: t.Array(t.Object({ hint: t.String(), actsAs: t.String(), label: t.String() })),
  // The home network's own origin (HELENA_HOME_URL), when this instance has one.
  homeUrl: t.Union([t.String(), t.Null()]),
  // Whether the tunnel entry's proof is known to the api (cloudflare/install.sh
  // entry-token): without it the Cloudflare sign-in cannot work, whatever the switch says.
  entryProof: t.Boolean(),
  updatedAt: t.Union([t.String(), t.Null()]),
  configured: t.Boolean(),
});

export const EdgeAccessPatchBody = t.Object({
  provider: t.Optional(t.String({ maxLength: 64 })),
  teamDomain: t.Optional(t.String({ maxLength: 100 })),
  audiences: t.Optional(t.Array(t.String({ maxLength: 100 }), { maxItems: 10 })),
  allowedEmails: t.Optional(t.Array(t.String({ maxLength: 254 }), { maxItems: 50 })),
  signIn: t.Optional(t.Boolean()),
  homeAutoConnect: t.Optional(t.Boolean()),
  serviceTokens: t.Optional(
    t.Array(
      t.Object({
        clientId: t.String({ maxLength: 64 }),
        actsAs: t.String({ maxLength: 254 }),
        label: t.Optional(t.String({ maxLength: 64 })),
      }),
      { maxItems: 5 },
    ),
  ),
  removeServiceTokens: t.Optional(t.Array(t.String({ maxLength: 16 }), { maxItems: 5 })),
});

export const SignInEventDto = t.Object({
  id: t.Number(),
  method: oneOf(['edge', 'local_owner']),
  outcome: oneOf(['ok', 'refused']),
  reason: t.Union([t.String(), t.Null()]),
  identity: t.Union([t.String(), t.Null()]),
  provider: t.Union([t.String(), t.Null()]),
  ipAddress: t.Union([t.String(), t.Null()]),
  userAgent: t.Union([t.String(), t.Null()]),
  userName: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
});

export const SignInEventsQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
  method: t.Optional(oneOf(['edge', 'local_owner'])),
});

export const EdgeHomeDto = t.Object({
  homeUrl: t.Union([t.String(), t.Null()]),
  autoConnect: t.Boolean(),
});

export const EdgeHomeProbeDto = t.Object({
  home: t.Boolean(),
  host: t.String(),
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
    signIn: t.Boolean(),
    homeAutoConnect: t.Boolean(),
    homeUrl: t.Union([t.String(), t.Null()]),
    updatedAt: t.Union([t.String(), t.Null()]),
  }),
  owner: t.Object({
    totp: t.Boolean(),
    passkey: t.Boolean(),
    stepUpRequired: t.Boolean(),
    activeSessions: t.Number(),
  }),
});
