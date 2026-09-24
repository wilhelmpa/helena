import type { UiSlotDescriptor } from '@helena/sdk/web';
import { request } from '@/lib/api/core/client';

// Plugins (@helena/sdk): the Administrator's list and decisions, and the UI slots
// plugins add to the web app.

export interface PluginView {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  source: 'builtin' | 'external';
  status: string;
  error: string | null;
  digest: string | null;
  approved: boolean;
  restartRequired: boolean;
  provides: Record<string, string[]>;
  permissions: { actions: string[]; events: string[]; network: string[]; credentials: boolean };
}

export interface PluginsOverview {
  externalEnabled: boolean;
  pluginsDir: string | null;
  plugins: PluginView[];
}

export const getPlugins = () => request<PluginsOverview>('/god/plugins');
export const setExternalPlugins = (externalEnabled: boolean) =>
  request<PluginsOverview>('/god/plugins', {
    method: 'PUT',
    body: JSON.stringify({ externalEnabled }),
  });
export const approvePlugin = (pluginId: string) =>
  request<PluginsOverview>(`/god/plugins/${encodeURIComponent(pluginId)}/approval`, {
    method: 'POST',
  });
export const revokePlugin = (pluginId: string) =>
  request<PluginsOverview>(`/god/plugins/${encodeURIComponent(pluginId)}/approval`, {
    method: 'DELETE',
  });

export const getPluginUiSlots = () => request<UiSlotDescriptor[]>('/plugins/ui-slots');
