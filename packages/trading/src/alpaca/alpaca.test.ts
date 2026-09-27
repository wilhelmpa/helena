import { describe, expect, test } from 'bun:test';
import type { ToolCallContext } from '@helena/sdk';
import { checkOrder, tradingDay, type CheckInput } from './checks';
import { AlpacaPaperClient, type Fetch } from './client';
import { assertPaperUrl, isPaperKeyId, NotPaperError } from './hosts';
import { readLimits } from './limits';
import { alpacaPaperTools } from './tools';
import { alpacaPaperConnector } from './connector';

const LIMITS = {
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
  maxOpenPositions: 3,
  maxOrdersPerDay: 10,
  allowedSymbols: [],
  allowCrypto: true,
  halted: false,
};

function input(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    limits: LIMITS,
    missingLimits: [],
    account: {
      status: 'ACTIVE',
      tradingBlocked: false,
      accountBlocked: false,
      equity: 100_000,
      lastEquity: 100_020,
    },
    positions: [],
    pending: [],
    ordersToday: 0,
    order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 1, stopLossPrice: 580 },
    price: 600,
    ...overrides,
  };
}

describe('paper hosts and keys', () => {
  test('only the paper hosts pass', () => {
    expect(assertPaperUrl('https://paper-api.alpaca.markets/v2/orders').hostname).toBe(
      'paper-api.alpaca.markets',
    );
    expect(assertPaperUrl('https://data.alpaca.markets/v2/stocks/bars').hostname).toBe(
      'data.alpaca.markets',
    );
    for (const url of [
      'https://api.alpaca.markets/v2/orders',
      'http://paper-api.alpaca.markets/v2/orders',
      'https://paper-api.alpaca.markets:8443/v2/orders',
      'https://user:pw@paper-api.alpaca.markets/v2/orders',
      'https://paper-api.alpaca.markets.evil.example/v2/orders',
      'https://broker-api.alpaca.markets/v1/accounts',
    ]) {
      expect(() => assertPaperUrl(url)).toThrow(NotPaperError);
    }
  });

  test('paper keys start with PK', () => {
    expect(isPaperKeyId('PKABCDEFGHIJ1234567')).toBe(true);
    expect(isPaperKeyId('AKABCDEFGHIJ1234567')).toBe(false);
    expect(isPaperKeyId('')).toBe(false);
    expect(() => new AlpacaPaperClient({ keyId: 'AKLIVE12345678', secretKey: 'x' })).toThrow(
      NotPaperError,
    );
  });
});

describe('limits', () => {
  test('a missing limit is reported, optional ones get defaults', () => {
    const { limits, missing } = readLimits({
      maxOrderValueUsd: 1000,
      maxPositionValueUsd: '2000',
      dailyLossLimitUsd: 0,
      allowedSymbols: 'spy, qqq;BTC/USD',
      tradingHalted: 'true',
    });
    expect(missing).toEqual(['maxRiskPerTradeUsd', 'dailyLossLimitUsd']);
    expect(limits.maxPositionValueUsd).toBe(2000);
    expect(limits.maxOpenPositions).toBe(5);
    expect(limits.maxOrdersPerDay).toBe(20);
    expect(limits.allowedSymbols).toEqual(['SPY', 'QQQ', 'BTC/USD']);
    expect(limits.halted).toBe(true);
    expect(limits.allowCrypto).toBe(true);
  });
});

describe('order checks', () => {
  test('an order within every limit passes', () => {
    const result = checkOrder(input());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.notionalUsd).toBe(600);
    expect(result.riskUsd).toBe(20);
  });

  test('every limit stops an opening order', () => {
    const cases: [Partial<CheckInput>, RegExp][] = [
      [
        { order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 2, stopLossPrice: 590 } },
        /per order/,
      ],
      [
        {
          positions: [{ symbol: 'SPY', qty: 3, marketValue: 1800 }],
          order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 1, stopLossPrice: 595 },
        },
        /per position/,
      ],
      [
        { order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 1, stopLossPrice: 540 } },
        /per trade/,
      ],
      [{ order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 1 } }, /needs stopLossPrice/],
      [
        { order: { symbol: 'SPY', side: 'buy', type: 'market', qty: 1, stopLossPrice: 610 } },
        /below the entry/,
      ],
      [
        {
          account: {
            status: 'ACTIVE',
            tradingBlocked: false,
            accountBlocked: false,
            equity: 99_800,
            lastEquity: 100_000,
          },
        },
        /daily loss limit/,
      ],
      [{ ordersToday: 10 }, /per day/],
      [
        {
          positions: [
            { symbol: 'AAPL', qty: 1, marketValue: 200 },
            { symbol: 'QQQ', qty: 1, marketValue: 500 },
            { symbol: 'BTCUSD', qty: 0.01, marketValue: 600 },
          ],
        },
        /positions are open/,
      ],
      [{ limits: { ...LIMITS, halted: true } }, /halted/],
      [{ limits: { ...LIMITS, allowedSymbols: ['QQQ'] } }, /allowed symbols/],
      [{ missingLimits: ['dailyLossLimitUsd'] }, /no limit for dailyLossLimitUsd/],
      [
        {
          order: {
            symbol: 'SPY',
            side: 'buy',
            type: 'stop',
            qty: 1,
            stopPrice: 601,
            stopLossPrice: 590,
          },
        },
        /market or limit/,
      ],
      [
        {
          account: {
            status: 'ACCOUNT_UPDATED',
            tradingBlocked: true,
            accountBlocked: false,
            equity: 1,
            lastEquity: 1,
          },
        },
        /cannot trade/,
      ],
    ];
    for (const [overrides, reason] of cases) {
      const result = checkOrder(input(overrides));
      expect(result.ok).toBe(false);
      expect(result.violations.join(' ')).toMatch(reason);
    }
  });

  test('crypto can be switched off', () => {
    const result = checkOrder(
      input({
        limits: { ...LIMITS, allowCrypto: false },
        order: {
          symbol: 'BTC/USD',
          side: 'buy',
          type: 'market',
          notional: 100,
          stopLossPrice: 60_000,
        },
        price: 65_000,
      }),
    );
    expect(result.violations.join(' ')).toMatch(/Crypto is switched off/);
  });

  test('crypto entries stay disabled even when the connection allows crypto', () => {
    const result = checkOrder(
      input({
        order: {
          symbol: 'BTC/USD',
          side: 'buy',
          type: 'limit',
          qty: 0.01,
          limitPrice: 60000,
          stopLossPrice: 58000,
        },
        price: 60000,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.join(' ')).toContain('protective exits');
  });

  test('long only: a sell never exceeds the position', () => {
    expect(
      checkOrder(
        input({ order: { symbol: 'SPY', side: 'sell', type: 'market', qty: 1 } }),
      ).violations.join(' '),
    ).toMatch(/no long position/);
    expect(
      checkOrder(
        input({
          positions: [{ symbol: 'SPY', qty: 2, marketValue: 1200 }],
          order: { symbol: 'SPY', side: 'sell', type: 'market', qty: 3 },
        }),
      ).violations.join(' '),
    ).toMatch(/exceed/);
  });

  test('closing stays possible past the daily loss limit and while entries are halted', () => {
    const result = checkOrder(
      input({
        limits: { ...LIMITS, halted: true },
        account: {
          status: 'ACTIVE',
          tradingBlocked: false,
          accountBlocked: false,
          equity: 99_000,
          lastEquity: 100_000,
        },
        positions: [{ symbol: 'BTCUSD', qty: 0.02, marketValue: 1300 }],
        order: {
          symbol: 'BTC/USD',
          side: 'sell',
          type: 'stop_limit',
          qty: 0.02,
          stopPrice: 60_000,
          limitPrice: 59_800,
        },
        price: 65_000,
      }),
    );
    expect(result.violations).toEqual([]);
    expect(result.opening).toBe(false);
  });

  test('the trading day is New York time', () => {
    expect(tradingDay(new Date('2026-10-01T03:30:00Z'))).toBe('2026-09-30');
    expect(tradingDay(new Date('2026-10-01T14:30:00Z'))).toBe('2026-10-01');
  });
});

// A fake Alpaca that records every request.
function fakeAlpaca(state: { equity?: string; lastEquity?: string; orders?: unknown[] } = {}) {
  const requests: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl: Fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, body });
    const { pathname } = new URL(url);
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (pathname === '/v2/account') {
      return json({
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        status: 'ACTIVE',
        currency: 'USD',
        cash: '100000',
        equity: state.equity ?? '100000',
        last_equity: state.lastEquity ?? '100000',
        buying_power: '200000',
        trading_blocked: false,
        account_blocked: false,
      });
    }
    if (pathname === '/v2/positions') return json([]);
    if (pathname === '/v2/orders' && method === 'GET') return json(state.orders ?? []);
    if (pathname === '/v2/stocks/trades/latest') {
      return json({ trades: { SPY: { p: 600, t: '2026-10-01T15:00:00Z' } } });
    }
    if (pathname === '/v2/orders' && method === 'POST') {
      return json({
        id: '11111111-2222-3333-4444-555555555555',
        client_order_id: (body as { client_order_id: string }).client_order_id,
        symbol: 'SPY',
        side: 'buy',
        type: 'market',
        order_class: (body as { order_class?: string }).order_class,
        time_in_force: 'day',
        qty: '1',
        notional: null,
        filled_qty: '0',
        filled_avg_price: null,
        limit_price: null,
        stop_price: null,
        status: 'accepted',
        submitted_at: '2026-10-01T15:00:01Z',
        filled_at: null,
        canceled_at: null,
        legs: [],
      });
    }
    return json({ message: `unexpected ${method} ${pathname}` }, 404);
  };
  return { fetchImpl, requests };
}

const CREDENTIAL = {
  keyId: 'PKTEST1234567890',
  secretKey: 'secret',
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
};

function context(
  credential: Record<string, string | number | boolean> = CREDENTIAL,
): ToolCallContext {
  return {
    agent: null,
    project: { id: 1, key: 'TRADE', teamId: 1 },
    credentialId: 1,
    credential,
    log: { debug() {}, info() {}, warn() {}, error() {} } as unknown as ToolCallContext['log'],
  };
}

function tool(fetchImpl: Fetch, name: string) {
  const found = alpacaPaperTools({
    fetch: fetchImpl,
    now: () => new Date('2026-10-01T15:00:00Z'),
    execution: {
      withAccountLock: (_ctx, _id, work) => work(),
      findIntent: async () => null,
      activeIntents: async () => [],
      beginIntent: async () => {},
      finishIntent: async () => {},
      authorizeStrategy: async () => {},
    },
  }).find((entry) => entry.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

const ORDER = {
  requestId: '01234567-89ab-4cde-8fab-0123456789ab',
  symbol: 'SPY',
  side: 'buy',
  type: 'market',
  qty: 1,
  stopLossPrice: 580,
  takeProfitPrice: 640,
  strategyId: 'orb-spy',
  strategyVersion: '1.2',
  rationale: 'Ausbruch über die 15-Minuten-Spanne nach Regel 3 von orb-spy 1.2.',
};

describe('paper tools', () => {
  test('an order within the limits goes to the paper API as a bracket order', async () => {
    const { fetchImpl, requests } = fakeAlpaca();
    const result = (await tool(fetchImpl, 'alpaca_paper_submit_order').handler(
      ORDER,
      context(),
    )) as {
      order: { clientOrderId: string };
      journal: string;
    };
    const post = requests.find((request) => request.method === 'POST');
    expect(post?.url).toBe('https://paper-api.alpaca.markets/v2/orders');
    expect(post?.body).toMatchObject({
      symbol: 'SPY',
      side: 'buy',
      type: 'market',
      qty: '1',
      time_in_force: 'day',
      order_class: 'bracket',
      stop_loss: { stop_price: '580' },
      take_profit: { limit_price: '640' },
    });
    expect(result.order.clientOrderId).toMatch(/^helena-[a-f0-9]{40}$/);
    expect(result.journal).toContain('strategie: orb-spy');
    expect(result.journal).toContain('[[orb-spy]] v1.2');
    for (const request of requests) {
      expect(new URL(request.url).hostname).toMatch(/^(paper-api|data)\.alpaca\.markets$/);
    }
  });

  test('an order over a limit is refused and nothing is sent', async () => {
    const { fetchImpl, requests } = fakeAlpaca({ equity: '99800', lastEquity: '100000' });
    const result = (await tool(fetchImpl, 'alpaca_paper_submit_order').handler(
      ORDER,
      context(),
    )) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/daily loss limit/);
    expect(requests.some((request) => request.method === 'POST')).toBe(false);
  });

  test('a live key never reaches Alpaca', async () => {
    const { fetchImpl, requests } = fakeAlpaca();
    await expect(
      tool(fetchImpl, 'alpaca_paper_account').handler(
        {},
        context({ ...CREDENTIAL, keyId: 'AKLIVEKEY123456' }),
      ),
    ).rejects.toThrow(NotPaperError);
    expect(requests).toEqual([]);
  });

  test('the account tool shows the limits and the orders of the day', async () => {
    const { fetchImpl } = fakeAlpaca({
      orders: [
        { id: '1', submitted_at: '2026-10-01T14:00:00Z' },
        { id: '2', submitted_at: '2026-09-30T14:00:00Z' },
      ],
    });
    const result = (await tool(fetchImpl, 'alpaca_paper_account').handler({}, context())) as {
      paper: boolean;
      ordersToday: number;
      limits: { maxRiskPerTradeUsd: number };
    };
    expect(result.paper).toBe(true);
    expect(result.ordersToday).toBe(1);
    expect(result.limits.maxRiskPerTradeUsd).toBe(50);
  });

  test('the connector reports a live key and missing limits in its health', async () => {
    const { fetchImpl } = fakeAlpaca();
    const connector = alpacaPaperConnector({ fetch: fetchImpl });
    expect((await connector.health!({ ...CREDENTIAL, keyId: 'AKLIVEKEY123456' })).status).toBe(
      'error',
    );
    expect((await connector.health!({ keyId: 'PKTEST1234567890', secretKey: 's' })).status).toBe(
      'degraded',
    );
    expect((await connector.health!(CREDENTIAL)).status).toBe('ok');
    expect(connector.tools?.every((entry) => entry.connector === 'alpaca_paper')).toBe(true);
    expect(
      Object.fromEntries((connector.tools ?? []).map((entry) => [entry.name, entry.category])),
    ).toEqual({
      alpaca_paper_account: 'read',
      alpaca_paper_positions: 'read',
      alpaca_paper_orders: 'read',
      alpaca_paper_market: 'read',
      alpaca_paper_bars: 'read',
      trading_indikatoren: 'read',
      trading_signal_pruefen: 'read',
      alpaca_paper_check_order: 'read',
      alpaca_paper_submit_order: 'write',
      alpaca_paper_cancel_order: 'write',
      alpaca_paper_close_position: 'write',
    });
  });
});
