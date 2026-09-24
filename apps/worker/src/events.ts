import { createEventBus, type EventTransport } from '@helena/sdk';
import { PluginHost, loadExternalPlugins } from '@helena/sdk/server';
import { getPluginSettings, pluginsDir } from '@repo/db';
import { webhooksManifest, webhooksPlugin } from '@repo/db/plugins';

// The worker's side of the framework (docs/helena-framework.md): the plugins whose durable
// event subscribers the worker serves over the workflow engine's event transport
// (engine-delivery.ts, decision D-C2). While an api runs without the engine, it runs every
// subscriber in process instead.

export interface EventDelivery {
  host: PluginHost;
  // Called at start with the engine's transport (index.ts).
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
