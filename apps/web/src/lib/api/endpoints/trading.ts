import { request } from '@/lib/api/core/client';

export type TradingPeriod = 'today' | 'week' | 'pilot';

export interface TradingDashboardData {
  signals: { count: number; note: string | null };
  vetos: { count: number; note: string | null };
  hypotheticalPercent: number | null;
  decisions: { total: number; safe: number; fallback: number };
  watchlist: { symbol: string; rsi: number; direction: string; state: string }[];
  schedules: {
    id: string;
    title: string;
    enabled: boolean;
    status: string | null;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }[];
}

export const getTradingDashboard = (projectKey: string, period: TradingPeriod) =>
  request<TradingDashboardData>(
    `/projects/${encodeURIComponent(projectKey)}/trading/dashboard?period=${period}`,
  );

export type TradingWidgetId =
  'account' | 'positions' | 'orders' | 'history' | 'strategies' | 'decisions';

// One widget's answer: its data or the reason it has none. The server sends the reason in
// English (apps/api trading/widget-data.ts); the widgets word it themselves
// (features/dashboards/utils/tradingErrors.ts).
export interface TradingWidgetResult<T = unknown> {
  data: T | null;
  error: string | null;
}

// The limits of the paper connection, as the owner stored them (packages/trading limits.ts).
export interface TradingLimits {
  maxOrderValueUsd: number;
  maxPositionValueUsd: number;
  maxRiskPerTradeUsd: number;
  dailyLossLimitUsd: number;
  maxOpenPositions: number;
  maxOrdersPerDay: number;
  allowedSymbols: string[];
  allowCrypto: boolean;
  // The owner's own stop for new entries.
  halted: boolean;
}

export interface TradingAccountData {
  status: string;
  currency: string;
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnlUsd: number;
  dayPnlPct: number | null;
  // Any reason why no new position opens: the owner's stop, the broker's block, an account
  // that is not ACTIVE.
  tradingHalted: boolean;
  brokerTradingBlocked: boolean;
  limits: TradingLimits;
  // Limits the connection lacks; every opening order is refused while one is missing.
  missingLimits: string[];
  ordersToday: number;
}

export interface TradingPositionData {
  symbol: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  stopPrice: number | null;
  stopOrderId: string | null;
  strategy: string | null;
  strategyVersion: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | null;
}

export interface TradingOrderData {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  status: string;
  type: string;
  qty: number | null;
  limitPrice: number | null;
  stopPrice: number | null;
  submittedAt: string | null;
  strategy: string | null;
  strategyVersion: string | null;
  journalPath: string | null;
}

export interface TradingOrdersData {
  today: TradingOrderData[];
  open: TradingOrderData[];
  recent: TradingOrderData[];
}

export interface TradingHistoryData {
  currency: string;
  period: TradingPeriod;
  points: {
    time: string;
    equity: number | null;
    profitLoss: number | null;
    profitLossPct: number | null;
  }[];
}

export interface TradingApprovalData {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  accountId: string;
  strategyId: string;
  version: string;
  path: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface TradingStrategiesData {
  items: {
    path: string;
    id: string;
    version: string;
    status: string;
    backtest: string | null;
    approval: TradingApprovalData | null;
  }[];
  approvals: TradingApprovalData[];
}

export interface TradingDecisionCount {
  safe: number;
  unsure: number;
}

export interface TradingDecisionsData {
  classes: {
    classId: string;
    jev: TradingDecisionCount;
    local: TradingDecisionCount;
    other: TradingDecisionCount;
    fallback: number;
  }[];
  vetos: number;
}

export interface TradingWidgetDataMap {
  account: TradingAccountData;
  positions: TradingPositionData[];
  orders: TradingOrdersData;
  history: TradingHistoryData;
  strategies: TradingStrategiesData;
  decisions: TradingDecisionsData;
}

export type TradingWidgets = {
  [K in TradingWidgetId]: TradingWidgetResult<TradingWidgetDataMap[K]>;
};

export const getTradingWidgets = (
  projectKey: string,
  period: TradingPeriod,
  credentialId?: number,
) =>
  request<TradingWidgets>(
    `/projects/${encodeURIComponent(projectKey)}/trading/widgets?period=${period}${credentialId ? `&credentialId=${credentialId}` : ''}`,
  );
