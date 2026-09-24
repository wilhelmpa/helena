import { createEvent } from '@helena/sdk';
import { enqueueEngineEvents } from '@repo/db';

// Hands a domain event of the worker to the Helena engine: stored as the engine's workflow
// for every process that serves it (@repo/db enqueueEngineEvents), under the event's id, so
// an event stored twice is handled once. The api's engine then starts the workflows whose
// trigger listens to it; the worker's own delivery hands it to the plugins' subscribers.

export interface WorkerEvent {
  id: string;
  type: string;
  subject?: string;
  projectId: number;
  time: Date;
  data: Record<string, unknown>;
}

export async function publishEngineEvent(event: WorkerEvent): Promise<void> {
  try {
    await enqueueEngineEvents([
      createEvent({
        id: event.id,
        type: event.type,
        data: event.data,
        projectId: event.projectId,
        time: event.time,
        ...(event.subject ? { subject: event.subject } : {}),
        actor: 'system',
      }),
    ]);
  } catch (error) {
    console.error(`[worker] event ${event.type} not handed to the engine:`, error);
  }
}
