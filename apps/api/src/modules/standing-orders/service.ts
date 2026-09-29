import { db, standingOrder } from '@repo/db';
import { and, asc, eq, or } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';

export type OrderScope =
  { projectId: number; agentId?: never } | { agentId: number; projectId?: never };

type Row = typeof standingOrder.$inferSelect;
function dto(row: Row) {
  return {
    ...row,
    status: row.status as 'proposed' | 'confirmed' | 'rejected',
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
function condition(scope: OrderScope) {
  return scope.projectId !== undefined
    ? eq(standingOrder.projectId, scope.projectId)
    : eq(standingOrder.agentId, scope.agentId);
}

export async function listOrders(scope: OrderScope) {
  return (
    await db.select().from(standingOrder).where(condition(scope)).orderBy(asc(standingOrder.id))
  ).map(dto);
}

export async function createOrder(
  scope: OrderScope,
  authorUserId: string,
  input: { body: string; source: string },
  proposed: boolean,
) {
  if (!input.body.trim() || !input.source.trim())
    throw new HttpError(400, 'Body and source are required');
  const [row] = await db
    .insert(standingOrder)
    .values({
      ...scope,
      body: input.body.trim(),
      source: input.source.trim(),
      authorUserId,
      status: proposed ? 'proposed' : 'confirmed',
      active: !proposed,
      decidedByUserId: proposed ? null : authorUserId,
    })
    .returning();
  return dto(row!);
}

export async function updateOrder(
  scope: OrderScope,
  id: number,
  input: { body?: string; source?: string; active?: boolean },
) {
  if (input.body !== undefined && !input.body.trim()) throw new HttpError(400, 'Body is required');
  if (input.source !== undefined && !input.source.trim())
    throw new HttpError(400, 'Source is required');
  const [row] = await db
    .update(standingOrder)
    .set({
      ...(input.body !== undefined && { body: input.body.trim() }),
      ...(input.source !== undefined && { source: input.source.trim() }),
      ...(input.active !== undefined && { active: input.active }),
      updatedAt: new Date(),
    })
    .where(and(eq(standingOrder.id, id), condition(scope), eq(standingOrder.status, 'confirmed')))
    .returning();
  if (!row) throw new HttpError(404, 'Standing order not found');
  return dto(row);
}

// Removes an order for good (a confirmed one no longer wanted, a rejected proposal).
export async function deleteOrder(scope: OrderScope, id: number) {
  const [row] = await db
    .delete(standingOrder)
    .where(and(eq(standingOrder.id, id), condition(scope)))
    .returning();
  if (!row) throw new HttpError(404, 'Standing order not found');
  return dto(row);
}

export async function decideOrder(
  scope: OrderScope,
  id: number,
  ownerUserId: string,
  approved: boolean,
) {
  const [row] = await db
    .update(standingOrder)
    .set({
      status: approved ? 'confirmed' : 'rejected',
      active: approved,
      decidedByUserId: ownerUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(standingOrder.id, id), condition(scope), eq(standingOrder.status, 'proposed')))
    .returning();
  if (!row) throw new HttpError(409, 'Standing order is no longer pending');
  return dto(row);
}

export async function activeOrderContext(
  projectId: number | null,
  agentId: number,
): Promise<string> {
  const rows = await db
    .select({ body: standingOrder.body, source: standingOrder.source })
    .from(standingOrder)
    .where(
      and(
        eq(standingOrder.status, 'confirmed'),
        eq(standingOrder.active, true),
        projectId === null
          ? eq(standingOrder.agentId, agentId)
          : or(eq(standingOrder.projectId, projectId), eq(standingOrder.agentId, agentId)),
      ),
    )
    .orderBy(asc(standingOrder.id));
  return rows.length
    ? `## Standing orders\n${rows.map((row) => `- ${row.body} (source: ${row.source})`).join('\n')}\n\n`
    : '';
}
