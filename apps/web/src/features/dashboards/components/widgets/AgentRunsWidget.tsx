import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/utils/dates';
import { issuePath } from '@/utils/paths';
import type { AgentRunFeedItem } from '@/lib/api/endpoints/analytics';
import type { WidgetConfig } from '@/utils/dashboardWidgets';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentRunsQuery } from '../../services/analytics.service';
import { Inline, Stack, Text } from '@/design-system';

// The run statuses the feed can be narrowed to. Their labels are messages under
// `dashboards.agentRuns.filters`.
export const STATUS_FILTER = ['all', 'failed', 'pending', 'success'] as const;

function statusVariant(status: AgentRunFeedItem['status']) {
  switch (status) {
    case 'success':
      return 'secondary';
    case 'failed':
      return 'destructive';
    default:
      return 'outline';
  }
}

// Project-wide feed of AI agent runs, newest first, optionally narrowed to one
// status. Issue-triggered rows link to the issue; scheduled rows show their
// trigger. A failed run shows its error.
export default function AgentRunsWidget({
  projectKey,
  config,
}: {
  projectKey: string;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards.agentRuns');
  const status = config.runStatus ?? null;
  const limit = config.limit ?? 20;
  const { data, isLoading } = useAgentRunsQuery(projectKey, { status, limit });
  const items = data ?? [];

  const caption = t(`filters.${STATUS_FILTER.find((o) => o === (status ?? 'all')) ?? 'all'}`);

  function feed() {
    if (isLoading) {
      return (
        <Stack gap={2}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </Stack>
      );
    }
    if (items.length === 0) {
      return (
        <Text as="p" size="sm" tone="muted" className="py-4 text-center">
          {t('empty')}
        </Text>
      );
    }
    return (
      <Stack as="ul" gap={2}>
        {items.map((r) => (
          <Inline as="li" gap={2} align="start" key={r.id} className="text-sm">
            <Badge variant={statusVariant(r.status)} className="mt-0.5 shrink-0">
              {t(`status.${r.status}`)}
            </Badge>
            <div className="min-w-0 flex-1">
              <span className="text-foreground/80">{r.agentName}</span>{' '}
              <span className="text-muted-foreground">{t(`trigger.${r.trigger}`)}</span>{' '}
              {r.issueId != null && r.issueSequence != null && (
                <Link href={issuePath(projectKey, r.issueSequence)} className="hover:underline">
                  {projectKey}-{r.issueSequence}
                </Link>
              )}
              <Text as="span" size="xs" tone="faint" className="ml-1">
                {formatDateTime(r.createdAt)}
              </Text>
              {r.status === 'failed' && r.lastError && (
                <Text as="p" size="xs" tone="danger" className="mt-0.5 truncate">
                  {r.lastError}
                </Text>
              )}
            </div>
          </Inline>
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={3}>
      <Text as="p" size="xs" tone="muted">
        {caption}
      </Text>
      {feed()}
    </Stack>
  );
}
