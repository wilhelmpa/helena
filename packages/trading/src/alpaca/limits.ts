// The owner's hard limits for the paper account, stored with the paper keys in the
// connection (Werkzeuge → Alpaca Paper): only the owner edits a connection, never an agent,
// so an agent cannot raise its own limits. The written rule book (Regelwerk.md in the
// project knowledge) says the same in words; these numbers are what Helena enforces before
// every order.

export interface PaperLimits {
  // Largest value of one order, in USD.
  maxOrderValueUsd: number;
  // Largest value of one position after the order, in USD.
  maxPositionValueUsd: number;
  // Most that one new position may lose down to its stop, in USD.
  maxRiskPerTradeUsd: number;
  // Once the account is down this much since the last close, no new position opens that day.
  dailyLossLimitUsd: number;
  maxOpenPositions: number;
  maxOrdersPerDay: number;
  // Only these symbols (empty: any symbol Alpaca trades).
  allowedSymbols: string[];
  allowCrypto: boolean;
  // The owner's own stop for new entries; closing and cancelling stay possible.
  halted: boolean;
}

export interface PaperKeys {
  keyId: string;
  secretKey: string;
}

export const DEFAULT_MAX_OPEN_POSITIONS = 5;
export const DEFAULT_MAX_ORDERS_PER_DAY = 20;

function positive(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function symbolList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

// The limits a stored connection holds, or the fields that are missing. A limit that is
// missing, zero or not a number makes every opening order refused: no limit is no permission.
export function readLimits(
  credential: Record<string, unknown>,
): { limits: PaperLimits; missing: string[] } {
  const missing: string[] = [];
  const need = (key: keyof PaperLimits & string): number => {
    const value = positive(credential[key]);
    if (value === null) missing.push(key);
    return value ?? 0;
  };
  const limits: PaperLimits = {
    maxOrderValueUsd: need('maxOrderValueUsd'),
    maxPositionValueUsd: need('maxPositionValueUsd'),
    maxRiskPerTradeUsd: need('maxRiskPerTradeUsd'),
    dailyLossLimitUsd: need('dailyLossLimitUsd'),
    maxOpenPositions: Math.floor(
      positive(credential.maxOpenPositions) ?? DEFAULT_MAX_OPEN_POSITIONS,
    ),
    maxOrdersPerDay: Math.floor(positive(credential.maxOrdersPerDay) ?? DEFAULT_MAX_ORDERS_PER_DAY),
    allowedSymbols: symbolList(credential.allowedSymbols),
    allowCrypto: flag(credential.allowCrypto, true),
    halted: flag(credential.tradingHalted, false),
  };
  return { limits, missing };
}

export function readKeys(credential: Record<string, unknown>): PaperKeys {
  return {
    keyId: String(credential.keyId ?? '').trim(),
    secretKey: String(credential.secretKey ?? '').trim(),
  };
}
