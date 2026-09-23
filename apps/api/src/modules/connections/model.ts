import { t } from 'elysia';

export const ConnectionStatus = t.Union([
  t.Literal('connected'),
  t.Literal('available'),
  t.Literal('configured'),
  t.Literal('disabled'),
  t.Literal('unavailable'),
  t.Literal('unsupported'),
  t.Literal('error'),
]);

export const ConnectionItem = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('mcp'), t.Literal('channel'), t.Literal('service'), t.Literal('mail')]),
  provider: t.String(),
  label: t.String(),
  accountId: t.Optional(t.String()),
  status: ConnectionStatus,
  configured: t.Boolean(),
  connected: t.Boolean(),
  running: t.Boolean(),
  lastCheckedAt: t.Nullable(t.String()),
  lastSuccessAt: t.Nullable(t.String()),
  lastError: t.Nullable(t.String()),
  canProbe: t.Boolean(),
  canReconnect: t.Boolean(),
  canPair: t.Boolean(),
  toolCount: t.Optional(t.Number()),
  manageUrl: t.Optional(t.Nullable(t.String())),
});

export const ConnectionsResponse = t.Object({
  checkedAt: t.String(),
  items: t.Array(ConnectionItem),
});
export const ConnectionActionBody = t.Object({
  id: t.String({ minLength: 1, maxLength: 300 }),
  action: t.Union([t.Literal('probe'), t.Literal('reconnect')]),
});

export const ThemeSyncBody = t.Object({
  theme: t.Union([t.Literal('light'), t.Literal('dark')]),
});
export const ThemeSyncResponse = t.Object({
  theme: t.Union([t.Literal('light'), t.Literal('dark')]),
  results: t.Array(
    t.Object({
      service: t.Union([t.Literal('agent_runtime'), t.Literal('code'), t.Literal('nextcloud')]),
      status: t.Union([t.Literal('updated'), t.Literal('failed')]),
      attempts: t.Integer({ minimum: 1, maximum: 2 }),
      error: t.Optional(t.String({ maxLength: 200 })),
    }),
  ),
});

export const VaultStatusResponse = t.Object({
  checkedAt: t.String(),
  accessUrl: t.Nullable(t.String()),
  accessStatus: t.Union([
    t.Literal('protected'),
    t.Literal('reachable'),
    t.Literal('unavailable'),
    t.Literal('unconfigured'),
  ]),
  httpStatus: t.Nullable(t.Integer()),
  serviceHealthExposed: t.Literal(false),
  secretValuesExposed: t.Literal(false),
});

export const SecretInventoryResponse = t.Object({
  checkedAt: t.String(),
  entries: t.Array(
    t.Object({
      name: t.String(),
      updatedAt: t.Nullable(t.String()),
      allowedHosts: t.Array(t.String()),
    }),
  ),
});
export const SecretSetBody = t.Object({
  name: t.String({ pattern: '^[A-Z][A-Z0-9_]{2,127}$' }),
  value: t.String({ minLength: 1, maxLength: 16384 }),
  allowedHosts: t.Array(t.String({ minLength: 1, maxLength: 253 }), { maxItems: 20 }),
});
