import type { AlpacaOrder } from './client';

export interface PendingExposure {
  symbol: string;
  buyUsd: number;
  sellQty: number;
}

export const normalizedSymbol = (symbol: string) => symbol.toUpperCase().replace('/', '');
const TERMINAL = new Set(['filled', 'canceled', 'expired', 'rejected', 'replaced']);

export function terminalOrder(order: AlpacaOrder): boolean {
  return TERMINAL.has(order.status);
}

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function pendingExposures(
  orders: AlpacaOrder[],
  prices: Record<string, { price: number }>,
): PendingExposure[] {
  const totals = new Map<string, PendingExposure>();
  const seen = new Set<string>();
  for (const root of orders) {
    const group = new Map<string, PendingExposure>();
    const visit = (order: AlpacaOrder) => {
      if (!order.id || !order.symbol || !order.status)
        throw new Error('A pending paper order is incomplete.');
      if (seen.has(order.id)) return;
      seen.add(order.id);
      if (!terminalOrder(order)) {
        const symbol = normalizedSymbol(order.symbol);
        const item = group.get(symbol) ?? { symbol, buyUsd: 0, sellQty: 0 };
        const qty = positive(order.qty);
        const filled = order.filled_qty == null ? 0 : Number(order.filled_qty);
        if (!Number.isFinite(filled) || filled < 0 || (qty !== null && filled > qty))
          throw new Error('A pending paper order has an invalid filled quantity.');
        const remaining = qty === null ? null : Math.max(0, qty - filled);
        if (order.side === 'buy') {
          const notional = positive(order.notional);
          const price = positive(order.limit_price) ?? positive(prices[symbol]?.price);
          if (notional === null && (remaining === null || price === null))
            throw new Error('A pending paper buy cannot be valued safely.');
          item.buyUsd += notional ?? remaining! * price!;
        } else if (order.side === 'sell' && remaining !== null) {
          // Attached OCO/bracket exits share inventory; independent roots reserve separately.
          item.sellQty = Math.max(item.sellQty, remaining);
        } else {
          throw new Error('A pending paper order has no safe side or quantity.');
        }
        group.set(symbol, item);
      }
      for (const leg of order.legs ?? []) visit(leg);
    };
    visit(root);
    for (const [symbol, item] of group) {
      const current = totals.get(symbol) ?? { symbol, buyUsd: 0, sellQty: 0 };
      current.buyUsd += item.buyUsd;
      current.sellQty += item.sellQty;
      totals.set(symbol, current);
    }
  }
  return [...totals.values()];
}
