'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SectionPageView from '@/components/common/page/SectionPageView';
import { SettingsResourceProvider } from '@/features/settings/context/settingsPermission';
import { ProjectTemplatesPanel } from './components/workflows/ProjectTemplatesPanel';
import { ControlPlaneWorkflowPanel } from './components/workflows/ControlPlaneWorkflowPanel';

export default function WorkflowsPage() {
  const t = useTranslations('settings.actions');
  const { project } = useShell();
  if (!project) return null;
  return (
    <SectionPageView title={t('workflowTitle')} description={t('workflowDescription')} wide>
      <SettingsResourceProvider resource="actions">
        <RequirePermission resource="actions" action="read">
          <ControlPlaneWorkflowPanel
            projectId={project.project.id}
            projectKey={project.project.key}
          />
          <ProjectTemplatesPanel project={project} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
