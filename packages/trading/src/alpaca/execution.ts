import { createHash } from 'node:crypto';
import type { ToolCallContext } from '@helena/sdk';
import { AlpacaError, type AlpacaOrder, type AlpacaPaperClient } from './client';
import type { CheckResult, OrderRequest } from './checks';

export interface PaperPrecheck {
  requestId: string;
  order: OrderRequest;
  check: CheckResult;
  marketOpen: boolean;
  duplicate: boolean;
  rationale: string;
  newsContext?: string;
  strategyId?: string;
  strategyVersion?: string;
}

export interface PaperIntent {
  accountId: string;
  clientOrderId: string;
  requestHash: string;
  order: AlpacaOrder | null;
}

export interface PaperExecution {
  precheck(
    ctx: ToolCallContext,
    input: PaperPrecheck,
  ): Promise<{ allowed: boolean; reason: string }>;
  withAccountLock<T>(ctx: ToolCallContext, accountId: string, work: () => Promise<T>): Promise<T>;
  findIntent(accountId: string, clientOrderId: string): Promise<PaperIntent | null>;
  activeIntents(accountId: string): Promise<PaperIntent[]>;
  beginIntent(ctx: ToolCallContext, intent: PaperIntent): Promise<void>;
  finishIntent(intent: PaperIntent, order: AlpacaOrder): Promise<void>;
  authorizeStrategy(
    ctx: ToolCallContext,
    accountId: string,
    strategy: { strategyId: string; strategyVersion: string; symbol: string },
  ): Promise<void>;
}

export function paperIntent(
  accountId: string,
  projectId: number,
  requestId: string,
  input: object,
): PaperIntent {
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  return {
    accountId,
    clientOrderId: `helena-${hash(`${accountId}:${projectId}:${requestId}`).slice(0, 40)}`,
    requestHash: hash(
      JSON.stringify(
        Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))),
      ),
    ),
    order: null,
  };
}

async function reconcile(
  client: AlpacaPaperClient,
  execution: PaperExecution,
  intent: PaperIntent,
) {
  let order: AlpacaOrder;
  try {
    order = await client.orderByClientId(intent.clientOrderId);
  } catch (error) {
    if (error instanceof AlpacaError && error.status === 404)
      throw new Error(
        'A previous paper order has an unresolved outcome. No order was resubmitted; reconcile the original request first.',
      );
    throw error;
  }
  if (order.client_order_id !== intent.clientOrderId || !order.id || !order.status)
    throw new Error('The broker returned no matching paper order for reconciliation.');
  await execution.finishIntent(intent, order);
  return order;
}

export async function existingPaperOrder(
  client: AlpacaPaperClient,
  execution: PaperExecution,
  intent: PaperIntent,
): Promise<AlpacaOrder | null> {
  const existing = await execution.findIntent(intent.accountId, intent.clientOrderId);
  if (!existing) return null;
  if (existing.requestHash !== intent.requestHash)
    throw new Error('This paper requestId already belongs to different order arguments.');
  return reconcile(client, execution, existing);
}

export async function reconciledOpenOrders(
  client: AlpacaPaperClient,
  execution: PaperExecution,
  accountId: string,
): Promise<AlpacaOrder[]> {
  const intents = await execution.activeIntents(accountId);
  if (intents.length >= 500)
    throw new Error('Too many unresolved paper intents; reconcile before submitting.');
  // Reconcile durable intents first; a lost POST response must never release its reservation.
  const reconciled = [];
  for (const intent of intents) reconciled.push(await reconcile(client, execution, intent));
  const orders = await client.orders({ status: 'open', limit: 500 });
  if (orders.length >= 500)
    throw new Error('The pending paper order list is incomplete; no order can be checked.');
  const present = new Set(orders.map((order) => order.client_order_id));
  // Recent terminal orders also count against today's limit if the history API lags.
  for (const order of reconciled) {
    if (!present.has(order.client_order_id)) orders.push(order);
  }
  return orders;
}
