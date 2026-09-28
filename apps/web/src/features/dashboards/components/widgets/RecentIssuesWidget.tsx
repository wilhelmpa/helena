import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { issuePath } from '@/utils/paths';
import { formatShortDate } from '@/utils/dates';
import { usePriorityLabel } from '@/hooks/usePriorityLabel';
import { EMPTY_FILTER_SET, applyFilters, isActiveFilterSet, type FilterSet } from '@/utils/filters';
import type { WidgetConfig } from '@/utils/dashboardWidgets';
import { Skeleton } from '@/components/ui/skeleton';
import { Stack, Text } from '@/design-system';

// Recent issues filtered by the same board filter set (status, assignee, priority,
// labels, dates, custom fields) and sorted by created or updated time. Both the
// filter and the sort are configured settings (edited from the header settings
// popover, see RecentIssuesWidgetSettings) — the view is static. Filtering runs
// client-side over the project's already-loaded issues, so it stays in sync with
// the board.
export default function RecentIssuesWidget({
  projectKey,
  config,
}: {
  projectKey: string;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards.recentIssues');
  const priorityLabel = usePriorityLabel();
  const { project } = useShell();
  const sort = config.sort ?? 'created';
  const limit = config.limit ?? 10;
  const filters: FilterSet = config.filters ?? EMPTY_FILTER_SET;

  const issues = useMemo(() => {
    if (!project) return [];
    const filtered = applyFilters(project.issues, filters, project);
    const sorted = [...filtered].sort((a, b) =>
      sort === 'updated'
        ? b.updatedAt.localeCompare(a.updatedAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
    return sorted.slice(0, limit);
  }, [project, filters, sort, limit]);

  const columnById = useMemo(
    () => new Map((project?.columns ?? []).map((c) => [c.id, c])),
    [project],
  );

  if (!project) return <Skeleton className="h-40 w-full" />;

  const caption = [
    sort === 'updated' ? t('captionUpdated') : t('captionCreated'),
    isActiveFilterSet(filters) ? t('filterCount', { count: filters.conditions.length }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Stack gap={3}>
      <Text as="p" size="xs" tone="muted">
        {caption}
      </Text>

      {issues.length === 0 ? (
        <Text as="p" size="sm" tone="muted" className="py-4 text-center">
          {t('empty')}
        </Text>
      ) : (
        <Stack as="ul" gap={1}>
          {issues.map((issue) => {
            const column = columnById.get(issue.columnId);
            return (
              <li key={issue.id}>
                <Link
                  href={issuePath(projectKey, issue.sequenceNumber)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: column?.color ?? 'var(--dashboard-label)' }}
                    title={column?.name}
                  />
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {issue.identifier}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                  {issue.priority && (
                    <Text as="span" size="xs" tone="muted" className="shrink-0">
                      {priorityLabel(issue.priority)}
                    </Text>
                  )}
                  <Text as="span" size="xs" tone="muted" className="shrink-0">
                    {formatShortDate(sort === 'updated' ? issue.updatedAt : issue.createdAt)}
                  </Text>
                </Link>
              </li>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
