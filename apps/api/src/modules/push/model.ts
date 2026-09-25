import { t } from 'elysia';

const LocalizedTextSchema = t.Union([t.String(), t.Record(t.String(), t.String())]);

export const PushCategoryView = t.Object({
  id: t.String(),
  label: LocalizedTextSchema,
  description: t.Nullable(LocalizedTextSchema),
  defaultOn: t.Boolean(),
  audience: t.String(),
});

export const PushDeviceView = t.Object({
  id: t.Integer(),
  label: t.String(),
  userAgent: t.String(),
  locale: t.String(),
  service: t.String(),
  endpoint: t.String(),
  currentKey: t.Boolean(),
  categories: t.Record(t.String(), t.Boolean()),
  createdAt: t.String(),
  lastSuccessAt: t.Nullable(t.String()),
  lastFailureAt: t.Nullable(t.String()),
  failureCount: t.Integer(),
  lastError: t.Nullable(t.String()),
});

export const PushOverviewResponse = t.Object({
  // Null where this instance holds no key (no APP_ENCRYPTION_KEY): push is not offered.
  publicKey: t.Nullable(t.String()),
  categories: t.Array(PushCategoryView),
  devices: t.Array(PushDeviceView),
});

const Categories = t.Record(t.String({ maxLength: 80 }), t.Boolean(), { maxProperties: 50 });

export const SubscribeBody = t.Object({
  subscription: t.Object({
    endpoint: t.String({ minLength: 12, maxLength: 2048 }),
    expirationTime: t.Optional(t.Nullable(t.Number())),
    keys: t.Object({
      p256dh: t.String({ minLength: 80, maxLength: 120 }),
      auth: t.String({ minLength: 16, maxLength: 40 }),
    }),
  }),
  // The applicationServerKey the browser subscribed with.
  vapidKey: t.String({ minLength: 80, maxLength: 120 }),
  label: t.Optional(t.String({ maxLength: 80 })),
  locale: t.Optional(t.String({ maxLength: 16 })),
  categories: t.Optional(Categories),
  replaces: t.Optional(t.String({ maxLength: 2048 })),
});

export const DevicePatch = t.Object({
  label: t.Optional(t.String({ maxLength: 80 })),
  locale: t.Optional(t.String({ maxLength: 16 })),
  categories: t.Optional(Categories),
});

export const DeviceParams = t.Object({ id: t.Numeric({ minimum: 1 }) });

export const TestResponse = t.Object({
  ok: t.Boolean(),
  status: t.Nullable(t.Integer()),
  gone: t.Boolean(),
  error: t.Nullable(t.String()),
});

export const PresenceBody = t.Object({ visible: t.Boolean() });
