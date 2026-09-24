import { request } from '@/lib/api/core/client';

// How much of the plan limits of the subscriptions the agents and the owner work on is
// used (ChatGPT/Codex, Claude): one entry per provider account, one per window
// (docs/helena-decisions/provider-limits.md). Numbers only; the API never sees a login.

export type LimitState = 'ok' | 'near' | 'limited' | 'unknown';
export type LimitWindowKind = 'session' | 'weekly' | 'model' | 'monthly' | 'other';

export interface LimitWindow {
  id: string;
  kind: LimitWindowKind;
  label: string | null;
  usedPercent: number | null;
  currentPercent: number | null;
  windowMinutes: number | null;
  resetsAt: string | null;
  severity: string | null;
  limited: boolean | null;
  state: LimitState;
  agentTokens: number | null;
}

export interface LimitExtra {
  kind: string;
  enabled: boolean;
  unlimited: boolean;
  balance: number | null;
  used: number | null;
  limit: number | null;
  currency: string | null;
}

export interface LimitAccount {
  id: number;
  provider: string;
  account: string;
  source: string;
  login: string | null;
  plan: string | null;
  windows: LimitWindow[];
  extra: LimitExtra | null;
  resetCredits: number | null;
  allowed: boolean | null;
  via: string;
  unavailable: string | null;
  observedAt: string;
  state: LimitState;
  stale: boolean;
  nextResetAt: string | null;
  agents: { id: number; name: string }[];
}

export interface LimitSettings {
  enabled: boolean;
  intervalMinutes: number;
  nearPercent: number;
}

export interface ProviderLimits {
  accounts: LimitAccount[];
  settings: LimitSettings;
  probedAt: string | null;
  state: LimitState;
}

export const getProviderLimits = () => request<ProviderLimits>('/provider-limits');

export const refreshProviderLimits = () =>
  request<ProviderLimits>('/provider-limits/refresh', { method: 'POST' });

export const setLimitSettings = (patch: Partial<LimitSettings>) =>
  request<LimitSettings>('/provider-limits/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const forgetLimitAccount = (limitId: number) =>
  request<void>(`/provider-limits/${limitId}`, { method: 'DELETE' });
