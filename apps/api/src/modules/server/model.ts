import { t } from 'elysia';

// The routes of Administrator → Server. The detailed readings (disks, backup, power) are the
// host helper's own shapes, passed on unchanged and described in ./types.ts; the overview and
// the health lines are Helena's.

const hostState = t.Union(
  [t.Literal('ok'), t.Literal('attention'), t.Literal('critical'), t.Literal('unknown')],
  { description: '`critical`: act now (red). `attention`: running or worth a look (amber).' },
);

const localizedText = t.Union([
  t.String(),
  t.Object({ i18n: t.String() }),
  t.Record(t.String(), t.String()),
]);

export const HostHealthItemSchema = t.Object({
  id: t.String(),
  state: hostState,
  code: t.Optional(
    t.String({ description: 'A message of the web translations: server.health.<code>' }),
  ),
  values: t.Optional(t.Record(t.String(), t.Union([t.String(), t.Number()]))),
  text: t.Optional(localizedText),
  since: t.Optional(t.Nullable(t.String())),
});

export const ServerOverviewResponse = t.Object({
  helper: t.Object({
    available: t.Boolean(),
    version: t.Nullable(t.String()),
    reason: t.Nullable(t.String({ description: '`Unavailable`: no helper on this host' })),
  }),
  areas: t.Array(t.Object({ area: t.String(), available: t.Boolean() })),
  capabilities: t.Array(
    t.Object({
      id: t.String(),
      pluginId: t.String(),
      area: t.String(),
      order: t.Number(),
      label: localizedText,
      available: t.Boolean(),
      reason: t.Nullable(t.String()),
      detail: t.Nullable(t.String()),
      health: t.Array(HostHealthItemSchema),
    }),
  ),
  state: hostState,
  checkedAt: t.String({ format: 'date-time' }),
});

// The helper's readings (types.ts: StorageStatus, PowerStatus, BackupStatus, …).
export const HostReading = t.Unknown({ description: "The host helper's reading (see types.ts)" });

export const freshQuery = t.Object({
  fresh: t.Optional(t.BooleanString({ description: 'Read again instead of the cached value' })),
});

export const arrayParams = t.Object({ array: t.String({ pattern: '^[A-Za-z0-9._-]{1,64}$' }) });
export const diskParams = t.Object({ disk: t.String({ pattern: '^[a-z0-9]{2,32}$' }) });

export const profileBody = t.Object({
  profile: t.Union([t.Literal('saver'), t.Literal('balanced'), t.Literal('performance')]),
});

export const powerPolicyBody = t.Object({
  mode: t.Union([t.Literal('auto'), t.Literal('balanced'), t.Literal('performance')]),
  tctlLimit: t.Optional(t.Integer({ minimum: 60, maximum: 100 })),
});

export const fansBody = t.Union([
  t.Object({ mode: t.Literal('auto') }),
  t.Object({ mode: t.Literal('fixed'), level: t.Integer({ minimum: 1, maximum: 5 }) }),
]);

export const guardBody = t.Object({ limit: t.Integer({ minimum: 70, maximum: 95 }) });

export const backupRunBody = t.Object({
  kind: t.Union([t.Literal('backup'), t.Literal('maintenance'), t.Literal('restore-test')]),
});

export const backupSettingsBody = t.Object({
  schedule: t.Optional(
    t.Object({
      frequency: t.Union([
        t.Literal('off'),
        t.Literal('hourly'),
        t.Literal('every6h'),
        t.Literal('daily'),
      ]),
      time: t.String({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
    }),
  ),
  retention: t.Optional(
    t.Object({
      hourly: t.Integer({ minimum: 0, maximum: 168 }),
      daily: t.Integer({ minimum: 0, maximum: 90 }),
      weekly: t.Integer({ minimum: 0, maximum: 104 }),
      monthly: t.Integer({ minimum: 0, maximum: 120 }),
    }),
  ),
  checkWeekly: t.Optional(t.Boolean()),
  restoreTestMonthly: t.Optional(t.Boolean()),
});

export const snapshotParams = t.Object({
  snapshot: t.String({ pattern: '^(latest|[0-9a-f]{8,64})$' }),
});
export const listQuery = t.Object({ path: t.String({ minLength: 1, maxLength: 4096 }) });

export const restoreBody = t.Object({
  snapshot: t.String({ pattern: '^(latest|[0-9a-f]{8,64})$' }),
  path: t.String({ minLength: 1, maxLength: 4096 }),
  mode: t.Optional(t.Union([t.Literal('copy'), t.Literal('original')])),
  confirm: t.Optional(
    t.String({ maxLength: 4096, description: 'In place: the path again, typed by the owner' }),
  ),
});
export const restoreParams = t.Object({ id: t.String({ pattern: '^[0-9]{14}-[0-9a-f]{6}$' }) });

export const targetParams = t.Object({ id: t.String({ pattern: '^[a-z][a-z0-9-]{0,31}$' }) });
export const targetBody = t.Object({
  repository: t.String({
    maxLength: 512,
    description: 'An S3 repository: s3:https://<endpoint>/<bucket>[/<prefix>]',
  }),
  enabled: t.Optional(t.Boolean()),
  credentials: t.Optional(
    t.Object({
      accessKeyId: t.String({ minLength: 4, maxLength: 128 }),
      secretAccessKey: t.String({ minLength: 8, maxLength: 256 }),
    }),
  ),
});

export const seenBody = t.Object({ upTo: t.Integer({ minimum: 0 }) });

export const PasswordResponse = t.Object({
  password: t.String({ description: 'Shown once, until the owner confirms he wrote it down' }),
});
