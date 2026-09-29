'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import TeamProjectDeleteDialog from '@/features/teams/components/projects/TeamProjectDeleteDialog';

import { Box, Stack, Text, Inline } from '@/design-system';

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
  const router = useRouter();

  if (!can('danger_zone', 'delete')) return null;

  return (
    <Box pad={4} className="rounded-lg border border-destructive/40 bg-destructive/5">
      <Stack gap={1}>
        <h3 className="text-sm font-semibold text-destructive">{t('title')}</h3>
        <Text as="p" size="xs" tone="muted">
          {t('description')}
        </Text>
      </Stack>
      <Inline
        gap={4}
        justify="between"
        marginTop={4}
        pad={4}
        className="flex items-center justify-between rounded-md border border-border bg-card"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('deleteTitle')}</div>
          <Text as="p" size="xs" tone="muted">
            {t('deleteDescription')}
          </Text>
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
      </Inline>
      {showDelete && (
        <TeamProjectDeleteDialog
          teamId={project.project.teamId}
          project={project.project}
          onClose={() => setShowDelete(false)}
          onDeleted={() => router.replace('/')}
        />
      )}
    </Box>
  );
}
