import type { NotificationCategory } from '@helena/sdk';
import { registries } from '#shared/helena';

// Helena's own push categories (docs/helena-decisions/push.md). Their labels are the web's
// (account.notifications.categories.<id>). Emergencies and approvals ring even on a phone
// that dozes (urgency high); the rest waits for the next wake-up.
const label = (id: string, part: 'label' | 'description') => ({
  i18n: `account.notifications.categories.${id}.${part}`,
});

export const BUILTIN_CATEGORIES: NotificationCategory[] = [
  {
    id: 'emergencies',
    label: label('emergencies', 'label'),
    description: label('emergencies', 'description'),
    defaultOn: true,
    audience: 'owner',
    order: 10,
    urgency: 'high',
    ttlSeconds: 86_400,
  },
  {
    id: 'approvals',
    label: label('approvals', 'label'),
    description: label('approvals', 'description'),
    defaultOn: true,
    audience: 'everyone',
    order: 20,
    urgency: 'high',
    ttlSeconds: 86_400,
  },
  {
    id: 'needs-you',
    label: label('needs-you', 'label'),
    description: label('needs-you', 'description'),
    defaultOn: false,
    audience: 'owner',
    order: 30,
    urgency: 'normal',
    ttlSeconds: 43_200,
  },
  {
    id: 'agent-replies',
    label: label('agent-replies', 'label'),
    description: label('agent-replies', 'description'),
    defaultOn: false,
    audience: 'everyone',
    order: 40,
    urgency: 'normal',
    ttlSeconds: 3_600,
  },
];

// Every category registered (Helena's and plugins'), in the settings page's order.
export function notificationCategories(): (NotificationCategory & { pluginId: string })[] {
  return registries.notificationCategories
    .entriesList()
    .map((entry) => ({ ...entry.value, pluginId: entry.pluginId }))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id));
}

export function notificationCategory(id: string): NotificationCategory | undefined {
  return registries.notificationCategories.get(id);
}

// The categories a person may switch on: an owner-only one is not offered to others.
export function categoriesFor(owner: boolean): NotificationCategory[] {
  return notificationCategories().filter((category) => owner || category.audience !== 'owner');
}
