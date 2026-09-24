import { consoleLogger, createEventBus, type HelenaPlugin, type PluginManifest } from '@helena/sdk';
import { PluginHost, createOutboxDispatcher, loadExternalPlugins } from '@helena/sdk/server';
import {
  WEBHOOK_EVENT_PATTERNS,
  domainEventStore,
  fanOutWebhooks,
  getPluginSettings,
  pluginsDir,
} from '@repo/db';
import { startPollLoop, type WorkerHandle } from './poll-loop';

// The worker's side of the framework (docs/helena-framework.md): the domain event
// dispatcher and the plugins whose durable subscribers it runs. Built-in consumers are
// internal plugins, external ones are loaded from HELENA_PLUGINS_DIR when the
// Administrator switched them on and approved them.

const EVENT_POLL_MS = 1000;

// Outgoing webhooks: every issue and comment event becomes a delivery per subscribed
// webhook (@repo/db fanOutWebhooks); the webhook loop in worker.ts posts them.
const webhooksManifest: PluginManifest = {
  id: 'helena.webhooks',
  name: 'Webhooks',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: {},
  permissions: { events: WEBHOOK_EVENT_PATTERNS },
};

const webhooksPlugin: HelenaPlugin = {
  register(ctx) {
    // The subscription id `helena.webhooks:fanout` is WEBHOOK_CONSUMER_ID.
    ctx.events.subscribe(WEBHOOK_EVENT_PATTERNS, fanOutWebhooks, { id: 'fanout' });
  },
};

export async function startEventDispatcher(): Promise<WorkerHandle & { host: PluginHost }> {
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
        `[events] plugin ${plugin.manifest.id} ${plugin.manifest.version}: ${plugin.status}` +
          (plugin.error ? ` (${plugin.error})` : ''),
      );
    }
  }
  await host.start();

  const dispatcher = createOutboxDispatcher({
    store: domainEventStore(),
    subscriptions: () => bus.subscriptions(),
    log: consoleLogger('events'),
  });
  const loop = startPollLoop(
    'events',
    async () => {
      await dispatcher.tick();
    },
    () => EVENT_POLL_MS,
  );
  return {
    host,
    stop() {
      loop.stop();
      void host.stop();
    },
  };
}
