'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Notification, NotificationType } from '@/lib/api/endpoints/notifications';
import { cn } from '@/lib/utils';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { revScope } from '@/utils/revScopes';
import { useIsMobile } from '@/hooks/use-mobile';
import InboxToolbar from './InboxToolbar';
import InboxList from './InboxList';
import InboxDetail from './InboxDetail';
import { useInboxFilters } from '../hooks/useInboxFilters';
import {
  useNotificationsQuery,
  useSetNotificationRead,
  useSnoozeNotification,
  useDeleteNotification,
} from '../services/notifications.service';

const READING_TYPES: NotificationType[] = ['assigned', 'commented', 'state_changed'];

// The project's notifications: the list beside the task a notification is about. Its
// controls are the page's header row (InboxToolbar), after the page's tabs (`leading`).
export default function InboxView({
  project,
  leading,
}: {
  project: ProjectDetail;
  leading?: ReactNode;
}) {
  const t = useTranslations('inbox');
  const projectKey = project.project.key;
  const projectId = project.project.id;

  const { filters, changeFilters } = useInboxFilters(projectKey);
  const [selected, setSelected] = useState<Notification | null>(null);
  const isMobile = useIsMobile();

  const selectedTypes = filters.types?.filter((type) => READING_TYPES.includes(type));
  const query = useNotificationsQuery(projectKey, projectId, {
    ...filters,
    types: selectedTypes?.length ? selectedTypes : READING_TYPES,
  });
  const setRead = useSetNotificationRead(projectKey);
  const snooze = useSnoozeNotification(projectKey);
  const deleteOne = useDeleteNotification(projectKey);

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  // The unread count refreshes itself through useInboxUnread; this covers the list.
  useLiveRefresh({
    scope: revScope.inbox(projectId),
    targets: [['notifications', projectKey]],
  });

  const onSelect = (n: Notification) => {
    setSelected(n);
    if (n.readAt == null) setRead.mutate({ id: n.id, read: true });
  };

  const onDelete = (n: Notification) => {
    if (selected?.id === n.id) setSelected(null);
    deleteOne.mutate(n.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <InboxToolbar
        leading={leading}
        filters={{ ...filters, types: selectedTypes?.length ? selectedTypes : undefined }}
        onFiltersChange={changeFilters}
      />
      <div
        className={cn(
          'flex w-full min-w-0 flex-col bg-card md:max-w-sm md:border-e',
          selected && 'hidden md:flex',
        )}
      >
        <InboxList
          items={items}
          isLoading={query.isLoading}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onToggleRead={(n, read) => setRead.mutate({ id: n.id, read })}
          onSnooze={(n, until) => snooze.mutate({ id: n.id, until })}
          onDelete={onDelete}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      {selected ? (
        <InboxDetail
          key={selected.issueId}
          project={project}
          issueId={selected.issueId}
          issueSeq={selected.issueSeq}
          isMobile={isMobile}
          onBack={() => setSelected(null)}
          onDeleted={() => setSelected(null)}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-muted-foreground md:flex">
          {t('selectNotification')}
        </div>
      )}
    </div>
  );
}
