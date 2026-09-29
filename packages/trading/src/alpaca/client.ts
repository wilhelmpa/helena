import {
  assertPaperUrl,
  isPaperKeyId,
  MARKET_DATA_URL,
  NotPaperError,
  PAPER_TRADING_URL,
} from './hosts';
import type { PaperKeys } from './limits';
import type { AccountState, PositionState } from './checks';

// A small client for Alpaca's paper trading API and its market data API
// (https://docs.alpaca.markets/reference). Every URL is built from the two paper bases and
// checked again before the request; redirects are refused. It never knows the live host.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class AlpacaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AlpacaError';
  }
}

const TIMEOUT_MS = 15_000;

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  cash: string;
  equity: string;
  last_equity: string;
  buying_power: string;
  portfolio_value?: string;
  trading_blocked: boolean;
  account_blocked: boolean;
  pattern_day_trader?: boolean;
  daytrade_count?: number;
  crypto_status?: string;
}

export interface AlpacaPosition {
  symbol: string;
  asset_class: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  asset_class?: string;
  side: string;
  type: string;
  order_class?: string;
  parent_order_id?: string | null;
  time_in_force: string;
  qty: string | null;
  notional: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  submitted_at: string | null;
  filled_at: string | null;
  canceled_at: string | null;
  legs?: AlpacaOrder[] | null;
}

export interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface AlpacaNewsItem {
  id: number;
  created_at: string;
  headline: string;
  summary: string;
  symbols: string[];
  source: string;
  url: string;
}

export interface AlpacaPortfolioHistory {
  timestamp: number[];
  equity: Array<number | null>;
  profit_loss: Array<number | null>;
  profit_loss_pct: Array<number | null>;
  base_value?: number;
  timeframe?: string;
}

export interface NewOrder {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit';
  time_in_force: 'day' | 'gtc' | 'ioc';
  qty?: string;
  notional?: string;
  limit_price?: string;
  stop_price?: string;
  client_order_id: string;
  order_class?: 'simple' | 'oto' | 'bracket';
  stop_loss?: { stop_price: string };
  take_profit?: { limit_price: string };
}

export const num = (value: string | number | null | undefined): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class AlpacaPaperClient {
  constructor(
    private readonly keys: PaperKeys,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    if (!isPaperKeyId(keys.keyId)) {
      throw new NotPaperError(
        'The key ID is not an Alpaca paper key (paper keys start with PK). Helena trades only in a paper account.',
      );
    }
    if (!keys.secretKey) throw new NotPaperError('The paper connection has no secret key.');
  }

  private async call<T>(
    base: 'trading' | 'data',
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {},
  ): Promise<T> {
    const url = assertPaperUrl(
      new URL(path, base === 'trading' ? PAPER_TRADING_URL : MARKET_DATA_URL),
    );
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }
    const response = await this.fetchImpl(url.toString(), {
      method: init.method ?? 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'APCA-API-KEY-ID': this.keys.keyId,
        'APCA-API-SECRET-KEY': this.keys.secretKey,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === 'string') message = parsed.message;
      } catch {
        // Not JSON: the text as it came.
      }
      throw new AlpacaError(response.status, `Alpaca paper API ${response.status}: ${message}`);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  account(): Promise<AlpacaAccount> {
    return this.call('trading', '/v2/account');
  }

  portfolioHistory(query: {
    period?: '1D' | '1W';
    start?: string;
    timeframe: '5Min' | '1H' | '1D';
  }): Promise<AlpacaPortfolioHistory> {
    return this.call('trading', '/v2/account/portfolio/history', {
      query: { ...query, extended_hours: 'false' },
    });
  }

  positions(): Promise<AlpacaPosition[]> {
    return this.call('trading', '/v2/positions');
  }

  orders(query: {
    status?: 'open' | 'closed' | 'all';
    limit?: number;
    after?: string;
    symbols?: string[];
  }): Promise<AlpacaOrder[]> {
    return this.call('trading', '/v2/orders', {
      query: {
        status: query.status ?? 'open',
        limit: String(query.limit ?? 50),
        after: query.after,
        direction: 'desc',
        nested: 'true',
        symbols: query.symbols?.length ? query.symbols.join(',') : undefined,
      },
    });
  }

  submit(order: NewOrder): Promise<AlpacaOrder> {
    return this.call('trading', '/v2/orders', { method: 'POST', body: order });
  }

  orderByClientId(id: string): Promise<AlpacaOrder> {
    return this.call('trading', '/v2/orders:by_client_order_id', {
      query: { client_order_id: id },
    });
  }

  order(id: string): Promise<AlpacaOrder> {
    return this.call('trading', `/v2/orders/${encodeURIComponent(id)}`, {
      query: { nested: 'true' },
    });
  }

  cancel(orderId: string): Promise<void> {
    return this.call('trading', `/v2/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  }

  closePosition(symbol: string, percentage?: number): Promise<AlpacaOrder> {
    return this.call('trading', `/v2/positions/${encodeURIComponent(symbol.replace('/', ''))}`, {
      method: 'DELETE',
      query: { percentage: percentage !== undefined ? String(percentage) : undefined },
    });
  }

  clock(): Promise<{ timestamp: string; is_open: boolean; next_open: string; next_close: string }> {
    return this.call('trading', '/v2/clock');
  }

  // The latest trade price per symbol: stocks from the IEX feed (what a free paper account
  // gets), crypto from Alpaca's US crypto feed.
  async latestPrices(symbols: string[]): Promise<Record<string, { price: number; time: string }>> {
    const stocks = symbols.filter((symbol) => !symbol.includes('/'));
    const crypto = symbols.filter((symbol) => symbol.includes('/'));
    const out: Record<string, { price: number; time: string }> = {};
    if (stocks.length > 0) {
      const body = await this.call<{ trades?: Record<string, { p: number; t: string }> }>(
        'data',
        '/v2/stocks/trades/latest',
        { query: { symbols: stocks.join(','), feed: 'iex' } },
      );
      for (const [symbol, trade] of Object.entries(body.trades ?? {})) {
        out[symbol] = { price: trade.p, time: trade.t };
      }
    }
    if (crypto.length > 0) {
      const body = await this.call<{ trades?: Record<string, { p: number; t: string }> }>(
        'data',
        '/v1beta3/crypto/us/latest/trades',
        { query: { symbols: crypto.join(',') } },
      );
      for (const [symbol, trade] of Object.entries(body.trades ?? {})) {
        out[symbol] = { price: trade.p, time: trade.t };
      }
    }
    return out;
  }

  async bars(query: {
    symbol: string;
    timeframe: string;
    start: string;
    end?: string;
    limit: number;
  }): Promise<AlpacaBar[]> {
    const crypto = query.symbol.includes('/');
    const body = await this.call<{ bars?: Record<string, AlpacaBar[]> }>(
      'data',
      crypto ? '/v1beta3/crypto/us/bars' : '/v2/stocks/bars',
      {
        query: {
          symbols: query.symbol,
          timeframe: query.timeframe,
          start: query.start,
          end: query.end,
          limit: String(query.limit),
          ...(crypto ? {} : { feed: 'iex', adjustment: 'all' }),
        },
      },
    );
    return body.bars?.[query.symbol] ?? [];
  }

  async news(query: {
    symbols?: string[];
    since?: string;
    limit: number;
  }): Promise<AlpacaNewsItem[]> {
    const body = await this.call<{ news: AlpacaNewsItem[] }>('data', '/v1beta1/news', {
      query: {
        symbols: query.symbols?.map((symbol) => symbol.replace('/', '')).join(','),
        start: query.since,
        limit: String(query.limit),
        sort: 'desc',
      },
    });
    return body.news ?? [];
  }
}

export function accountState(account: AlpacaAccount): AccountState {
  return {
    status: account.status,
    tradingBlocked: account.trading_blocked,
    accountBlocked: account.account_blocked,
    equity: Number(account.equity),
    lastEquity: Number(account.last_equity),
  };
}

export function positionState(position: AlpacaPosition): PositionState {
  const qty = Number(position.qty);
  return {
    symbol: position.symbol,
    qty: position.side === 'short' ? -Math.abs(qty) : qty,
    marketValue: Math.abs(Number(position.market_value)),
  };
}
