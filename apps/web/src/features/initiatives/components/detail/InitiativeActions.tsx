'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Initiative } from '@/lib/api/endpoints/initiatives';
import { initiativesPath } from '@/utils/paths';
import { usePermissions } from '@/hooks/usePermissions';
import { useDeleteInitiative } from '@/services/initiatives.service';
import { PageActions, type PageAction } from '@/components/layout/PageToolbar';
import InitiativeDialog from '@/components/common/overlay/InitiativeDialog';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';

// The initiative's actions at the end of the page's header row: Edit as an icon, and
// Delete in the "…" menu, after a confirmation. Deleting returns to the initiatives list.
export default function InitiativeActions({
  initiative,
  projectKey,
}: {
  initiative: Initiative;
  projectKey: string;
}) {
  const tCommon = useTranslations('common');
  const t = useTranslations('initiatives');
  const { can } = usePermissions();
  const del = useDeleteInitiative(projectKey);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const canEdit = can('initiatives', 'edit');
  const canDelete = can('initiatives', 'delete');
  if (!canEdit && !canDelete) return null;

  const remove = async () => {
    await del.mutateAsync(initiative.id);
    router.push(initiativesPath(projectKey));
  };

  const actions: PageAction[] = [];
  if (canEdit)
    actions.push({
      id: 'edit',
      label: tCommon('edit'),
      icon: Pencil,
      onClick: () => setEditing(true),
    });
  if (canDelete)
    actions.push({
      id: 'delete',
      label: tCommon('delete'),
      icon: Trash2,
      menuOnly: true,
      onClick: () => setConfirming(true),
    });

  return (
    <>
      <PageActions actions={actions} />

      {confirming && (
        <ConfirmDialog
          title={t('deleteTitle')}
          confirmLabel={tCommon('delete')}
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        >
          {t('deleteConfirm', { name: initiative.title })}
        </ConfirmDialog>
      )}

      {editing && (
        <InitiativeDialog
          projectKey={projectKey}
          initiative={initiative}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
