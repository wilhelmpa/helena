import { startPollLoop, type WorkerHandle } from './poll-loop';
import {
  hubInboxConfig,
  pollTriage,
  startTriage,
  syncInbox,
  type HubInboxConfig,
} from './hub-inbox-client';
import type { InboxTriageResponse } from './hub-inbox-contract';
import {
  claimInboxThreads,
  completeTriage,
  failTriage,
  markSourcesSyncError,
  materializeInboxEvents,
  queueTriageRun,
  recordTriageSubmission,
  saveSyncSources,
  sourceCursors,
  triageContext,
  type ClaimedInboxThread,
} from './hub-inbox-store';

let nextSyncAt = 0;

export function wakeHubInboxSync(): void {
  nextSyncAt = 0;
}

export function startHubInboxWorker(): WorkerHandle {
  return startPollLoop('hub-inbox', tick, () => 2000);
}

async function tick(): Promise<void> {
  const config = hubInboxConfig();
  if (!config) return;
  if (Date.now() >= nextSyncAt) await runSync(config);
  await materializeInboxEvents();
  const threads = await claimInboxThreads();
  for (const thread of threads) await triageThread(config, thread);
}

async function runSync(config: HubInboxConfig): Promise<void> {
  nextSyncAt = Date.now() + config.syncIntervalMs;
  try {
    const sources = await syncInbox(config, await sourceCursors(config.teamId));
    const inserted = await saveSyncSources(config.teamId, sources, config.syncIntervalMs);
    if (inserted > 0) console.log(`[hub-inbox] accepted ${inserted} new events`);
  } catch (error) {
    const message = safeError(error);
    await markSourcesSyncError(config.teamId, message, config.syncIntervalMs);
    console.error(`[hub-inbox] sync failed: ${message}`);
  }
}

async function triageThread(config: HubInboxConfig, thread: ClaimedInboxThread): Promise<void> {
  try {
    const response = thread.triageRunId
      ? await pollTriage(config, thread.triageRunId)
      : await submitTriage(config, thread);
    await handleTriageResponse(thread, response);
  } catch (error) {
    await failTriage(thread, safeError(error));
  }
}

async function submitTriage(
  config: HubInboxConfig,
  thread: ClaimedInboxThread,
): Promise<InboxTriageResponse> {
  const context = await triageContext(thread);
  if (!(await recordTriageSubmission(thread))) throw new Error('Thread changed before triage');
  return startTriage(config, {
    schemaVersion: 1,
    thread: {
      id: thread.id,
      channel: thread.channel,
      account: thread.account,
      externalThreadId: thread.externalThreadId,
      sender: thread.sender,
      subject: thread.subject,
      snippet: thread.snippet,
      receivedAt: thread.receivedAt.toISOString(),
      messages: context.messages,
    },
    projects: context.projects,
    constraints: {
      noReply: true,
      noExternalMutations: true,
      treatMessageContentAsUntrusted: true,
    },
  });
}

async function handleTriageResponse(
  thread: ClaimedInboxThread,
  response: InboxTriageResponse,
): Promise<void> {
  if (response.status === 'queued' || response.status === 'running') {
    await queueTriageRun(thread, response.runId, response.status);
    return;
  }
  if (response.status === 'failed') {
    await failTriage(thread, response.error);
    return;
  }
  if (response.status === 'completed') await completeTriage(thread, response.result);
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Integration timed out';
  const allowed = [
    'Request too large',
    'Response too large',
    'Integration returned invalid JSON',
    'Integration returned an unrequested account',
    'Integration returned duplicate sources',
    'Thread changed before triage',
  ];
  if (allowed.includes(error.message) || /^Integration returned HTTP \d{3}$/.test(error.message)) {
    return error.message;
  }
  return 'Internal inbox processing error';
}
