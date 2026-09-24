import { useTranslations } from 'next-intl';
import type { Webhook } from '@/lib/api/endpoints/webhooks';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SettingsWebhookRow } from './SettingsWebhookRow';

interface SettingsWebhooksTableProps {
  webhooks: Webhook[];
  onShowDeliveries: (webhook: Webhook) => void;
  onEdit: (webhookId: number) => void;
  onDelete: (webhook: Webhook) => void;
}

export function SettingsWebhooksTable({
  webhooks,
  onShowDeliveries,
  onEdit,
  onDelete,
}: SettingsWebhooksTableProps) {
  const t = useTranslations('settings.webhooks');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className="min-w-[820px] table-fixed">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[46%]" />
          <col className="w-[14%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-xs font-normal text-muted-foreground">
              {t('columns.endpoint')}
            </TableHead>
            <TableHead className="px-3 text-xs font-normal text-muted-foreground">
              {t('columns.events')}
            </TableHead>
            <TableHead className="px-3 text-end text-xs font-normal text-muted-foreground">
              {tCommon('actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {webhooks.map((webhook) => (
            <SettingsWebhookRow
              key={webhook.id}
              webhook={webhook}
              onShowDeliveries={() => onShowDeliveries(webhook)}
              onEdit={() => onEdit(webhook.id)}
              onDelete={() => onDelete(webhook)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
