import { startWorker } from './worker';
import { startHubInboxWorker } from './hub-inbox-worker';
import { startHubInboxWakeServer } from './hub-inbox-wake';

// Entry point for the delivery workers. The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();
const hubInboxWorker = startHubInboxWorker();
const hubInboxWakeServer = startHubInboxWakeServer();

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  hubInboxWorker.stop();
  hubInboxWakeServer.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
