import type { PluginApproval } from '@helena/sdk/server';
import { getSetting, setSetting } from '../settings';

// What the Administrator decided about external plugins, read by every process that
// loads them (API, worker): the switch for external plugins as a whole, the plugins
// approved at a version and digest, and each plugin's settings.

export const PLUGIN_SETTINGS_KEY = 'helena.plugins';

export interface PluginSettings {
  externalEnabled: boolean;
  approved: PluginApproval[];
  settings: Record<string, Record<string, unknown>>;
}

const DEFAULTS: PluginSettings = { externalEnabled: false, approved: [], settings: {} };

export async function getPluginSettings(): Promise<PluginSettings> {
  const stored = await getSetting<Partial<PluginSettings>>(PLUGIN_SETTINGS_KEY);
  return {
    externalEnabled: stored?.externalEnabled === true,
    approved: Array.isArray(stored?.approved) ? stored.approved : [],
    settings: stored?.settings && typeof stored.settings === 'object' ? stored.settings : {},
  };
}

export async function setPluginSettings(value: PluginSettings): Promise<void> {
  await setSetting(PLUGIN_SETTINGS_KEY, value);
}

// Where external plugins are looked for. Unset means none are: an instance has to name
// the folder before anything outside the repository can run.
export function pluginsDir(): string | null {
  return process.env.HELENA_PLUGINS_DIR?.trim() || null;
}

export { DEFAULTS as DEFAULT_PLUGIN_SETTINGS };
