'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { colorDot } from '@/components/common/fields/colorDot';
import Modal from '@/components/common/overlay/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCreateIssueType, useUpdateIssueType } from '../../services/settings.service';
import type { PlannedIssueType } from '../../utils/issueTypesTransfer';
import { useTransferActionLabel } from '../../utils/transferAction';

import { Stack, Text, Inline, ListBox } from '@/design-system';

// Confirms an issue types paste before applying it: lists each incoming type and
// whether it is created or updates an existing type's color. On confirm, new types are
// created and matched types have their color updated.
export default function IssueTypesImportDialog({
  projectKey,
  planned,
  onClose,
}: {
  projectKey: string;
  planned: PlannedIssueType[];
  onClose: () => void;
}) {
  const t = useTranslations('settings.issueTypes');
  const tCommon = useTranslations('common');
  const actionLabel = useTransferActionLabel();
  const createIssueType = useCreateIssueType(projectKey);
  const updateIssueType = useUpdateIssueType(projectKey);
  const [busy, setBusy] = useState(false);

  const applicable = planned.filter((t) => t.action !== 'unchanged');

  async function apply() {
    setBusy(true);
    try {
      let created = 0;
      let updated = 0;
      for (const type of planned) {
        if (type.action === 'create') {
          await createIssueType.mutateAsync({
            name: type.name,
            icon: type.icon || undefined,
            color: type.color,
            isDefault: false,
          });
          created += 1;
        } else if (type.action === 'update' && type.existingId != null) {
          await updateIssueType.mutateAsync({ id: type.existingId, patch: { color: type.color } });
          updated += 1;
        }
      }
      toast.success(t('imported', { created, updated }));
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
          {t('importSummary', { count: applicable.length })}
        </Text>
        <ListBox>
          <div className="max-h-[50vh] divide-y divide-border/60 overflow-y-auto">
            {planned.map((type) => (
              <Inline gap={3} padX={3} padY={3} key={type.name} className="flex items-center">
                {colorDot(type.color)}
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate font-medium">
                  {type.name}
                </Text>
                <Badge
                  variant={type.action === 'unchanged' ? 'outline' : 'secondary'}
                  className="shrink-0 px-1.5 py-0 text-xs font-normal"
                >
                  {actionLabel(type.action)}
                </Badge>
              </Inline>
            ))}
          </div>
        </ListBox>
        <Inline gap={2} align="stretch" justify="end" className="flex justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {tCommon('cancel')}
          </Button>
          <Button onClick={apply} disabled={busy || applicable.length === 0}>
            {t('importApply', { count: applicable.length })}
          </Button>
        </Inline>
      </Stack>
    </Modal>
  );
}
