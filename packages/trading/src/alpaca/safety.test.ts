import { describe, expect, test } from 'bun:test';
import type { ToolCallContext } from '@helena/sdk';
import { type AlpacaOrder, type Fetch } from './client';
import { paperIntent, type PaperExecution, type PaperIntent } from './execution';
import { pendingExposures } from './pending';
import { alpacaPaperTools } from './tools';

const ACCOUNT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = '2026-10-01T15:00:00Z';
const request = {
  requestId: '01234567-89ab-4cde-8fab-0123456789ab',
  symbol: 'SPY',
  side: 'buy',
  type: 'market',
  qty: 1,
  stopLossPrice: 580,
  strategyId: 'orb-spy',
  strategyVersion: '1.0',
  rationale: 'A tested entry under the approved strategy.',
};
const brokerOrder = (patch: Partial<AlpacaOrder> = {}): AlpacaOrder => ({
  id: crypto.randomUUID(),
  client_order_id: 'external',
  symbol: 'SPY',
  side: 'buy',
  type: 'limit',
  time_in_force: 'day',
  qty: '1',
  notional: null,
  filled_qty: '0',
  filled_avg_price: null,
  limit_price: '600',
  stop_price: null,
  status: 'new',
  submitted_at: NOW,
  filled_at: null,
  canceled_at: null,
  ...patch,
});

function fixture() {
  const intents = new Map<string, PaperIntent>();
  const broker = new Map<string, AlpacaOrder>();
  const open: AlpacaOrder[] = [];
  const writes: string[] = [];
  let locked = false;
  let loseResponse = false;
  let concealOrder = false;
  let stale = false;
  let authorized = true;
  let held = 0;
  const execution: PaperExecution = {
    async withAccountLock(_ctx, _account, work) {
      if (locked) throw new Error('account busy');
      locked = true;
      try {
        return await work();
      } finally {
        locked = false;
      }
    },
    async findIntent(_account, id) {
      return intents.get(id) ?? null;
    },
    async activeIntents() {
      return [...intents.values()];
    },
    async beginIntent(_ctx, intent) {
      intents.set(intent.clientOrderId, { ...intent });
    },
    async finishIntent(intent, order) {
      intents.set(intent.clientOrderId, { ...intent, order });
    },
    async authorizeStrategy() {
      if (!authorized) throw new Error('no human approval');
    },
  };
  const fetchImpl: Fetch = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (method !== 'GET') writes.push(method);
    if (u.pathname === '/v2/account')
      return json({
        id: ACCOUNT,
        status: 'ACTIVE',
        equity: '100000',
        last_equity: '100000',
        trading_blocked: false,
        account_blocked: false,
      });
    if (u.pathname === '/v2/positions')
      return json(
        held
          ? [{ symbol: 'SPY', qty: String(held), market_value: String(held * 600), side: 'long' }]
          : [],
      );
    if (u.pathname === '/v2/orders' && method === 'GET') return json(open);
    if (u.pathname === '/v2/orders:by_client_order_id') {
      const found = broker.get(u.searchParams.get('client_order_id')!);
      return found && !concealOrder ? json(found) : json({ message: 'not found' }, 404);
    }
    if (u.pathname.startsWith('/v2/orders/') && method === 'GET')
      return json(open.find((o) => u.pathname.endsWith(o.id)));
    if (u.pathname === '/v2/stocks/trades/latest')
      return json({
        trades: Object.fromEntries(
          (u.searchParams.get('symbols') ?? 'SPY')
            .split(',')
            .map((symbol) => [symbol, { p: 600, t: stale ? '2026-09-30T15:00:00Z' : NOW }]),
        ),
      });
    if (u.pathname === '/v2/orders' && method === 'POST') {
      expect(intents.size).toBeGreaterThan(0); // Durable write precedes any broker mutation.
      const body = JSON.parse(String(init?.body));
      const order = brokerOrder({
        ...body,
        status: 'accepted',
        limit_price: body.limit_price ?? null,
      });
      broker.set(order.client_order_id, order);
      if (loseResponse) throw new Error('response lost after broker accepted');
      return json(order);
    }
    throw new Error(`Unexpected fixture request ${method} ${u.pathname}`);
  };
  const ctx = (credentialId = 1): ToolCallContext => ({
    agent: null,
    project: { id: 1, key: 'TRADE', teamId: 1 },
    credentialId,
    credential: {
      keyId: 'PKTEST1234567890',
      secretKey: 'test',
      maxOrderValueUsd: 1000,
      maxPositionValueUsd: 1000,
      maxRiskPerTradeUsd: 50,
      dailyLossLimitUsd: 150,
    },
    log: { debug() {}, info() {}, warn() {}, error() {} } as ToolCallContext['log'],
  });
  const tools = alpacaPaperTools({ fetch: fetchImpl, now: () => new Date(NOW), execution });
  const call = (name: string, input: object, credentialId = 1) =>
    tools.find((tool) => tool.name === name)!.handler(input, ctx(credentialId));
  return {
    call,
    ctx,
    open,
    writes,
    intents,
    broker,
    execution,
    fetchImpl,
    loseResponse: () => {
      loseResponse = true;
    },
    concealOrder: () => {
      concealOrder = true;
    },
    stale: () => {
      stale = true;
    },
    unapprove: () => {
      authorized = false;
    },
    held: (qty: number) => {
      held = qty;
    },
  };
}
const submit = 'alpaca_paper_submit_order';

describe('pending inventory reservations', () => {
  test('held buys and partial fills retain value; OCO exits reserve inventory once', () => {
    const stop = brokerOrder({
      side: 'sell',
      type: 'stop',
      qty: '5',
      filled_qty: '1',
      status: 'held',
    });
    const target = brokerOrder({ side: 'sell', qty: '5', filled_qty: '1' });
    const root = brokerOrder({ qty: '5', filled_qty: '1', status: 'held', legs: [stop, target] });
    expect(pendingExposures([root], {})).toEqual([{ symbol: 'SPY', buyUsd: 2400, sellQty: 4 }]);
    expect(pendingExposures([stop, brokerOrder({ side: 'sell', qty: '2' })], {})[0]!.sellQty).toBe(
      6,
    );
  });
  test('unpriceable and incomplete pending orders fail closed', () => {
    expect(() => pendingExposures([brokerOrder({ qty: null, limit_price: null })], {})).toThrow(
      'valued',
    );
    expect(() => pendingExposures([brokerOrder({ filled_qty: 'NaN' })], {})).toThrow('filled');
    expect(() => pendingExposures([brokerOrder({ id: '' })], {})).toThrow('incomplete');
  });
});

describe('paper execution safety', () => {
  test('pending buys use position budget and pending sells cannot be oversold', async () => {
    const f = fixture();
    f.open.push(brokerOrder());
    expect(await f.call(submit, request)).toMatchObject({ isError: true });
    f.open.length = 0;
    f.held(2);
    f.open.push(brokerOrder({ side: 'sell', qty: '2', type: 'stop' }));
    expect(
      await f.call('alpaca_paper_close_position', {
        requestId: request.requestId,
        symbol: 'SPY',
        rationale: 'Reduce current exposure.',
      }),
    ).toMatchObject({ isError: true });
    expect(f.writes).toEqual([]);
  });
  test('pending buys consume position slots even before a first fill', async () => {
    const f = fixture();
    f.open.push(brokerOrder({ symbol: 'QQQ' }));
    const ctx = f.ctx();
    ctx.credential!.maxOpenPositions = 1;
    const tool = alpacaPaperTools({
      fetch: f.fetchImpl,
      now: () => new Date(NOW),
      execution: f.execution,
    }).find((t) => t.name === submit)!;
    expect(await tool.handler(request, ctx)).toMatchObject({ isError: true });
    expect(f.writes).toEqual([]);
  });
  test('two credential aliases share a single account lock', async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      f.call(submit, request, 1),
      f.call(submit, { ...request, requestId: crypto.randomUUID() }, 2),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(f.writes).toEqual(['POST']);
  });
  test('lost response is reconciled with the same ID without another POST', async () => {
    const f = fixture();
    f.loseResponse();
    await expect(f.call(submit, request)).rejects.toThrow('response lost');
    expect(await f.call(submit, request)).toMatchObject({ paper: true, replayed: true });
    expect(f.writes).toEqual(['POST']);
  });
  test('unresolved original intent blocks both same and different request IDs', async () => {
    const f = fixture();
    f.loseResponse();
    await expect(f.call(submit, request)).rejects.toThrow();
    f.concealOrder();
    await expect(f.call(submit, request)).rejects.toThrow('unresolved');
    await expect(f.call(submit, { ...request, requestId: crypto.randomUUID() })).rejects.toThrow(
      'unresolved',
    );
    expect(f.writes).toEqual(['POST']);
  });
  test('crash after durable intent but before POST cannot silently resubmit', async () => {
    const f = fixture();
    const intent = paperIntent(ACCOUNT, 1, request.requestId, { action: 'submit', ...request });
    f.intents.set(intent.clientOrderId, intent);
    await expect(f.call(submit, request)).rejects.toThrow('unresolved');
    expect(f.writes).toEqual([]);
  });
  test('changed arguments cannot reuse a request ID and broker-list lag retains reservations', async () => {
    const f = fixture();
    await f.call(submit, request);
    await expect(f.call(submit, { ...request, qty: 2 })).rejects.toThrow('different order');
    expect(await f.call(submit, { ...request, requestId: crypto.randomUUID() })).toMatchObject({
      isError: true,
    });
    expect(f.writes).toEqual(['POST']);
  });
  test('missing human approval, stale data and absent server execution block writes', async () => {
    const f = fixture();
    f.unapprove();
    await expect(f.call(submit, request)).rejects.toThrow('approval');
    const g = fixture();
    g.stale();
    await expect(g.call(submit, request)).rejects.toThrow('fresh');
    const bare = alpacaPaperTools({ fetch: g.fetchImpl }).find((t) => t.name === submit)!;
    await expect(bare.handler(request, g.ctx())).rejects.toThrow('execution');
    expect([...f.writes, ...g.writes]).toEqual([]);
  });
  test('protected exits are never canceled', async () => {
    const f = fixture();
    const stop = brokerOrder({ side: 'sell', type: 'stop' });
    f.open.push(stop);
    await expect(f.call('alpaca_paper_cancel_order', { orderId: stop.id })).rejects.toThrow(
      'protective',
    );
    expect(f.writes).toEqual([]);
  });
  test('replay identity ignores argument key order but includes the account', () => {
    const a = paperIntent(ACCOUNT, 1, request.requestId, { a: 1, b: 2 });
    expect(paperIntent(ACCOUNT, 1, request.requestId, { b: 2, a: 1 })).toEqual(a);
    expect(paperIntent('other', 1, request.requestId, { a: 1, b: 2 }).clientOrderId).not.toBe(
      a.clientOrderId,
    );
  });
});
