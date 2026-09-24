import { startVaultWatcher } from '@repo/vault';
import { startWorker } from './worker';
import { startHubInboxWorker } from './hub-inbox-worker';
import { startMailWorker } from './mail/worker';
import { startLoop } from '@helena/loop';
import { workerEventTransport } from './engine-delivery';
import { startKnowledgeIndexer } from './knowledge-indexer';
import { startEventDelivery } from './events';

// Entry point for the delivery workers. The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();
const hubInboxWorker = startHubInboxWorker();
const mailWorker = startMailWorker();
// The plugins whose durable event subscribers the worker serves.
const eventDelivery = await startEventDelivery();
// The engine's queue carries the events to those subscribers (decision D-C2); tried again
// while the database does not answer. HELENA_ENGINE=off leaves the worker without it.
if (process.env.HELENA_ENGINE?.trim().toLowerCase() !== 'off') {
  const connect = startLoop(
    'event-delivery',
    async () => {
      await eventDelivery.useTransport(workerEventTransport);
      connect.stop();
      console.log('[worker] event delivery running');
    },
    () => 15_000,
  );
}
// Only a worker pointed at a vault explicitly watches one: the watcher indexes it and
// commits outside changes to its history.
const vaultWatcher = process.env.PROJECT_VAULT_ROOT?.trim() ? startVaultWatcher() : null;
// The second brain's index over every knowledge source (Helena's and plugins', from the
// worker's plugin host), and the note templates.
const knowledgeIndexer = await startKnowledgeIndexer({
  vault: vaultWatcher !== null,
  host: eventDelivery.host,
});

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  hubInboxWorker.stop();
  mailWorker.stop();
  eventDelivery.stop();
  vaultWatcher?.stop();
  knowledgeIndexer.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
