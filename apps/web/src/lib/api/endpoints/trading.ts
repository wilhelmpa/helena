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
export interface TradingWidgetResult {
  data: unknown | null;
  error: string | null;
}
export type TradingWidgets = Record<TradingWidgetId, TradingWidgetResult>;

export const getTradingWidgets = (
  projectKey: string,
  period: TradingPeriod,
  credentialId?: number,
) =>
  request<TradingWidgets>(
    `/projects/${encodeURIComponent(projectKey)}/trading/widgets?period=${period}${credentialId ? `&credentialId=${credentialId}` : ''}`,
  );
