import { describe, expect, test } from 'bun:test';
import { classifyShell, classifyToolCall } from './classify';
import { isOrderToolName, LIVE_TRADING_HOSTS, mentionsLiveTradingHost } from './trading';

describe('live trading hosts', () => {
  test('a live trading API in a command or code is found', () => {
    expect(mentionsLiveTradingHost('curl https://api.alpaca.markets/v2/orders')).toBe(true);
    expect(mentionsLiveTradingHost("requests.post('https://api.binance.com/api/v3/order')")).toBe(
      true,
    );
    expect(mentionsLiveTradingHost('wss://api.alpaca.markets/stream')).toBe(true);
    expect(mentionsLiveTradingHost('host = "fapi.binance.com"')).toBe(true);
    // A domain covers its subdomains, as in the egress lists.
    expect(mentionsLiveTradingHost('https://www.okx.com/api/v5/trade/order')).toBe(true);
    expect(mentionsLiveTradingHost('See api.kraken.com.')).toBe(true);
  });

  test('paper, test and data hosts are not live trading hosts', () => {
    for (const text of [
      'curl https://paper-api.alpaca.markets/v2/account',
      'https://data.alpaca.markets/v2/stocks/AAPL/bars',
      'https://testnet.binance.vision/api/v3/order',
      'https://data-api.binance.vision/api/v3/klines',
      'https://demo-futures.kraken.com/derivatives/api/v3',
      'https://api-testnet.bybit.com/v5/order/create',
      'https://api-fxpractice.oanda.com/v3/accounts',
      'https://sandbox.tradier.com/v1/accounts',
      'https://api.coingecko.com/api/v3/simple/price',
      'notapi.binance.com.example',
    ]) {
      expect(mentionsLiveTradingHost(text)).toBe(false);
    }
  });

  test('every host is a plain lowercase name', () => {
    for (const host of LIVE_TRADING_HOSTS) expect(host).toMatch(/^[a-z0-9.-]+$/);
    expect(new Set(LIVE_TRADING_HOSTS).size).toBe(LIVE_TRADING_HOSTS.length);
  });
});

describe('order tool names', () => {
  test('tools that place, change or cancel orders or move funds', () => {
    for (const name of [
      'place_stock_order',
      'place_crypto_order',
      'place_option_order',
      'replace_order_by_id',
      'cancel_order_by_id',
      'cancel_all_orders',
      'close_position',
      'close_all_positions',
      'exercise_options_position',
      'do_not_exercise_options_position',
      'create_order',
      'createOrder',
      'place-market-order',
      'place-limit-order',
      'submitOrder',
      'order_create',
      'buy',
      'sell',
      'market_buy',
      'withdraw',
      'transfer_funds',
      'send_crypto',
    ]) {
      expect({ name, order: isOrderToolName(name) }).toEqual({ name, order: true });
    }
  });

  test('reading tools are not orders', () => {
    for (const name of [
      'get_orders',
      'list_orders',
      'get_order_by_id',
      'get_positions',
      'get_account_info',
      'get_stock_bars',
      'search_knowledge',
      'create_issue',
      'trade_journal_summary',
      'create_trade_journal',
      'get_crypto_trades',
      'get_open_orders',
      'open_orders',
      'short_interest',
      'create_chart',
    ]) {
      expect({ name, order: isOrderToolName(name) }).toEqual({ name, order: false });
    }
  });
});

describe('classification', () => {
  test("an order tool of someone else's MCP server is pay", () => {
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'mcp_alpaca_place_stock_order',
        mcp: { server: 'alpaca', annotations: { readOnlyHint: false } },
      }),
    ).toEqual({ category: 'pay', scope: 'external' });
    expect(
      classifyToolCall({
        runtime: 'claude',
        tool: 'mcp__ccxt__createOrder',
        mcp: { server: 'ccxt', annotations: null },
      }),
    ).toEqual({ category: 'pay', scope: 'external' });
  });

  test("Helena's own paper tools keep their category", () => {
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'mcp_itsaplan_alpaca_paper_submit_order',
        mcp: { server: 'itsaplan', action: 'write' },
      }),
    ).toEqual({ category: 'write', scope: 'workspace' });
  });

  test('a command or code that reaches a live trading API is pay', () => {
    expect(classifyShell('curl -s https://api.alpaca.markets/v2/account')).toEqual({
      category: 'pay',
      scope: 'external',
    });
    expect(
      classifyToolCall({
        runtime: 'hermes',
        tool: 'execute_code',
        command: 'import ccxt\nx = "https://api.binance.com"',
      }),
    ).toEqual({ category: 'pay', scope: 'external' });
    expect(classifyShell('curl -s https://paper-api.alpaca.markets/v2/account').category).not.toBe(
      'pay',
    );
  });
});
