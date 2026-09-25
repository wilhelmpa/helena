import type { PaperLimits } from './limits';

// The hard checks before an order reaches the paper account (docs/helena-decisions/
// trading.md §5.3). Pure: the caller fetches the account, the positions, today's orders and
// a price, and this decides. An order that fails any check is not sent.
//
// Helena's paper trading is long only: a buy opens or adds to a position, a sell reduces or
// closes one and may never sell more than is held (no short selling). Every check below
// that limits risk applies to opening orders; reducing a position is always allowed while
// the account can trade, even past the daily loss limit or with new entries halted.

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit';
export type AssetClass = 'us_equity' | 'crypto';

export interface OrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty?: number;
  notional?: number;
  limitPrice?: number;
  stopPrice?: number;
  // Where the trade's protective stop sits; required to open a position.
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface AccountState {
  status: string;
  tradingBlocked: boolean;
  accountBlocked: boolean;
  equity: number;
  // The equity at the previous trading day's close.
  lastEquity: number;
}

export interface PositionState {
  symbol: string;
  // Positive for a long position.
  qty: number;
  marketValue: number;
}

export interface CheckInput {
  limits: PaperLimits;
  missingLimits: string[];
  account: AccountState;
  positions: PositionState[];
  // Orders submitted today (US trading day), any status.
  ordersToday: number;
  order: OrderRequest;
  // The latest trade price of the symbol, in USD.
  price: number;
}

export interface CheckResult {
  ok: boolean;
  violations: string[];
  opening: boolean;
  assetClass: AssetClass;
  qty: number;
  price: number;
  notionalUsd: number;
  riskUsd: number | null;
  positionAfterUsd: number;
  dayPnlUsd: number;
}

export function assetClassOf(symbol: string): AssetClass {
  return symbol.includes('/') ? 'crypto' : 'us_equity';
}

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

// The price an order is valued at: a limit price when it has one (the most a buy may pay),
// otherwise the latest trade.
function valuationPrice(order: OrderRequest, price: number): number {
  if ((order.type === 'limit' || order.type === 'stop_limit') && order.limitPrice) {
    return order.side === 'buy' ? Math.max(order.limitPrice, 0) : order.limitPrice;
  }
  if (order.type === 'stop' && order.stopPrice) return order.stopPrice;
  return price;
}

export function checkOrder(input: CheckInput): CheckResult {
  const { limits, account, order } = input;
  const violations: string[] = [];
  const symbol = order.symbol.toUpperCase();
  const assetClass = assetClassOf(symbol);
  const held = input.positions.find((p) => p.symbol.toUpperCase() === symbol.replace('/', ''))
    ?? input.positions.find((p) => p.symbol.toUpperCase() === symbol);
  const heldQty = held?.qty ?? 0;
  const heldValue = held?.marketValue ?? 0;
  const opening = order.side === 'buy';
  const unitPrice = valuationPrice(order, input.price);
  const qty =
    order.qty !== undefined && order.qty > 0
      ? order.qty
      : order.notional !== undefined && order.notional > 0 && unitPrice > 0
        ? order.notional / unitPrice
        : 0;
  const notionalUsd = order.notional !== undefined && order.notional > 0 ? order.notional : qty * unitPrice;
  const dayPnlUsd = account.equity - account.lastEquity;

  // The account and the order itself.
  if (account.status !== 'ACTIVE' || account.tradingBlocked || account.accountBlocked) {
    violations.push(`The paper account cannot trade (status ${account.status}).`);
  }
  if ((order.qty === undefined) === (order.notional === undefined)) {
    violations.push('Give either qty or notional, not both and not neither.');
  }
  if (!(qty > 0) || !(unitPrice > 0)) {
    violations.push('The order has no positive quantity or no price to value it at.');
  }
  if (order.type === 'limit' && !(order.limitPrice && order.limitPrice > 0)) {
    violations.push('A limit order needs limitPrice.');
  }
  if ((order.type === 'stop' || order.type === 'stop_limit') && !(order.stopPrice && order.stopPrice > 0)) {
    violations.push('A stop order needs stopPrice.');
  }
  if (order.type === 'stop_limit' && !(order.limitPrice && order.limitPrice > 0)) {
    violations.push('A stop-limit order needs limitPrice.');
  }
  if (limits.allowedSymbols.length > 0 && !limits.allowedSymbols.includes(symbol)) {
    violations.push(`${symbol} is not on the allowed symbols of the paper connection.`);
  }
  if (assetClass === 'crypto' && !limits.allowCrypto) {
    violations.push('Crypto is switched off in the paper connection.');
  }

  if (!opening) {
    // Reducing or closing: never more than is held.
    if (heldQty <= 0) violations.push(`There is no long position in ${symbol} to sell (no short selling).`);
    else if (qty > heldQty + 1e-9) {
      violations.push(`Selling ${round(qty, 6)} would exceed the ${round(heldQty, 6)} held (no short selling).`);
    }
    if (order.stopLossPrice !== undefined || order.takeProfitPrice !== undefined) {
      violations.push('stopLossPrice and takeProfitPrice belong to an opening buy.');
    }
    return {
      ok: violations.length === 0,
      violations,
      opening,
      assetClass,
      qty,
      price: unitPrice,
      notionalUsd: round(notionalUsd),
      riskUsd: null,
      positionAfterUsd: round(Math.max(heldValue - notionalUsd, 0)),
      dayPnlUsd: round(dayPnlUsd),
    };
  }

  // Opening or adding: every limit.
  if (input.missingLimits.length > 0) {
    violations.push(
      `The paper connection has no limit for ${input.missingLimits.join(', ')}: no position opens until the owner sets it.`,
    );
  }
  if (limits.halted) violations.push('New entries are halted by the owner (Handel angehalten).');
  if (order.type !== 'market' && order.type !== 'limit') {
    violations.push('A position opens with a market or limit order; stop orders only protect or close one.');
  }
  if (dayPnlUsd <= -limits.dailyLossLimitUsd) {
    violations.push(
      `The daily loss limit is reached (${round(dayPnlUsd)} USD against -${limits.dailyLossLimitUsd} USD): no new position today.`,
    );
  }
  if (input.ordersToday >= limits.maxOrdersPerDay) {
    violations.push(`${input.ordersToday} orders today: the limit is ${limits.maxOrdersPerDay} per day.`);
  }
  if (notionalUsd > limits.maxOrderValueUsd + 1e-9) {
    violations.push(
      `The order is worth ${round(notionalUsd)} USD; the limit per order is ${limits.maxOrderValueUsd} USD.`,
    );
  }
  const positionAfterUsd = heldValue + notionalUsd;
  if (positionAfterUsd > limits.maxPositionValueUsd + 1e-9) {
    violations.push(
      `The position would be worth ${round(positionAfterUsd)} USD; the limit per position is ${limits.maxPositionValueUsd} USD.`,
    );
  }
  const openPositions = input.positions.filter((p) => p.qty > 0).length;
  if (heldQty <= 0 && openPositions + 1 > limits.maxOpenPositions) {
    violations.push(
      `${openPositions} positions are open; the limit is ${limits.maxOpenPositions}.`,
    );
  }
  let riskUsd: number | null = null;
  if (!(order.stopLossPrice && order.stopLossPrice > 0)) {
    violations.push('An opening order needs stopLossPrice: no position without a stop.');
  } else if (order.stopLossPrice >= unitPrice) {
    violations.push(`The stop (${order.stopLossPrice}) has to lie below the entry (${round(unitPrice, 6)}).`);
  } else {
    riskUsd = (unitPrice - order.stopLossPrice) * qty;
    if (riskUsd > limits.maxRiskPerTradeUsd + 1e-9) {
      violations.push(
        `The trade risks ${round(riskUsd)} USD down to its stop; the limit per trade is ${limits.maxRiskPerTradeUsd} USD.`,
      );
    }
  }
  if (order.takeProfitPrice !== undefined && !(order.takeProfitPrice > unitPrice)) {
    violations.push(`The target (${order.takeProfitPrice}) has to lie above the entry (${round(unitPrice, 6)}).`);
  }
  return {
    ok: violations.length === 0,
    violations,
    opening,
    assetClass,
    qty,
    price: unitPrice,
    notionalUsd: round(notionalUsd),
    riskUsd: riskUsd === null ? null : round(riskUsd),
    positionAfterUsd: round(positionAfterUsd),
    dayPnlUsd: round(dayPnlUsd),
  };
}

// The US trading day of an instant, as YYYY-MM-DD in New York.
export function tradingDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
