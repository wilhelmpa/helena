'use client';

import MailAccountSettings from '@/components/mail/MailAccountSettings';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Page } from '@/design-system';

export default function ProjectMailSettingsPage() {
  const { project } = useShell();
  const { can } = usePermissions();
  if (!project || !can('integrations', 'read')) return <Page />;
  return (
    <Page>
      <MailAccountSettings
        teamId={project.project.teamId}
        projectId={project.project.id}
        projectKey={project.project.key}
        canEdit={can('integrations', 'edit')}
      />
    </Page>
  );
}
