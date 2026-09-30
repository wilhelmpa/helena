import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Webhook, WebhookDelivery } from '@/lib/api/endpoints/webhooks';
import { formatDateTime } from '@/utils/dates';
import { useWebhookDeliveries } from '@/services/webhooks.service';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { JsonViewer } from './JsonViewer';

import { Overlay, Text, Box, Stack } from '@/design-system';

// Delivery history for a webhook, in the one overlay on the right. Paged through
// useWebhookDeliveries, which owns the page size; each delivery expands to show the
// payload we sent and the response we got back.
export function SettingsWebhookDeliveriesSheet({
  webhook,
  onClose,
}: {
  webhook: Webhook | null;
  onClose: () => void;
}) {
  const t = useTranslations('settings.webhooks');

  if (!webhook) return null;
  return (
    <Overlay
      label={t('deliveryHistory')}
      tabs={[{ id: 'deliveries', label: t('deliveryHistory') }]}
      onClose={onClose}
      bodyClassName="is-flush"
    >
      <Text as="p" size="xs" tone="muted" className="truncate px-6 py-3 font-mono">
        {webhook.url}
      </Text>
      <DeliveriesList webhookId={webhook.id} />
    </Overlay>
  );
}

function DeliveriesList({ webhookId }: { webhookId: number }) {
  const t = useTranslations('settings.webhooks');
  const tCommon = useTranslations('common');
  const query = useWebhookDeliveries(webhookId);
  const deliveries = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isLoading) {
    return <ListSkeleton rows={4} className="p-4" rowClassName="h-12" />;
  }
  if (deliveries.length === 0) {
    return (
      <Box as="p" pad={4}>
        <Text as="span" size="sm" tone="muted">
          {t('noDeliveries')}
        </Text>
      </Box>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="divide-y divide-border/50">
        {deliveries.map((d) => (
          <DeliveryItem key={d.id} delivery={d} />
        ))}
      </div>
      <Box pad={4}>
        {query.hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? tCommon('loading') : t('loadMore')}
          </Button>
        ) : (
          <Text as="p" size="xs" tone="muted" className="text-center">
            {t('endOfHistory')}
          </Text>
        )}
      </Box>
    </div>
  );
}

function DeliveryItem({ delivery: d }: { delivery: WebhookDelivery }) {
  const t = useTranslations('settings.webhooks');
  const [open, setOpen] = useState(false);
  // What came back: the response status, the error, or that it is still queued.
  const outcome =
    d.responseStatus != null
      ? `HTTP ${d.responseStatus}`
      : (d.lastError ?? (d.status === 'pending' ? t('queued') : ''));
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs hover:bg-accent/50"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <StatusBadge status={d.status} />
        <span className="font-mono">{d.eventType}</span>
        {d.attempts > 1 && (
          <Text as="span" tone="muted">
            {t('attempts', { count: d.attempts })}
          </Text>
        )}
        <Text as="span" tone="muted" className="truncate">
          {outcome}
        </Text>
        <Text as="span" tone="muted" className="ml-auto shrink-0">
          {formatDateTime(d.createdAt)}
        </Text>
      </button>
      {open && (
        <Stack gap={3} padX={4} padBottom={3}>
          <DetailBlock label={t('sent')} value={d.payload} />
          <DetailBlock
            label={
              d.responseStatus != null
                ? t('responseWithStatus', { status: d.responseStatus })
                : t('response')
            }
            value={d.responseBody ?? d.lastError}
          />
        </Stack>
      )}
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  const t = useTranslations('settings.webhooks');
  return (
    <Stack gap={1}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {value == null || value === '' ? (
        <Text as="p" size="xs" tone="muted">
          {t('noResponse')}
        </Text>
      ) : (
        <JsonViewer value={value} />
      )}
    </Stack>
  );
}

const STATUS_VARIANT: Record<WebhookDelivery['status'], 'secondary' | 'destructive' | 'outline'> = {
  success: 'secondary',
  failed: 'destructive',
  pending: 'outline',
};

function StatusBadge({ status }: { status: WebhookDelivery['status'] }) {
  const t = useTranslations('settings.webhooks');
  return (
    <Badge variant={STATUS_VARIANT[status]} className="shrink-0">
      {t(`statuses.${status}`)}
    </Badge>
  );
}
