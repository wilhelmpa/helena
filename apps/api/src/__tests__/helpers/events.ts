import { createEventBus } from '@helena/sdk';
import { createOutboxDispatcher } from '@helena/sdk/server';
import {
  WEBHOOK_CONSUMER_ID,
  WEBHOOK_EVENT_PATTERNS,
  domainEventStore,
  fanOutWebhooks,
} from '@repo/db';

// Runs the domain event dispatcher the worker runs (apps/worker/src/events.ts) until the
// outbox is drained, with the built-in durable consumers, so a test can observe what the
// consumers do (a webhook delivery queued) right after the change.
export async function deliverDomainEvents(): Promise<void> {
  const bus = createEventBus();
  bus.subscribe(WEBHOOK_EVENT_PATTERNS, fanOutWebhooks, {
    id: WEBHOOK_CONSUMER_ID,
    durable: true,
  });
  const quiet = { info() {}, warn() {}, error() {} };
  const dispatcher = createOutboxDispatcher({
    store: domainEventStore(),
    subscriptions: () => bus.subscriptions(),
    log: quiet,
  });
  for (let round = 0; round < 20; round++) {
    const report = await dispatcher.tick();
    if (!report.fannedOut && !report.delivered && !report.retried) return;
  }
}
