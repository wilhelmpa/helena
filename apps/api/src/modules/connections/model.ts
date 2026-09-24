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
  // Whether this server has a connections service at all; without one the list is
  // empty because nothing can be checked, not because nothing is connected.
  configured: t.Boolean(),
  items: t.Array(ConnectionItem),
});
export const ConnectionActionBody = t.Object({
  id: t.String({ minLength: 1, maxLength: 300 }),
  action: t.Union([t.Literal('probe'), t.Literal('reconnect')]),
});
