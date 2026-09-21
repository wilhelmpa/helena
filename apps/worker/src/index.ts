import { startWorker } from './worker';
import { startAgentWorker } from './agent-worker';
import { startHubInboxWorker } from './hub-inbox-worker';
import { startHubInboxWakeServer } from './hub-inbox-wake';

// Entry point for webhook delivery, agent scheduling, and autonomous agent runs.
// The api applies database migrations on startup.
console.log('[worker] worker starting');
const worker = startWorker();
const agentWorker = startAgentWorker();
const hubInboxWorker = startHubInboxWorker();
const hubInboxWakeServer = startHubInboxWakeServer();

function shutdown(signal: string): void {
  console.log(`[worker] ${signal} received, stopping`);
  worker.stop();
  agentWorker.stop();
  hubInboxWorker.stop();
  hubInboxWakeServer.stop();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
