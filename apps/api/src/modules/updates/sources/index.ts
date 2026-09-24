import type { HelenaPlugin, UpdateSource } from '@helena/sdk';
import { aptSource } from './apt';
import { cliRuntimesSource } from './cli-runtimes';
import { helenaSource } from './helena';
import { hermesSource } from './hermes';
import { hostToolsSource } from './host-tools';

// The built-in update sources, registered through the plugin host like a plugin's
// (internal plugin `helena.updates`, modules/plugins/builtin.ts).

export const UPDATES_PLUGIN_ID = 'helena.updates';

export const BUILTIN_UPDATE_SOURCES: UpdateSource[] = [
  hermesSource,
  cliRuntimesSource,
  aptSource,
  hostToolsSource,
  helenaSource,
];

export const updatesPlugin: HelenaPlugin = {
  register(ctx) {
    for (const source of BUILTIN_UPDATE_SOURCES) ctx.updateSources.register(source);
  },
};
