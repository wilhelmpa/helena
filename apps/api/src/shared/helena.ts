import {
  createEvent,
  createEventBus,
  createRegistries,
  type CoreEventData,
  type CoreEventType,
  type EventInit,
  type EventTransport,
  type HelenaEvent,
} from '@helena/sdk';
import { PluginHost } from '@helena/sdk/server';

// The API process's side of the framework (@helena/sdk, docs/helena-framework.md): its
// registries, its plugin host, and publishing domain events. Built-in features register
// here as internal plugins (modules/plugins/builtin.ts); external plugins are loaded at
// start when the Administrator switched them on (modules/plugins/service.ts).

export const registries = createRegistries();

// Domain events. Until the workflow engine hands the bus its transport
// (useEventTransport, hub/native-engine, decision D-C2), every subscriber (the webhook
// fan-out among them) runs in process right after the change, as side effects always did.
export const events = createEventBus();

export const host = new PluginHost({ process: 'api', events, registries });

// Called by the workflow engine at start: from then on events are stored with their change
// and durable subscribers are served in the worker.
export function useEventTransport(transport: EventTransport | null): void {
  events.useTransport(transport);
}

// Publishes a domain event (a CloudEvent). `tx` is the change's transaction, which a
// transport stores the event in; without a transport it is not needed. Never throws for
// a failing subscriber; a failing transport throws like any other write of the change.
export async function publishDomainEvent<T extends CoreEventType>(
  init: EventInit<T, CoreEventData[T]>,
  tx?: unknown,
): Promise<HelenaEvent> {
  const event = createEvent(init as EventInit) as HelenaEvent;
  await events.publish(event, { tx });
  return event;
}
