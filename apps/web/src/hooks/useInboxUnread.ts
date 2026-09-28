import { useQuery } from '@tanstack/react-query';
import { getUnreadCount } from '@/lib/api/endpoints/notifications';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import { useLiveRefresh } from './useLiveRefresh';

// Unread notifications in one project, or across Home when both arguments are null.
// Project counts refresh through the inbox revision scope; mutations invalidate Home.
export function useInboxUnread(projectKey: string | null, projectId: number | null) {
  useLiveRefresh({
    scope: projectId != null ? revScope.inbox(projectId) : null,
    targets: [qk.notificationsUnread(projectKey ?? 'global')],
  });
  return useQuery({
    queryKey: qk.notificationsUnread(projectKey ?? 'global'),
    queryFn: () => getUnreadCount(projectId),
    enabled: projectKey == null || projectId != null,
    select: (d) => d.unread,
  });
}
