import { AlertTriangle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { WidgetConfig } from '@/utils/dashboardWidgets';
import { Skeleton } from '@/components/ui/skeleton';
import { useWebhookStatsQuery } from '../../services/analytics.service';
import { Stack, Text } from '@/design-system';

// Webhook delivery health over a window: the delivered total as the headline figure,
// with the failed and pending counts, plus a warning when subscriptions have been
// auto-disabled by the worker (a dead endpoint). The window is configured from the
// header popover.
export default function WebhookHealthWidget({
  projectKey,
  config,
}: {
  projectKey: string;
  config: WidgetConfig;
}) {
  const t = useTranslations('dashboards');
  const days = config.days ?? 30;
  const { data, isLoading } = useWebhookStatsQuery(projectKey, days);

  if (isLoading || !data) return <Skeleton className="h-10 w-20" />;

  return (
    <Stack gap={2}>
      <Text as="p" size="xs" tone="muted">
        {t('lastDays', { days })}
      </Text>
      <div className="text-3xl font-semibold tabular-nums">{data.total}</div>
      <Text as="p" size="xs" tone="muted">
        {t('webhookHealth.deliveries')}
      </Text>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {data.failed > 0 && (
          <span className="text-destructive">
            {t('webhookHealth.failed', { count: data.failed })}
          </span>
        )}
        {data.pending > 0 && <span>{t('webhookHealth.pending', { count: data.pending })}</span>}
        {data.failed === 0 && data.pending === 0 && <span>{t('webhookHealth.allDelivered')}</span>}
      </div>
      {data.disabledWebhooks > 0 && (
        <Text as="p" size="xs" tone="danger" className="flex items-center gap-1">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t('webhookHealth.disabled', { count: data.disabledWebhooks })}
        </Text>
      )}
    </Stack>
  );
}
