import { z } from 'zod';
import type { AgentTool, ToolCallContext } from '@helena/sdk';
import {
  accountState,
  AlpacaPaperClient,
  num,
  positionState,
  type AlpacaOrder,
  type Fetch,
  type NewOrder,
} from './client';
import { assetClassOf, checkOrder, tradingDay, type CheckResult, type OrderRequest } from './checks';
import { readKeys, readLimits } from './limits';

// The paper account as agent tools (connector `alpaca_paper`). Reading is `read`; placing,
// cancelling and closing are `write`: a paper account moves no money, and the Autopilot
// lets the Paper-Trader act at level 1 while Helena's own checks (checks.ts) stop every
// order the owner's limits do not allow. Order tools of any other server count as `pay`
// (@helena/policy trading.ts).

export const ALPACA_PAPER_CONNECTOR = 'alpaca_paper';

const STOCK = /^[A-Z][A-Z0-9.]{0,9}$/;
const CRYPTO = /^[A-Z0-9]{2,10}\/(USD|USDT|USDC|BTC)$/;
const symbolSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => STOCK.test(value) || CRYPTO.test(value), {
    message: 'A US stock or ETF symbol (AAPL, SPY) or a crypto pair with a slash (BTC/USD).',
  });

const strategyId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/)
  .describe('The strategy id from its note in Strategien/ (kebab-case), e.g. "orb-spy".');
const strategyVersion = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3}){0,2}$/)
  .describe('The strategy version the owner approved for paper trading, e.g. "1.2".');

const orderFields = {
  symbol: symbolSchema.describe('US stock/ETF (AAPL) or crypto pair (BTC/USD).'),
  side: z.enum(['buy', 'sell']).describe('buy opens or adds (long only); sell reduces or closes.'),
  qty: z.number().positive().optional().describe('Quantity; fractional for crypto.'),
  notional: z.number().positive().optional().describe('Or a USD amount instead of qty.'),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit']).default('market'),
  limitPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional().describe('Trigger of a stop or stop-limit sell.'),
  timeInForce: z.enum(['day', 'gtc', 'ioc']).optional().describe('Default: day for stocks, gtc for crypto.'),
  stopLossPrice: z
    .number()
    .positive()
    .optional()
    .describe('Required for a buy: the protective stop. For stocks it is attached to the order.'),
  takeProfitPrice: z.number().positive().optional().describe('Optional target for a stock buy.'),
};

const checkSchema = z.object(orderFields);

const submitSchema = z.object({
  ...orderFields,
  strategyId,
  strategyVersion,
  rationale: z
    .string()
    .min(10)
    .max(600)
    .describe('Why this order: the rule of the strategy version it follows, in one or two sentences.'),
});

type CheckInput = z.infer<typeof checkSchema>;
type SubmitInput = z.infer<typeof submitSchema>;

export interface PaperToolDeps {
  fetch?: Fetch;
  now?: () => Date;
}

function clientOf(ctx: ToolCallContext, deps: PaperToolDeps): AlpacaPaperClient {
  return new AlpacaPaperClient(readKeys(ctx.credential ?? {}), deps.fetch ?? fetch);
}

function orderView(order: AlpacaOrder) {
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    orderClass: order.order_class ?? 'simple',
    qty: order.qty === null ? null : num(order.qty),
    notional: order.notional === null ? null : num(order.notional),
    filledQty: num(order.filled_qty),
    filledAvgPrice: order.filled_avg_price === null ? null : num(order.filled_avg_price),
    limitPrice: order.limit_price === null ? null : num(order.limit_price),
    stopPrice: order.stop_price === null ? null : num(order.stop_price),
    status: order.status,
    submittedAt: order.submitted_at,
    filledAt: order.filled_at,
    legs: (order.legs ?? []).map((leg) => ({
      id: leg.id,
      type: leg.type,
      side: leg.side,
      status: leg.status,
      limitPrice: leg.limit_price === null ? null : num(leg.limit_price),
      stopPrice: leg.stop_price === null ? null : num(leg.stop_price),
    })),
  };
}

async function ordersToday(client: AlpacaPaperClient, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 26 * 3600 * 1000).toISOString();
  const today = tradingDay(now);
  const orders = await client.orders({ status: 'all', limit: 500, after: since });
  return orders.filter(
    (order) => order.submitted_at && tradingDay(new Date(order.submitted_at)) === today,
  ).length;
}

// Everything the checks need, fetched fresh for every order.
async function runChecks(
  client: AlpacaPaperClient,
  credential: Record<string, unknown>,
  order: OrderRequest,
  now: Date,
): Promise<CheckResult> {
  const { limits, missing } = readLimits(credential);
  const [account, positions, count, prices] = await Promise.all([
    client.account(),
    client.positions(),
    ordersToday(client, now),
    client.latestPrices([order.symbol]),
  ]);
  return checkOrder({
    limits,
    missingLimits: missing,
    account: accountState(account),
    positions: positions.map(positionState),
    ordersToday: count,
    order,
    price: prices[order.symbol]?.price ?? 0,
  });
}

function orderRequest(input: CheckInput): OrderRequest {
  return {
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    qty: input.qty,
    notional: input.notional,
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
  };
}

const fixed = (value: number, digits: number) =>
  String(Math.round(value * 10 ** digits) / 10 ** digits);

// The order as Alpaca takes it. A stock buy carries its stop (OTO) and target (bracket);
// Alpaca offers no attached exits for crypto, so a crypto position gets its stop as a
// separate stop-limit sell once the buy is filled.
export function alpacaOrder(input: SubmitInput, check: CheckResult, clientOrderId: string): NewOrder {
  const crypto = check.assetClass === 'crypto';
  const order: NewOrder = {
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    time_in_force: input.timeInForce ?? (crypto ? 'gtc' : 'day'),
    client_order_id: clientOrderId,
  };
  if (input.qty !== undefined) order.qty = fixed(input.qty, crypto ? 9 : 6);
  else if (input.notional !== undefined) order.notional = fixed(input.notional, 2);
  if (input.limitPrice !== undefined) order.limit_price = fixed(input.limitPrice, crypto ? 6 : 2);
  if (input.stopPrice !== undefined) order.stop_price = fixed(input.stopPrice, crypto ? 6 : 2);
  if (!crypto && check.opening && input.stopLossPrice !== undefined) {
    order.stop_loss = { stop_price: fixed(input.stopLossPrice, 2) };
    if (input.takeProfitPrice !== undefined) {
      order.take_profit = { limit_price: fixed(input.takeProfitPrice, 2) };
      order.order_class = 'bracket';
    } else {
      order.order_class = 'oto';
    }
  }
  return order;
}

export function clientOrderIdFor(input: SubmitInput, now: Date): string {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `helena-${input.strategyId}-v${input.strategyVersion}-${stamp}`;
}

// A journal entry the Paper-Trader files right away (trade-journal-fuehren skill).
export function journalEntry(
  input: SubmitInput,
  check: CheckResult,
  order: ReturnType<typeof orderView>,
  now: Date,
): string {
  const lines = [
    '---',
    'typ: trade',
    `trade_id: ${order.clientOrderId}`,
    `strategie: ${input.strategyId}`,
    `version: "${input.strategyVersion}"`,
    `markt: ${check.assetClass === 'crypto' ? 'krypto' : 'aktien'}`,
    `symbol: ${input.symbol}`,
    `seite: ${input.side === 'buy' ? 'kauf' : 'verkauf'}`,
    `menge: ${fixed(check.qty, 6)}`,
    `einstieg_geplant: ${fixed(check.price, 6)}`,
    ...(input.stopLossPrice !== undefined ? [`stop: ${input.stopLossPrice}`] : []),
    ...(input.takeProfitPrice !== undefined ? [`ziel: ${input.takeProfitPrice}`] : []),
    ...(check.riskUsd !== null ? [`risiko_usd: ${check.riskUsd}`] : []),
    `order_id: ${order.id}`,
    `status: ${order.status}`,
    `datum: ${now.toISOString()}`,
    'konto: paper',
    '---',
    '',
    `# ${input.side === 'buy' ? 'Kauf' : 'Verkauf'} ${input.symbol} – [[${input.strategyId}]] v${input.strategyVersion}`,
    '',
    `**Begründung:** ${input.rationale}`,
  ];
  return lines.join('\n');
}

export function alpacaPaperTools(deps: PaperToolDeps = {}): AgentTool<unknown>[] {
  const now = () => (deps.now ? deps.now() : new Date());
  const tools = [
    {
      name: 'alpaca_paper_account',
      title: 'Paper account',
      description:
        "The Alpaca PAPER account (simulated money): equity, cash, buying power, today's P&L, " +
        "the owner's hard limits and how many orders were placed today. Read it before any order.",
      inputSchema: z.object({}),
      category: 'read',
      async handler(_input: unknown, ctx: ToolCallContext) {
        const client = clientOf(ctx, deps);
        const [account, count] = await Promise.all([client.account(), ordersToday(client, now())]);
        const { limits, missing } = readLimits(ctx.credential ?? {});
        const state = accountState(account);
        return {
          paper: true,
          account: {
            status: account.status,
            currency: account.currency,
            equity: state.equity,
            cash: num(account.cash),
            buyingPower: num(account.buying_power),
            lastEquity: state.lastEquity,
            dayPnl: Math.round((state.equity - state.lastEquity) * 100) / 100,
            tradingBlocked: account.trading_blocked,
            cryptoStatus: account.crypto_status ?? null,
          },
          limits,
          missingLimits: missing,
          ordersToday: count,
        };
      },
    },
    {
      name: 'alpaca_paper_positions',
      title: 'Paper positions',
      description: 'The open positions of the Alpaca PAPER account with entry, price and unrealized P&L.',
      inputSchema: z.object({}),
      category: 'read',
      async handler(_input: unknown, ctx: ToolCallContext) {
        const positions = await clientOf(ctx, deps).positions();
        return {
          positions: positions.map((position) => ({
            symbol: position.symbol,
            assetClass: position.asset_class,
            qty: num(position.qty),
            avgEntryPrice: num(position.avg_entry_price),
            currentPrice: num(position.current_price),
            marketValue: num(position.market_value),
            unrealizedPl: num(position.unrealized_pl),
            unrealizedPlPct: Math.round(num(position.unrealized_plpc) * 10000) / 100,
          })),
        };
      },
    },
    {
      name: 'alpaca_paper_orders',
      title: 'Paper orders',
      description:
        'Orders of the Alpaca PAPER account, newest first. Helena\'s orders have a clientOrderId ' +
        '"helena-<strategy>-v<version>-<time>", which links each to its strategy version.',
      inputSchema: z.object({
        status: z.enum(['open', 'closed', 'all']).default('open'),
        limit: z.number().int().min(1).max(200).default(50),
        after: z.iso.datetime({ offset: true }).optional().describe('Only orders submitted after this time.'),
        symbols: z.array(symbolSchema).max(20).optional(),
      }),
      category: 'read',
      async handler(input: unknown, ctx: ToolCallContext) {
        const query = input as { status: 'open' | 'closed' | 'all'; limit: number; after?: string; symbols?: string[] };
        const orders = await clientOf(ctx, deps).orders(query);
        return { orders: orders.map(orderView) };
      },
    },
    {
      name: 'alpaca_paper_market',
      title: 'Paper market prices',
      description:
        'Latest trade prices (stocks: IEX feed; crypto: Alpaca US feed) and whether the US ' +
        'stock market is open, from the paper account\'s market data.',
      inputSchema: z.object({ symbols: z.array(symbolSchema).min(1).max(20) }),
      category: 'read',
      async handler(input: unknown, ctx: ToolCallContext) {
        const client = clientOf(ctx, deps);
        const { symbols } = input as { symbols: string[] };
        const [prices, clock] = await Promise.all([client.latestPrices(symbols), client.clock()]);
        return { prices, market: { open: clock.is_open, nextOpen: clock.next_open, nextClose: clock.next_close } };
      },
    },
    {
      name: 'alpaca_paper_bars',
      title: 'Paper market bars',
      description:
        'Historical OHLCV bars for one symbol from the paper account\'s market data (stocks: ' +
        'IEX feed, split-adjusted; crypto: Alpaca US feed).',
      inputSchema: z.object({
        symbol: symbolSchema,
        timeframe: z.enum(['1Min', '5Min', '15Min', '1Hour', '1Day', '1Week']).default('1Day'),
        start: z.iso.datetime({ offset: true }).describe('ISO time of the first bar.'),
        end: z.iso.datetime({ offset: true }).optional(),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      category: 'read',
      async handler(input: unknown, ctx: ToolCallContext) {
        const query = input as { symbol: string; timeframe: string; start: string; end?: string; limit: number };
        const bars = await clientOf(ctx, deps).bars(query);
        return { symbol: query.symbol, timeframe: query.timeframe, bars };
      },
    },
    {
      name: 'alpaca_paper_check_order',
      title: 'Check a paper order',
      description:
        "Run Helena's hard checks for an order without placing it: the owner's limits (order " +
        'value, position value, risk to the stop, daily loss limit, open positions, orders per ' +
        'day), long only, a stop for every entry. Answers ok and the violations.',
      inputSchema: checkSchema,
      category: 'read',
      async handler(input: unknown, ctx: ToolCallContext) {
        const client = clientOf(ctx, deps);
        return runChecks(client, ctx.credential ?? {}, orderRequest(input as CheckInput), now());
      },
    },
    {
      name: 'alpaca_paper_submit_order',
      title: 'Place a paper order',
      description:
        'Place an order in the Alpaca PAPER account (simulated money only; Helena has no ' +
        "live trading). Helena checks the owner's hard limits first and refuses the order " +
        'with the reasons when one is not met. Only for a strategy version the owner approved ' +
        'for paper trading. File the returned journal entry right away.',
      inputSchema: submitSchema,
      category: 'write',
      async handler(input: unknown, ctx: ToolCallContext) {
        const request = input as SubmitInput;
        const client = clientOf(ctx, deps);
        const at = now();
        const check = await runChecks(client, ctx.credential ?? {}, orderRequest(request), at);
        if (!check.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Refused by Helena's paper limits, nothing was sent:\n- ${check.violations.join('\n- ')}`,
              },
            ],
            structuredContent: { refused: true, checks: check },
            isError: true,
          };
        }
        const clientOrderId = clientOrderIdFor(request, at);
        const placed = orderView(await client.submit(alpacaOrder(request, check, clientOrderId)));
        return {
          paper: true,
          order: placed,
          checks: check,
          journal: journalEntry(request, check, placed, at),
          ...(check.assetClass === 'crypto' && check.opening
            ? {
                next:
                  'Crypto has no attached stop: once the buy is filled, place a stop_limit sell at ' +
                  'stopLossPrice with the same strategyId and strategyVersion.',
              }
            : {}),
        };
      },
    },
    {
      name: 'alpaca_paper_cancel_order',
      title: 'Cancel a paper order',
      description: 'Cancel an open order of the Alpaca PAPER account by its id.',
      inputSchema: z.object({ orderId: z.string().regex(/^[0-9a-f-]{36}$/i) }),
      category: 'write',
      async handler(input: unknown, ctx: ToolCallContext) {
        const { orderId } = input as { orderId: string };
        await clientOf(ctx, deps).cancel(orderId);
        return { paper: true, canceled: orderId };
      },
    },
    {
      name: 'alpaca_paper_close_position',
      title: 'Close a paper position',
      description:
        'Close a position of the Alpaca PAPER account at market, wholly or by percentage. ' +
        'Allowed after the daily loss limit and while new entries are halted.',
      inputSchema: z.object({
        symbol: symbolSchema,
        percentage: z.number().min(1).max(100).optional(),
        rationale: z.string().min(10).max(600),
      }),
      category: 'write',
      async handler(input: unknown, ctx: ToolCallContext) {
        const { symbol, percentage } = input as { symbol: string; percentage?: number };
        const order = await clientOf(ctx, deps).closePosition(symbol, percentage);
        return { paper: true, order: orderView(order), assetClass: assetClassOf(symbol) };
      },
    },
  ] satisfies AgentTool<unknown>[];
  return tools.map((tool) => ({ ...tool, connector: ALPACA_PAPER_CONNECTOR }));
}
