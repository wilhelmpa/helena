import { useTranslations } from 'next-intl';
import type { ActionDef } from '@/lib/api/endpoints/actions';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { SettingsActionRow } from './SettingsActionRow';
import { Table, Th, Tr, Card } from '@/design-system';

interface SettingsActionsTableProps {
  actions: ActionDef[];
  project: ProjectDetail;
  customFields: CustomField[];
  onEdit: (actionId: number) => void;
  onDuplicate: (action: ActionDef) => void;
  onDelete: (action: ActionDef) => void;
  onToggle: (action: ActionDef, enabled: boolean) => void;
}

export function SettingsActionsTable({
  actions,
  project,
  customFields,
  onEdit,
  onDuplicate,
  onDelete,
  onToggle,
}: SettingsActionsTableProps) {
  const t = useTranslations('settings.actions');
  const tCommon = useTranslations('common');

  return (
    <Card pad="none" className="overflow-hidden">
      <Table stack={false} className="min-w-[680px] table-fixed">
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[42%]" />
          <col className="w-[14%]" />
        </colgroup>
        <thead>
          <Tr className="hover:bg-transparent">
            <Th>{t('columns.action')}</Th>
            <Th>{t('columns.thenSet')}</Th>
            <Th alignment="end">{tCommon('actions')}</Th>
          </Tr>
        </thead>
        <tbody>
          {actions.map((action) => (
            <SettingsActionRow
              key={action.id}
              action={action}
              project={project}
              customFields={customFields}
              onEdit={() => onEdit(action.id)}
              onDuplicate={() => onDuplicate(action)}
              onDelete={() => onDelete(action)}
              onToggle={(enabled) => onToggle(action, enabled)}
            />
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
