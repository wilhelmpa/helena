'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { IssueType } from '@/lib/api/endpoints/issueTypes';
import Modal from '@/components/common/overlay/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCreateCustomField, useCreateIssueType } from '../../services/settings.service';
import { useFieldTypeLabel } from '../../utils/fieldTypes';
import type { CustomFieldsImportPlan } from '../../utils/customFieldsTransfer';

import { Stack, Text, Inline, ListBox } from '@/design-system';

// Confirms a custom fields paste before applying it. Lists any issue types that will be
// created for scoped fields and each field with its target scope and whether it is new
// or skipped (a same-name field already exists there). On confirm, missing types are
// created first, then the fields.
export default function CustomFieldsImportDialog({
  projectKey,
  plan,
  existingTypes,
  onClose,
}: {
  projectKey: string;
  plan: CustomFieldsImportPlan;
  existingTypes: IssueType[];
  onClose: () => void;
}) {
  const t = useTranslations('settings.customFields');
  const tCommon = useTranslations('common');
  const fieldTypeLabel = useFieldTypeLabel();
  const createIssueType = useCreateIssueType(projectKey);
  const createCustomField = useCreateCustomField(projectKey);
  const [busy, setBusy] = useState(false);

  const toCreate = plan.fields.filter((f) => f.action === 'create');

  async function apply() {
    setBusy(true);
    try {
      const typeIdByName = new Map<string, number>(
        existingTypes.map((type) => [type.name.toLowerCase(), type.id]),
      );
      for (const name of plan.newTypeNames) {
        const row = (await createIssueType.mutateAsync({ name })) as IssueType;
        typeIdByName.set(name.toLowerCase(), row.id);
      }
      for (const field of toCreate) {
        const issueTypeId = field.type
          ? (typeIdByName.get(field.type.toLowerCase()) ?? null)
          : null;
        await createCustomField.mutateAsync({
          issueTypeId,
          name: field.name,
          fieldType: field.fieldType,
          memberScope: field.memberScope ?? undefined,
          showInBody: field.showInBody,
          options: field.options,
        });
      }
      toast.success(
        plan.newTypeNames.length
          ? t('importedWithTypes', {
              created: toCreate.length,
              types: plan.newTypeNames.length,
            })
          : t('imported', { created: toCreate.length }),
      );
      onClose();
    } catch {
      // The failed mutation is toasted by the global handler; keep the dialog open.
      setBusy(false);
    }
  }

  return (
    <Modal title={t('importTitle')} onClose={onClose} wide>
      <Stack gap={4}>
        <Text as="p" size="xs" tone="muted">
          {plan.newTypeNames.length > 0
            ? t('importSummaryWithTypes', {
                count: toCreate.length,
                types: plan.newTypeNames.length,
                names: plan.newTypeNames.join(', '),
              })
            : t('importSummary', { count: toCreate.length })}
        </Text>
        <ListBox>
          <div className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto">
            {plan.fields.map((field) => (
              <Inline
                gap={3}
                padX={3}
                padY={3}
                key={`${field.type ?? 'global'}:${field.name}`}
                className="flex items-center"
              >
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate font-medium">
                  {field.name}
                </Text>
                <Text as="span" size="xs" tone="muted" className="shrink-0">
                  {fieldTypeLabel(field.fieldType)}
                </Text>
                <Text
                  as="span"
                  size="xs"
                  tone="muted"
                  className="w-28 shrink-0 truncate text-right"
                >
                  {field.type ?? t('globalShort')}
                </Text>
                <Badge
                  variant={field.action === 'skip' ? 'outline' : 'secondary'}
                  className="w-14 shrink-0 justify-center px-1.5 py-0 text-xs font-normal"
                >
                  {t(field.action === 'create' ? 'actionNew' : 'actionExists')}
                </Badge>
              </Inline>
            ))}
          </div>
        </ListBox>
        <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={apply} disabled={busy || toCreate.length === 0}>
            {t('importApply', { count: toCreate.length })}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
