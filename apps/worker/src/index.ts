import { startVaultWatcher } from '@repo/vault';
import { startWorker } from './worker';
import { startHubInboxWorker } from './hub-inbox-worker';
import { startHubInboxWakeServer } from './hub-inbox-wake';

// Entry point for the delivery workers. The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();
const hubInboxWorker = startHubInboxWorker();
const hubInboxWakeServer = startHubInboxWakeServer();
// Only a worker pointed at a vault explicitly watches one: the watcher indexes it and
// commits outside changes to its history.
const vaultWatcher = process.env.PROJECT_VAULT_ROOT?.trim() ? startVaultWatcher() : null;

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  hubInboxWorker.stop();
  hubInboxWakeServer.stop();
  vaultWatcher?.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
