import type { Logger } from '../common';
import {
  matchesEventPattern,
  type EventSubscription,
  type EventTransport,
  type HelenaEvent,
} from '../events';

// A transactional outbox as an event transport, for an engine that stores events in a
// table of its own and lets a dispatcher claim them: the change and its event are written
// in one transaction; the dispatcher fans each new event out to the durable subscribers
// whose patterns match, one delivery per subscriber, and runs them with retries, so a
// failing subscriber delays only itself.
//
// Helena itself owns no queue and no table (orchestrator decision D-C2): the workflow
// engine (hub/native-engine) provides the EventTransport, either with this helper over a
// store on its own tables or natively on its queue.

export interface OutboxDelivery {
  deliveryId: number;
  consumer: string;
  // 1 on the first attempt.
  attempt: number;
  event: HelenaEvent;
}

export interface OutboxStore {
  // Stores events, inside the change's transaction when one is passed.
  append(events: HelenaEvent[], tx?: unknown): Promise<void>;
  // Takes up to `limit` events not yet fanned out, creates a delivery for every consumer
  // `route` names, and marks the events fanned out, in one transaction. Returns how many
  // events it took.
  fanOut(route: (event: HelenaEvent) => string[], limit: number): Promise<number>;
  // Claims due deliveries for the given consumers and leases them for `leaseMs`.
  claim(consumers: string[], limit: number, leaseMs: number): Promise<OutboxDelivery[]>;
  complete(deliveryId: number): Promise<void>;
  retry(deliveryId: number, at: Date, error: string): Promise<void>;
  // Gives up: the delivery stays for inspection and is never tried again.
  fail(deliveryId: number, error: string): Promise<void>;
  // Removes events older than `before` whose deliveries all finished.
  prune(before: Date): Promise<number>;
}

export interface OutboxDispatcherOptions {
  store: OutboxStore;
  subscriptions: () => EventSubscription[];
  log: Logger;
  batch?: number;
  maxAttempts?: number;
  leaseMs?: number;
  // The delay before attempt `attempt + 1`.
  backoffMs?: (attempt: number) => number;
  retentionMs?: number;
}

export interface DispatchReport {
  fannedOut: number;
  delivered: number;
  retried: number;
  failed: number;
}

// 5 s, 10 s, 20 s … capped at 30 min, with jitter.
export function defaultBackoffMs(attempt: number): number {
  const base = Math.min(5_000 * 2 ** (attempt - 1), 30 * 60_000);
  return Math.round(base / 2 + Math.random() * (base / 2));
}

export function createOutboxDispatcher(options: OutboxDispatcherOptions) {
  const batch = options.batch ?? 100;
  const maxAttempts = options.maxAttempts ?? 10;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const backoff = options.backoffMs ?? defaultBackoffMs;
  const retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60_000;
  let lastPrune = 0;

  const durable = () => options.subscriptions().filter((sub) => sub.durable);

  return {
    async tick(): Promise<DispatchReport> {
      const subs = durable();
      const report: DispatchReport = { fannedOut: 0, delivered: 0, retried: 0, failed: 0 };
      report.fannedOut = await options.store.fanOut(
        (event) =>
          subs
            .filter((sub) =>
              sub.patterns.some((pattern) => matchesEventPattern(pattern, event.type)),
            )
            .map((sub) => sub.id),
        batch,
      );
      const byId = new Map(subs.map((sub) => [sub.id, sub]));
      const claimed = subs.length
        ? await options.store.claim([...byId.keys()], batch, leaseMs)
        : [];
      for (const delivery of claimed) {
        const sub = byId.get(delivery.consumer);
        if (!sub) continue;
        try {
          await sub.handler(delivery.event);
          await options.store.complete(delivery.deliveryId);
          report.delivered++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (delivery.attempt >= maxAttempts) {
            await options.store.fail(delivery.deliveryId, message);
            report.failed++;
            options.log.error(`event consumer ${sub.id} gave up on ${delivery.event.type}`, {
              eventId: delivery.event.id,
              error: message,
            });
          } else {
            await options.store.retry(
              delivery.deliveryId,
              new Date(Date.now() + backoff(delivery.attempt)),
              message,
            );
            report.retried++;
          }
        }
      }
      if (Date.now() - lastPrune > 60 * 60_000) {
        lastPrune = Date.now();
        await options.store.prune(new Date(Date.now() - retentionMs));
      }
      return report;
    },
  };
}

// The store and dispatcher as an EventTransport: append() writes to the store, start()
// polls it every `pollMs` until stopped.
export function createOutboxTransport(
  options: Omit<OutboxDispatcherOptions, 'subscriptions'> & { pollMs?: number },
): EventTransport {
  return {
    append: (events, tx) => options.store.append(events, tx),
    async start(subscriptions) {
      const dispatcher = createOutboxDispatcher({ ...options, subscriptions });
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const loop = async (): Promise<void> => {
        if (stopped) return;
        try {
          await dispatcher.tick();
        } catch (error) {
          options.log.error(`event dispatch failed: ${String(error)}`);
        }
        if (!stopped) timer = setTimeout(loop, options.pollMs ?? 1000);
      };
      void loop();
      return {
        async stop() {
          stopped = true;
          if (timer) clearTimeout(timer);
        },
      };
    },
  };
}
