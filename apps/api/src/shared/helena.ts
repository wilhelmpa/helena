import {
  createEvent,
  createEventBus,
  createRegistries,
  type CoreEventData,
  type CoreEventType,
  type EventInit,
  type HelenaEvent,
} from '@helena/sdk';
import { PluginHost } from '@helena/sdk/server';
import { appendDomainEvents, db } from '@repo/db';

// The API process's side of the framework (@helena/sdk, docs/helena-framework.md): its
// registries, its plugin host, and publishing domain events. Built-in features register
// here as internal plugins (modules/plugins/builtin.ts); external plugins are loaded at
// start when the Administrator switched them on (modules/plugins/service.ts).

export const registries = createRegistries();

// In-process subscribers only: durable ones run in the worker, off the outbox.
export const events = createEventBus();

export const host = new PluginHost({ process: 'api', events, registries });

type Executor = Parameters<typeof appendDomainEvents>[1];

// Records a domain event in the outbox, inside `tx` when the change has one, and tells
// the API's in-process subscribers. Never throws for a subscriber; a failing insert
// throws like any other write of the change.
export async function publishDomainEvent<T extends CoreEventType>(
  init: EventInit<T, CoreEventData[T]>,
  tx?: Executor,
): Promise<HelenaEvent> {
  const event = createEvent(init as EventInit) as HelenaEvent;
  await appendDomainEvents([event], tx ?? db);
  await events.publish(event);
  return event;
}
