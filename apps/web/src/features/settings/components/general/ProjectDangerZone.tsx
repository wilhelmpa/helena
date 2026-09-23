'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import TeamProjectDeleteDialog from '@/features/teams/components/projects/TeamProjectDeleteDialog';

// The danger zone at the end of a project's General settings
// (docs/volition-design-helena-ui.md "Projekt-Einstellungen"): red-bordered,
// confirmation by typing the project's key. Reuses the delete dialog and mutation
// the team's own project list already has (danger_zone/delete is the same
// permission either way) instead of a second implementation; only the entry point
// is new. Archiving is not implemented on the API yet (the route only deletes), so
// this offers delete alone rather than a second action that would do nothing.
export default function ProjectDangerZone({ project }: { project: ProjectDetail }) {
  const t = useTranslations('settings.general.dangerZone');
  const { can } = usePermissions();
  const [showDelete, setShowDelete] = useState(false);

  if (!can('danger_zone', 'delete')) return null;

  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-destructive">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('description')}</p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('deleteTitle')}</div>
          <p className="text-xs text-muted-foreground">{t('deleteDescription')}</p>
        </div>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="shrink-0"
          onClick={() => setShowDelete(true)}
        >
          {t('deleteAction')}
        </Button>
      </div>
      {showDelete && (
        <TeamProjectDeleteDialog
          teamId={project.project.teamId}
          project={project.project}
          onClose={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
