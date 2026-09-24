import type { LocalizedText } from '@helena/sdk/web';
import { request } from '@/lib/api/core/client';

// The update center (Administrator → Updates, the card on Start): every component Helena
// runs on with its installed and newest version, the summary of what a new version
// changes, and the updates the owner started (docs/helena-decisions/update-center.md).

export type UpdateKind = 'runtime' | 'system' | 'tool' | 'app';
export type UpdateRisk = 'low' | 'medium' | 'high';
export type UpdateScope = 'item' | 'group' | 'security';

export interface UpdateItem {
  id: number;
  source: string;
  sourceLabel: LocalizedText;
  kind: UpdateKind;
  component: string;
  name: string;
  installed: string | null;
  available: string | null;
  updateAvailable: boolean;
  security: boolean;
  risk: UpdateRisk | null;
  breaking: boolean | null;
  summary: string | null;
  highlights: string[];
  summaryCurrent: boolean;
  summaryPending: boolean;
  summaryModel: string | null;
  summaryRunId: number | null;
  summaryError: string | null;
  summarizedAt: string | null;
  sourceUrl: string | null;
  notesUrl: string | null;
  group: string | null;
  applicable: boolean;
  hint: LocalizedText | null;
  detail: string | null;
  error: string | null;
  availableSince: string | null;
  checkedAt: string;
}

export interface UpdateAction {
  id: number;
  source: string;
  component: string;
  name: string;
  components: string[];
  fromVersion: string | null;
  toVersion: string | null;
  state: 'running' | 'done' | 'failed';
  backupPath: string | null;
  log: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  requestedAt: string;
  finishedAt: string | null;
}

export interface UpdateSettings {
  enabled: boolean;
  cron: string;
  timezone: string;
  summarize: boolean;
  agentId: number | null;
  model: string | null;
  reasoning: string;
  claudeChannel: 'latest' | 'stable';
}

export interface UpdateCenter {
  checkedAt: string | null;
  helper: { installed: boolean; error: string | null };
  counts: { updates: number; security: number; applicable: number };
  sources: {
    id: string;
    label: LocalizedText;
    kind: UpdateKind;
    pluginId: string;
    checkedAt: string | null;
    error: string | null;
  }[];
  items: UpdateItem[];
  actions: UpdateAction[];
  settings: UpdateSettings;
  digest: {
    agentId: number | null;
    agentName: string | null;
    model: string | null;
    reasoning: string | null;
    agents: { id: number; username: string; name: string }[];
    models: { id: string; name: string; thinkingLevels: string[] }[];
  };
  job: {
    lastStartedAt: string | null;
    lastFinishedAt: string | null;
    lastStatus: 'running' | 'succeeded' | 'failed' | null;
    lastError: string | null;
    lastTrigger: string | null;
    nextRunAt: string | null;
  };
}

export const getUpdateCenter = () => request<UpdateCenter>('/god/update-center');

export const checkForUpdates = () =>
  request<UpdateCenter>('/god/update-center/check', { method: 'POST' });

export const applyUpdate = (itemId: number, scope: UpdateScope = 'item') =>
  request<UpdateAction>(`/god/update-center/items/${itemId}/apply`, {
    method: 'POST',
    body: JSON.stringify({ scope }),
  });

export const getUpdateAction = (actionId: number) =>
  request<UpdateAction>(`/god/update-center/actions/${actionId}`);

export const setUpdateSettings = (patch: Partial<UpdateSettings>) =>
  request<UpdateSettings>('/god/update-center/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
