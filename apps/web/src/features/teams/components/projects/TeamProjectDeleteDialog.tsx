'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TeamProject } from '@/lib/api/endpoints/teams';
import { useDeleteTeamProject } from '@/services/projects.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Input } from '@/components/ui/input';

export default function TeamProjectDeleteDialog({
  teamId,
  project,
  onClose,
  onDeleted,
}: {
  teamId: number;
  // Only the fields this dialog actually reads, so a caller that has a
  // ProjectDetail (a project's own settings page) rather than a TeamProject
  // (the team's project list) can pass it straight through.
  project: Pick<TeamProject, 'id' | 'key' | 'name'>;
  onClose: () => void;
  // A page of the deleted project leaves it (its own settings go to the start page).
  onDeleted?: () => void;
}) {
  const t = useTranslations('projects.deleteDialog');
  const [confirmText, setConfirmText] = useState('');
  const deleteProject = useDeleteTeamProject();
  const matches = confirmText.trim() === project.key;

  return (
    <ConfirmDialog
      title={t('title', { name: project.name })}
      confirmLabel={t('confirm')}
      confirmDisabled={!matches}
      onClose={onClose}
      onConfirm={async () => {
        await deleteProject.mutateAsync({ teamId, projectId: project.id, projectKey: project.key });
        onClose();
        onDeleted?.();
      }}
    >
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          {t.rich('description', {
            name: project.name,
            strong: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
          })}
        </p>
        <p>
          {t.rich('typeToConfirm', {
            key: project.key,
            code: (chunks) => (
              <span className="font-mono font-medium text-foreground">{chunks}</span>
            ),
          })}
        </p>
      </div>
      <Input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={project.key}
        autoFocus
      />
    </ConfirmDialog>
  );
}
