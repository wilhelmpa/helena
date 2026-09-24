import { DBOSClient } from '@dbos-inc/dbos-sdk';

// Hands a domain event to the Helena engine from the worker, which does not run the
// engine: the event is enqueued as the engine's `helena.event` workflow on its outbox
// queue, under the event's id, so an event enqueued twice is handled once. The api's
// engine then runs its subscribers (the workflows whose trigger listens to it).

export interface WorkerEvent {
  id: string;
  type: string;
  source: string;
  subject?: string;
  projectId: number;
  time: Date;
  data: Record<string, unknown>;
}

let client: Promise<DBOSClient> | null = null;

function engineClient(): Promise<DBOSClient> {
  client ??= DBOSClient.create({
    systemDatabaseUrl:
      process.env.HELENA_ENGINE_DATABASE_URL?.trim() || process.env.DATABASE_URL!.trim(),
    systemDatabaseSchemaName: process.env.HELENA_ENGINE_SCHEMA?.trim() || 'helena_engine',
    applicationName: 'helena',
  }).catch((error: unknown) => {
    client = null;
    throw error;
  });
  return client;
}

export async function publishEngineEvent(event: WorkerEvent): Promise<void> {
  try {
    await (
      await engineClient()
    ).enqueue(
      { workflowName: 'helena.event', queueName: 'helena-events', workflowID: `event:${event.id}` },
      {
        specversion: '1.0',
        id: event.id,
        source: event.source,
        type: event.type,
        ...(event.subject ? { subject: event.subject } : {}),
        time: event.time.toISOString(),
        helenaproject: event.projectId,
        data: event.data,
      },
    );
  } catch (error) {
    console.error(`[worker] event ${event.type} not handed to the engine:`, error);
  }
}
