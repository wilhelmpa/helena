import { createEventBus, type EventTransport } from '@helena/sdk';
import { PluginHost, loadExternalPlugins } from '@helena/sdk/server';
import { getPluginSettings, pluginsDir } from '@repo/db';
import { webhooksManifest, webhooksPlugin } from '@repo/db/plugins';

// The worker's side of the framework (docs/helena-framework.md): the plugins whose durable
// event subscribers the worker serves once the workflow engine provides the event
// transport (hub/native-engine, decision D-C2). Until then the API runs every subscriber
// in process, and the worker only loads the plugins.

export interface EventDelivery {
  host: PluginHost;
  // Called by the workflow engine at start with its transport.
  useTransport(transport: EventTransport): Promise<void>;
  stop(): void;
}

export async function startEventDelivery(): Promise<EventDelivery> {
  const bus = createEventBus();
  const host = new PluginHost({ process: 'worker', events: bus });
  await host.load(webhooksPlugin, webhooksManifest);

  const root = pluginsDir();
  if (root) {
    const settings = await getPluginSettings();
    const plugins = await loadExternalPlugins(host, {
      root,
      entry: 'server',
      policy: { enabled: settings.externalEnabled, approved: settings.approved },
    });
    for (const plugin of plugins) {
      console.log(
        `[plugins] ${plugin.manifest.id} ${plugin.manifest.version}: ${plugin.status}` +
          (plugin.error ? ` (${plugin.error})` : ''),
      );
    }
  }
  await host.start();

  let delivery: { stop(): Promise<void> } | null = null;
  return {
    host,
    async useTransport(transport) {
      bus.useTransport(transport);
      delivery = await transport.start(() => bus.subscriptions());
    },
    stop() {
      void delivery?.stop();
      void host.stop();
    },
  };
}
