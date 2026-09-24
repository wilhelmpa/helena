import type { HelenaPlugin, PluginManifest } from '@helena/sdk';
import { WEBHOOK_EVENT_PATTERNS, fanOutWebhooks } from './domains/webhook-fanout';

// Outgoing webhooks as an internal plugin: a durable subscriber of every issue and comment
// event that queues a delivery per subscribed webhook (domains/webhook-fanout.ts). Both
// the API and the worker load it: without an event transport the API runs it in process
// right after the change; with one, the worker serves it off the transport.
export const webhooksManifest: PluginManifest = {
  id: 'helena.webhooks',
  name: 'Webhooks',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: {},
  permissions: { events: WEBHOOK_EVENT_PATTERNS },
};

export const webhooksPlugin: HelenaPlugin = {
  register(ctx) {
    // The subscription id `helena.webhooks:fanout` is WEBHOOK_CONSUMER_ID.
    ctx.events.subscribe(WEBHOOK_EVENT_PATTERNS, fanOutWebhooks, { id: 'fanout' });
  },
};
