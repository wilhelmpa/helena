'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { colorDot } from '@/components/common/fields/colorDot';
import Modal from '@/components/common/overlay/Modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCreateColumn, useUpdateColumn } from '../../services/settings.service';
import type { PlannedState } from '../../utils/statesTransfer';
import { useTransferActionLabel } from '../../utils/transferAction';

import { Stack, Text, Inline, ListBox } from '@/design-system';

// Confirms a states paste before applying it: lists each incoming state, its group,
// and whether it is created or updates an existing state's color. On confirm, new
// states are created and matched states have their color updated.
export default function StatesImportDialog({
  projectKey,
  planned,
  onClose,
}: {
  projectKey: string;
  planned: PlannedState[];
  onClose: () => void;
}) {
  const t = useTranslations('settings.states');
  const tCommon = useTranslations('common');
  const tStateType = useTranslations('display.stateTypes');
  const actionLabel = useTransferActionLabel();
  const createColumn = useCreateColumn(projectKey);
  const updateColumn = useUpdateColumn(projectKey);
  const [busy, setBusy] = useState(false);

  const applicable = planned.filter((s) => s.action !== 'unchanged');

  async function apply() {
    setBusy(true);
    try {
      let created = 0;
      let updated = 0;
      for (const state of planned) {
        if (state.action === 'create') {
          await createColumn.mutateAsync({
            name: state.name,
            stateType: state.stateType,
            color: state.color,
          });
          created += 1;
        } else if (state.action === 'update' && state.existingId != null) {
          await updateColumn.mutateAsync({ id: state.existingId, patch: { color: state.color } });
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
            {planned.map((state) => (
              <Inline
                gap={3}
                padX={3}
                padY={3}
                key={`${state.stateType}:${state.name}`}
                className="flex items-center"
              >
                {colorDot(state.color)}
                <Text as="span" size="sm" className="min-w-0 flex-1 truncate font-medium">
                  {state.name}
                </Text>
                <Text as="span" size="xs" tone="muted" className="shrink-0">
                  {tStateType(state.stateType)}
                </Text>
                <Badge
                  variant={state.action === 'unchanged' ? 'outline' : 'secondary'}
                  className="shrink-0 px-1.5 py-0 text-xs font-normal"
                >
                  {actionLabel(state.action)}
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
