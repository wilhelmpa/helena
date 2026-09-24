import { startVaultWatcher } from '@repo/vault';
import { startWorker } from './worker';
import { startHubInboxWorker } from './hub-inbox-worker';
import { startMailWorker } from './mail/worker';
import { startEventDispatcher } from './events';

// Entry point for the delivery workers. The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();
const hubInboxWorker = startHubInboxWorker();
const mailWorker = startMailWorker();
// Domain events (the outbox) to their durable consumers: webhooks and plugins.
const eventDispatcher = await startEventDispatcher();
// Only a worker pointed at a vault explicitly watches one: the watcher indexes it and
// commits outside changes to its history.
const vaultWatcher = process.env.PROJECT_VAULT_ROOT?.trim() ? startVaultWatcher() : null;

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  hubInboxWorker.stop();
  mailWorker.stop();
  eventDispatcher.stop();
  vaultWatcher?.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
