import { useTranslations } from 'next-intl';
import type { Webhook } from '@/lib/api/endpoints/webhooks';
import { SettingsWebhookRow } from './SettingsWebhookRow';
import { Table, Th, Tr, Card } from '@/design-system';

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
    <Card pad="none" className="overflow-hidden">
      <Table stack={false} className="min-w-[820px] table-fixed">
        <colgroup>
          <col className="w-[40%]" />
          <col className="w-[46%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>{t('columns.endpoint')}</Th>
            <Th>{t('columns.events')}</Th>
            <Th alignment="end">{tCommon('actions')}</Th>
          </Tr>
        </thead>
        <tbody>
          {webhooks.map((webhook) => (
            <SettingsWebhookRow
              key={webhook.id}
              webhook={webhook}
              onShowDeliveries={() => onShowDeliveries(webhook)}
              onEdit={() => onEdit(webhook.id)}
              onDelete={() => onDelete(webhook)}
            />
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
