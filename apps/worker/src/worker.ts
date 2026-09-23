import { workerConfig } from './config';
import { deliver } from './delivery';
import { processNotificationDeliveries } from './notification-delivery';
import { equalJitterBackoffMs } from './backoff';
import { startPollLoop, type WorkerHandle } from './poll-loop';
import { TELEMETRY_CHECK_EVERY_TICKS, processTelemetry } from './telemetry';
import {
  processProjectProvisioning,
  pruneFinishedDeprovisioningJobs,
} from './project-provisioning';
import { reconcileProjectProvisioning } from './project-reconciliation';
import {
  type ClaimedDelivery,
  claimDueDeliveries,
  markSuccess,
  scheduleRetry,
  markFailed,
  markSkippedInactive,
  cleanupOldDeliveries,
} from './store';

let ticksSinceCleanup = 0;
// Starts due, so an install is visible even if the instance is removed minutes later.
let ticksSinceTelemetry = TELEMETRY_CHECK_EVERY_TICKS;
let lastProjectReconcileAt = 0;

export function startWorker(): WorkerHandle {
  return startPollLoop('worker', tick, () => workerConfig().pollIntervalMs);
}

// One poll: claim a batch of due deliveries, send them concurrently, record each
// outcome, then run the project reconciliation, the cleanup and the telemetry check
// on their own intervals.
async function tick(): Promise<void> {
  const cfg = workerConfig();
  const claimed = await claimDueDeliveries();
  if (claimed.length > 0) {
    await Promise.all(claimed.map(processDelivery));
  }
  await processNotificationDeliveries();
  await processProjectProvisioning();
  if (Date.now() - lastProjectReconcileAt >= cfg.projectReconcileIntervalMs) {
    lastProjectReconcileAt = Date.now();
    // An unreachable integration service must not read as a failed tick.
    try {
      await reconcileProjectProvisioning();
    } catch (error) {
      console.error('[worker] project reconciliation failed:', error);
    }
  }
  if (++ticksSinceCleanup >= cfg.cleanupEveryTicks) {
    ticksSinceCleanup = 0;
    const removed = await cleanupOldDeliveries();
    if (removed > 0) console.log(`[worker] cleaned up ${removed} old deliveries`);
    const cleanups = await pruneFinishedDeprovisioningJobs();
    if (cleanups > 0) console.log(`[worker] pruned ${cleanups} finished project cleanups`);
  }
  if (++ticksSinceTelemetry >= TELEMETRY_CHECK_EVERY_TICKS) {
    ticksSinceTelemetry = 0;
    // An unreachable collector must not read as a failed tick.
    try {
      await processTelemetry();
    } catch (error) {
      console.error('[worker] telemetry send failed:', error);
    }
  }
}

async function processDelivery(d: ClaimedDelivery): Promise<void> {
  const cfg = workerConfig();
  if (!d.isActive) {
    await markSkippedInactive(d.id);
    return;
  }
  const body = JSON.stringify(d.payload);
  const result = await deliver({
    url: d.url,
    secret: d.secret,
    deliveryId: d.id,
    eventId: d.eventId,
    eventType: d.eventType,
    body,
    timeoutMs: cfg.timeoutMs,
  });
  const response = { status: result.status, body: result.responseBody };
  if (result.ok) {
    await markSuccess(d.id, d.webhookId, response);
    return;
  }
  if (result.retryable && d.attempts < cfg.maxAttempts) {
    await scheduleRetry(
      d.id,
      d.webhookId,
      equalJitterBackoffMs(d.attempts),
      result.error ?? 'delivery failed',
      response,
    );
    return;
  }
  await markFailed(d.id, d.webhookId, result.error ?? 'delivery failed', response);
}
