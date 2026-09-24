import type { Logger } from '../common';
import { matchesEventPattern, type EventSubscription, type HelenaEvent } from '../events';

// The transactional outbox behind durable event subscribers. A change and its event are
// written in one transaction (the event row is the outbox); the worker's dispatcher then
// fans each new event out to the durable subscribers whose patterns match, one delivery
// per subscriber, and runs them with retries. A failing subscriber delays only itself.
//
// The store is an interface so the dispatcher does not care how it is kept: Helena's is
// two Postgres tables (packages/db), claimed with FOR UPDATE SKIP LOCKED.

export interface OutboxDelivery {
  deliveryId: number;
  consumer: string;
  // 1 on the first attempt.
  attempt: number;
  event: HelenaEvent;
}

export interface OutboxStore {
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
