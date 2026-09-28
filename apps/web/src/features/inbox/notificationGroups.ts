import type { Notification } from '@/lib/api/endpoints/notifications';

export const NOTIFICATION_GROUP_ORDER = ['approvals', 'errors', 'mentions', 'system'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUP_ORDER)[number];

export function notificationGroup(item: Notification): NotificationGroup {
  if (item.type === 'approval_requested') return 'approvals';
  if (item.type === 'mentioned') return 'mentions';
  // Task changes and comments are system updates; agent errors use the errors group
  // when the notification API exposes them as a distinct event type.
  return 'system';
}

export function groupNotifications(items: Notification[], byProject: boolean) {
  const projects = new Map<string, { name: string; items: Notification[] }>();
  for (const item of items) {
    const key = byProject ? item.projectKey : '';
    if (!projects.has(key)) projects.set(key, { name: item.projectName, items: [] });
    projects.get(key)!.items.push(item);
  }
  return [...projects].map(([key, project]) => ({
    key,
    name: project.name,
    total: project.items.length,
    groups: NOTIFICATION_GROUP_ORDER.map((kind) => ({
      kind,
      items: project.items.filter((item) => notificationGroup(item) === kind),
    })).filter((group) => group.items.length > 0),
  }));
}
