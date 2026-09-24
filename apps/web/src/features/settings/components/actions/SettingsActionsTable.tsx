import { useTranslations } from 'next-intl';
import type { ActionDef } from '@/lib/api/endpoints/actions';
import type { CustomField } from '@/lib/api/endpoints/customFields';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SettingsActionRow } from './SettingsActionRow';

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
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className="min-w-[680px] table-fixed">
        <colgroup>
          <col className="w-[44%]" />
          <col className="w-[42%]" />
          <col className="w-[14%]" />
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 text-xs font-normal text-muted-foreground">
              {t('columns.action')}
            </TableHead>
            <TableHead className="px-3 text-xs font-normal text-muted-foreground">
              {t('columns.thenSet')}
            </TableHead>
            <TableHead className="px-3 text-end text-xs font-normal text-muted-foreground">
              {tCommon('actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
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
        </TableBody>
      </Table>
    </div>
  );
}
