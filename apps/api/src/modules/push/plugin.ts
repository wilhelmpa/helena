import type { HelenaPlugin } from '@helena/sdk';
import { BUILTIN_CATEGORIES } from './categories';
import { PUSH_EVENT_PATTERNS, onPushEvent } from './fanout';
import { BUILTIN_ALERT_SOURCES } from './sources';

// Push as an internal plugin (docs/helena-decisions/push.md): Helena's own notification
// categories, the alert sources the api watches, and the subscriber that queues a push for
// an approval, a chat answer or a failed run. It runs in the api, in process right after
// the event: it only queues, and the queue itself retries.
export const PUSH_PLUGIN_ID = 'helena.push';

export const PUSH_PROVIDES = {
  notificationCategories: BUILTIN_CATEGORIES.map((category) => category.id),
  alertSources: BUILTIN_ALERT_SOURCES.map((source) => source.id),
};

export const PUSH_PERMISSIONS = { events: [...PUSH_EVENT_PATTERNS] };

export const pushPlugin: HelenaPlugin = {
  register(ctx) {
    for (const category of BUILTIN_CATEGORIES) ctx.notificationCategories.register(category);
    for (const source of BUILTIN_ALERT_SOURCES) ctx.alertSources.register(source);
    ctx.events.subscribe([...PUSH_EVENT_PATTERNS], onPushEvent, { id: 'fanout', durable: false });
  },
};
