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
