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
  let rejectClose = false;
  let rejectCloseResponse = false;
  let fillStopOnCancel = false;
  let marketOpen = true;
  let pendingClose = false;
  const execution: PaperExecution = {
    precheck: async () => ({ allowed: true, reason: 'synthetic pass' }),
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
    if (u.pathname === '/v2/clock')
      return json({ timestamp: NOW, is_open: marketOpen, next_open: NOW, next_close: NOW });
    if (u.pathname === '/v2/orders' && method === 'GET') return json(open);
    if (u.pathname === '/v2/orders:by_client_order_id') {
      const found = broker.get(u.searchParams.get('client_order_id')!);
      return found && !concealOrder ? json(found) : json({ message: 'not found' }, 404);
    }
    if (u.pathname.startsWith('/v2/orders/') && method === 'GET') {
      const id = u.pathname.split('/').at(-1);
      return json(
        [...open.flatMap((order) => [order, ...(order.legs ?? [])]), ...broker.values()].find(
          (order) => order.id === id,
        ),
      );
    }
    if (u.pathname.startsWith('/v2/orders/') && method === 'DELETE') {
      const id = u.pathname.split('/').at(-1);
      const order = [
        ...open.flatMap((root) => [root, ...(root.legs ?? [])]),
        ...broker.values(),
      ].find((entry) => entry.id === id);
      if (!order) return json({ message: 'not found' }, 404);
      order.status = fillStopOnCancel && order.type === 'stop' ? 'filled' : 'canceled';
      if (order.status === 'filled') held = 0;
      return new Response(null, { status: 204 });
    }
    if (u.pathname === '/v2/stocks/trades/latest')
      return json({
        trades: Object.fromEntries(
          (u.searchParams.get('symbols') ?? 'SPY')
            .split(',')
            .map((symbol) => [symbol, { p: 600, t: stale ? '2026-09-30T15:00:00Z' : NOW }]),
        ),
      });
    if (u.pathname === '/v1beta3/crypto/us/latest/trades')
      return json({ trades: { 'BTC/USD': { p: 65000, t: '2026-09-30T15:00:00Z' } } });
    if (u.pathname === '/v2/orders' && method === 'POST') {
      expect(intents.size).toBeGreaterThan(0); // Durable write precedes any broker mutation.
      const body = JSON.parse(String(init?.body));
      if (rejectClose && body.side === 'sell' && body.type === 'market')
        return json({ message: 'close rejected' }, 422);
      const order = brokerOrder({
        ...body,
        status:
          rejectCloseResponse && body.side === 'sell' && body.type === 'market'
            ? 'rejected'
            : body.side === 'sell' && body.type === 'market' && !pendingClose
              ? 'filled'
              : 'accepted',
        filled_qty:
          body.side === 'sell' && body.type === 'market' && !pendingClose && !rejectCloseResponse
            ? body.qty
            : '0',
        limit_price: body.limit_price ?? null,
      });
      broker.set(order.client_order_id, order);
      if (order.status === 'filled' && order.side === 'sell') held = 0;
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
    rejectClose: () => {
      rejectClose = true;
    },
    rejectCloseResponse: () => {
      rejectCloseResponse = true;
    },
    fillStopOnCancel: () => {
      fillStopOnCancel = true;
    },
    closeMarket: () => {
      marketOpen = false;
    },
    pendingClose: () => {
      pendingClose = true;
    },
  };
}
const submit = 'alpaca_paper_submit_order';

describe('paper precheck precedes every write', () => {
  test('a negative or uncertain result prevents the order and durable intent', async () => {
    for (const reason of ['Rule failed.', 'Uncertain news.', 'Duplicate order.']) {
      const f = fixture();
      f.execution.precheck = async () => ({ allowed: false, reason });
      expect(await f.call(submit, request)).toMatchObject({ isError: true });
      expect(f.writes).toEqual([]);
      expect(f.intents.size).toBe(0);
    }
  });
  test('a failed precheck leaves the protective stop in place', async () => {
    const f = fixture();
    f.held(1);
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    f.open.push(stop);
    f.execution.precheck = async () => ({ allowed: false, reason: 'Review required.' });
    expect(
      await f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the synthetic position.',
      }),
    ).toMatchObject({ isError: true });
    expect(stop.status).toBe('new');
    expect(f.writes).toEqual([]);
  });
  test('a timeout cannot place an order', async () => {
    const f = fixture();
    f.execution.precheck = async () => {
      throw new Error('timeout');
    };
    await expect(f.call(submit, request)).rejects.toThrow('timeout');
    expect(f.writes).toEqual([]);
  });
});

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
  test('pending buys use position budget and ordinary pending sells cannot be oversold', async () => {
    const f = fixture();
    f.open.push(brokerOrder());
    expect(await f.call(submit, request)).toMatchObject({ isError: true });
    f.open.length = 0;
    f.held(2);
    f.open.push(brokerOrder({ side: 'sell', qty: '2', type: 'limit' }));
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
    f.held(1);
    const stop = brokerOrder({ side: 'sell', type: 'stop' });
    f.open.push(stop);
    await expect(f.call('alpaca_paper_cancel_order', { orderId: stop.id })).rejects.toThrow(
      'protective',
    );
    expect(f.writes).toEqual([]);
  });
  test('a bracket target cannot cancel its sibling stop while shares are held', async () => {
    const f = fixture();
    f.held(1);
    const target = brokerOrder({
      side: 'sell',
      type: 'limit',
      parent_order_id: crypto.randomUUID(),
    });
    f.open.push(target);
    await expect(f.call('alpaca_paper_cancel_order', { orderId: target.id })).rejects.toThrow(
      'protective',
    );
    expect(f.writes).toEqual([]);
  });
  test('an unfilled entry with attached exits can be canceled', async () => {
    const f = fixture();
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    const entry = brokerOrder({ symbol: 'QQQ', order_class: 'oto', legs: [stop] });
    f.open.push(entry);
    expect(await f.call('alpaca_paper_cancel_order', { orderId: entry.id })).toMatchObject({
      canceled: entry.id,
    });
    expect(entry.status).toBe('canceled');
    expect(await f.call('alpaca_paper_cancel_order', { orderId: entry.id })).toMatchObject({
      replayed: true,
    });
    expect(f.writes).toEqual(['DELETE']);
  });
  test('an unfilled entry can be canceled while older shares of the symbol are held', async () => {
    const f = fixture();
    f.held(1);
    const entry = brokerOrder({ order_class: 'oto', filled_qty: '0' });
    f.open.push(entry);
    expect(await f.call('alpaca_paper_cancel_order', { orderId: entry.id })).toMatchObject({
      canceled: entry.id,
    });
    expect(f.writes).toEqual(['DELETE']);
  });
  test('a full close cancels the stop, reconciles and returns a journal; replay does not sell twice', async () => {
    const f = fixture();
    f.held(1);
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    f.open.push(stop);
    const close = {
      requestId: crypto.randomUUID(),
      symbol: 'SPY',
      rationale: 'Close the approved test position.',
    };
    const result = await f.call('alpaca_paper_close_position', close);
    expect(result).toMatchObject({ paper: true, order: { side: 'sell' } });
    expect((result as { journal: string }).journal).toContain('typ: trade');
    expect(stop.status).toBe('canceled');
    expect(f.writes).toEqual(['DELETE', 'POST']);
    expect(await f.call('alpaca_paper_close_position', close)).toMatchObject({ replayed: true });
    expect(f.writes).toEqual(['DELETE', 'POST']);
  });
  test('a rejected close restores the stop and leaves the position held', async () => {
    const f = fixture();
    f.held(1);
    f.rejectClose();
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    f.open.push(stop);
    await expect(
      f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the approved test position.',
      }),
    ).rejects.toThrow('close rejected');
    expect(f.writes).toEqual(['DELETE', 'POST', 'POST']);
    expect(
      [...f.broker.values()].some((order) => order.side === 'sell' && order.type === 'stop'),
    ).toBe(true);
  });
  test('a bracket close cancels its stop and target before selling', async () => {
    const f = fixture();
    f.held(1);
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    const target = brokerOrder({ side: 'sell', type: 'limit', limit_price: '640' });
    f.open.push(brokerOrder({ status: 'filled', order_class: 'bracket', legs: [stop, target] }));
    expect(
      await f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the bracket protected position.',
      }),
    ).toMatchObject({ paper: true, order: { side: 'sell' } });
    expect(stop.status).toBe('canceled');
    expect(target.status).toBe('canceled');
    expect(f.writes).toEqual(['DELETE', 'DELETE', 'POST']);
  });
  test('a rejected close response restores the stop', async () => {
    const f = fixture();
    f.held(1);
    f.rejectCloseResponse();
    const stop = brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' });
    f.open.push(stop);
    await expect(
      f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the approved test position.',
      }),
    ).rejects.toThrow('protection was reconciled');
    expect(f.writes).toEqual(['DELETE', 'POST', 'POST']);
  });
  test('a stop fill during cancellation does not trigger a second sell or replacement stop', async () => {
    const f = fixture();
    f.held(1);
    f.fillStopOnCancel();
    f.open.push(brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' }));
    await expect(
      f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the approved test position.',
      }),
    ).rejects.toThrow('protective exit changed');
    expect(f.writes).toEqual(['DELETE']);
  });
  test('a held stock keeps its stop while the market is closed', async () => {
    const f = fixture();
    f.held(1);
    f.closeMarket();
    f.open.push(brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' }));
    await expect(
      f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the approved test position.',
      }),
    ).rejects.toThrow('market is closed');
    expect(f.writes).toEqual([]);
  });
  test('an unfilled close is canceled and the remaining shares regain a stop', async () => {
    const f = fixture();
    f.held(1);
    f.pendingClose();
    f.open.push(brokerOrder({ side: 'sell', type: 'stop', stop_price: '580' }));
    await expect(
      f.call('alpaca_paper_close_position', {
        requestId: crypto.randomUUID(),
        symbol: 'SPY',
        rationale: 'Close the approved test position.',
      }),
    ).rejects.toThrow('protection was reconciled');
    expect(f.writes).toEqual(['DELETE', 'POST', 'DELETE', 'POST']);
    expect(
      [...f.broker.values()].some((order) => order.type === 'stop' && order.status === 'accepted'),
    ).toBe(true);
  });
  test('crypto entry refusal precedes stale trade data', async () => {
    const f = fixture();
    const crypto = { ...request, symbol: 'BTC/USD', stopLossPrice: 58000 };
    const result = await f.call(submit, crypto);
    expect(result).toMatchObject({ isError: true });
    expect(
      (
        result as { structuredContent: { checks: { violations: string[] } } }
      ).structuredContent.checks.violations.join(' '),
    ).toContain('Crypto entries are disabled');
    expect(f.writes).toEqual([]);
    expect(await f.call('alpaca_paper_market', { symbols: ['BTC/USD'] })).toMatchObject({
      prices: { 'BTC/USD': { price: 65000, time: '2026-09-30T15:00:00Z' } },
    });
  });
  test('replay identity ignores argument key order but includes the account', () => {
    const a = paperIntent(ACCOUNT, 1, request.requestId, { a: 1, b: 2 });
    expect(paperIntent(ACCOUNT, 1, request.requestId, { b: 2, a: 1 })).toEqual(a);
    expect(paperIntent('other', 1, request.requestId, { a: 1, b: 2 }).clientOrderId).not.toBe(
      a.clientOrderId,
    );
  });
});
