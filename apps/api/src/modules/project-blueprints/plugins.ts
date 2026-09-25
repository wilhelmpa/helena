import { host } from '#shared/helena';
import { TRADING_PLUGIN_ID, tradingManifest, tradingPlugin } from '#modules/trading/plugin';

// A script runs without the API's app, so the built-in plugins whose connectors a blueprint
// binds tools of are loaded here on their own (the API loads them with the rest,
// modules/plugins/builtin.ts). Loading twice is skipped.
export async function loadBuiltinPluginsForScripts(): Promise<void> {
  if (!host.get(TRADING_PLUGIN_ID)) await host.load(tradingPlugin, tradingManifest());
}
