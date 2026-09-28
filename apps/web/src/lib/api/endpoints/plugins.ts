import type { LocalizedText, UiSlotDescriptor } from '@helena/sdk/web';
import { request } from '@/lib/api/core/client';

// Plugins (@helena/sdk): the Administrator's list and decisions, and the UI slots
// plugins add to the web app.

export interface PluginView {
  id: string;
  name: LocalizedText;
  version: string;
  description: LocalizedText | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  source: 'builtin' | 'external';
  status: string;
  error: string | null;
  // external-off | not-approved | version-changed | files-changed
  problem: string | null;
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

// A project's extensions (Projekt › Einstellungen › Erweiterungen): what a plugin brings for
// the project, from its connectors' fields. Secret fields only say whether they are set.
export interface ExtensionField {
  key: string;
  label: LocalizedText;
  // string, secret, url, number, boolean or text.
  type: string;
  required: boolean;
  placeholder: string | null;
  help: LocalizedText | null;
}

export type ExtensionValue = string | number | boolean;

export interface ExtensionConnection {
  id: number;
  label: string | null;
  values: Record<string, ExtensionValue>;
  secrets: Record<string, boolean>;
}

export interface ProjectExtension {
  id: string;
  name: LocalizedText;
  version: string;
  status: string;
  connectors: {
    id: string;
    label: LocalizedText;
    description: LocalizedText | null;
    fields: ExtensionField[];
    connections: ExtensionConnection[];
  }[];
}

export const getProjectExtensions = (projectKey: string) =>
  request<ProjectExtension[]>(`/projects/${encodeURIComponent(projectKey)}/extensions`);

export const updateProjectExtension = (
  projectKey: string,
  credentialId: number,
  values: Record<string, ExtensionValue>,
) =>
  request<ExtensionConnection>(
    `/projects/${encodeURIComponent(projectKey)}/extensions/connections/${credentialId}`,
    { method: 'PATCH', body: JSON.stringify({ values }) },
  );

// By plugin id, the projects it has settings in (Helena › Einstellungen › Erweiterungen).
export const getPluginProjects = () =>
  request<Record<string, { key: string; name: string }[]>>('/god/plugins/projects');
