import { t } from 'elysia';

export const orderBody = t.Object({
  body: t.String({ minLength: 1, maxLength: 500 }),
  source: t.String({ minLength: 1, maxLength: 200 }),
});
export const orderPatch = t.Object({
  body: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  source: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  active: t.Optional(t.Boolean()),
});
export const orderDecision = t.Object({ approved: t.Boolean() });
export const orderParams = t.Object({ projectKey: t.String(), orderId: t.Numeric() });
export const helenaOrderParams = t.Object({ orderId: t.Numeric() });
export const OrderResponse = t.Object({
  id: t.Number(),
  projectId: t.Nullable(t.Number()),
  agentId: t.Nullable(t.Number()),
  body: t.String(),
  source: t.String(),
  authorUserId: t.String(),
  status: t.Union([t.Literal('proposed'), t.Literal('confirmed'), t.Literal('rejected')]),
  active: t.Boolean(),
  decidedByUserId: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});
export const OrderListResponse = t.Array(OrderResponse);
