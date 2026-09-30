import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { DEFAULT_COLOR } from '@/utils/project';
import { colorDot } from '@/components/common/fields/colorDot';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/common/page/EmptyState';
import SettingsColorField from '../crud/SettingsColorField';
import SettingsConfirmDeleteDialog from '../crud/SettingsConfirmDeleteDialog';
import { SettingsInlineForm } from '../crud/SettingsInlineForm';
import { useSettingsCan } from '../../context/settingsPermission';
import {
  useCreateIssueType,
  useDeleteIssueType,
  useUpdateIssueType,
} from '../../services/settings.service';

import { Box, Inline, Stack, Text, Table, Td, Th, Tr, Card } from '@/design-system';

// The project's issue types. Adding is opened from the page header (the `adding`
// flag is lifted to the page); the add form itself is inline in this list.
export default function SettingsIssueTypes({
  project,
  adding,
  onAddingChange,
}: {
  project: ProjectDetail;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [isDefault, setIsDefault] = useState(false);
  const [deleting, setDeleting] = useState<IssueType | null>(null);
  const t = useTranslations('settings.issueTypes');
  const tCommon = useTranslations('common');
  const can = useSettingsCan();
  const createIssueType = useCreateIssueType(project.project.key);
  const updateIssueType = useUpdateIssueType(project.project.key);
  const deleteIssueType = useDeleteIssueType(project.project.key);

  const types = project.issueTypes;
  const issueCount = (typeId: number) =>
    project.issues.filter((issue) => issue.typeId === typeId).length;

  useEffect(() => {
    if (adding) {
      setEditingId(null);
      setName('');
      setColor(DEFAULT_COLOR);
      setIsDefault(false);
    }
  }, [adding]);

  function startEdit(type: IssueType) {
    onAddingChange(false);
    setEditingId(type.id);
    setName(type.name);
    setColor(type.color);
    setIsDefault(type.isDefault);
  }

  async function add() {
    if (!name.trim()) return;
    await createIssueType.mutateAsync({ name: name.trim(), color, isDefault });
    onAddingChange(false);
  }

  async function saveEdit(type: IssueType) {
    if (!name.trim()) return;
    await updateIssueType.mutateAsync({
      id: type.id,
      patch: { name: name.trim(), color, isDefault },
    });
    setEditingId(null);
  }

  // The "Default" checkbox shown in the add/edit form; `id` keeps the label's
  // htmlFor unique per row.
  const defaultToggle = (id: string) => (
    <Inline gap={2} className="flex items-center">
      <Checkbox id={id} checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
      <Label htmlFor={id} className="text-xs whitespace-nowrap text-muted-foreground">
        {t('default')}
      </Label>
    </Inline>
  );

  // While there are no types and none is being added, the empty state replaces the
  // list. Its add action lives in the page header, so it carries no button here.
  const showEmpty = types.length === 0 && !adding;
  const deletingCount = deleting ? issueCount(deleting.id) : 0;

  if (showEmpty) {
    return <EmptyState title={t('emptyTitle')} description={t('emptyHint')} />;
  }

  const inlineForm = (
    submitLabel: string,
    onSubmit: () => void,
    onCancel: () => void,
    key: string,
  ) => (
    <SettingsInlineForm
      name={name}
      onNameChange={setName}
      placeholder={t('namePlaceholder')}
      submitLabel={submitLabel}
      onSubmit={onSubmit}
      onCancel={onCancel}
      leading={<SettingsColorField value={color} onChange={setColor} />}
      trailing={defaultToggle(key)}
    />
  );

  return (
    <Stack gap={4}>
      <Card pad="none" className="overflow-hidden">
        <Table stack={false} className="table-fixed md:min-w-[640px]">
          <colgroup>
            <col className="w-[46%]" />
            <col className="w-[40%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <Tr className="hover:bg-transparent">
              <Th>{t('columns.type')}</Th>
              <Th>{t('columns.issues')}</Th>
              <Th alignment="end">{tCommon('actions')}</Th>
            </Tr>
          </thead>
          <tbody>
            {types.map((type) =>
              editingId === type.id ? (
                <Tr key={type.id} className="hover:bg-transparent">
                  <Td colSpan={3}>
                    {inlineForm(
                      tCommon('save'),
                      () => void saveEdit(type),
                      () => setEditingId(null),
                      `type-default-edit-${type.id}`,
                    )}
                  </Td>
                </Tr>
              ) : (
                <Tr key={type.id} className="group/item">
                  <Td className="py-3">
                    <Inline gap={2} className="flex min-w-0 items-center">
                      {colorDot(type.color)}
                      <Text as="span" size="sm" className="truncate font-medium">
                        {type.name}
                      </Text>
                      {type.isDefault && (
                        <Box
                          as="span"
                          padX={2}
                          padY={1}
                          className="rounded-sm bg-secondary text-xs font-medium text-secondary-foreground"
                        >
                          {t('default')}
                        </Box>
                      )}
                    </Inline>
                  </Td>
                  <Td className="py-3 tabular-nums">
                    {t('issueCount', { count: issueCount(type.id) })}
                  </Td>
                  <Td>
                    <Inline gap={1} justify="end" className="flex items-center justify-end">
                      {can('edit') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          title={t('edit')}
                          aria-label={t('edit')}
                          onClick={() => startEdit(type)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                      {can('delete') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          title={t('delete')}
                          aria-label={t('delete')}
                          onClick={() => setDeleting(type)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </Inline>
                  </Td>
                </Tr>
              ),
            )}
            {adding && (
              <Tr className="hover:bg-transparent">
                <Td colSpan={3}>
                  {inlineForm(
                    tCommon('add'),
                    () => void add(),
                    () => onAddingChange(false),
                    'type-default-new',
                  )}
                </Td>
              </Tr>
            )}
          </tbody>
        </Table>
      </Card>

      {deleting && (
        <SettingsConfirmDeleteDialog
          title={t('deleteTitle', { name: deleting.name })}
          confirmLabel={t('deleteConfirm')}
          message={t('deleteMessage', { count: deletingCount })}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteIssueType.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Stack>
  );
}
