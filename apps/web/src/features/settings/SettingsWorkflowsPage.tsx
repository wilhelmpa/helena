'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SectionPageView from '@/components/common/page/SectionPageView';
import { Button } from '@/components/ui/button';
import { SettingsResourceProvider } from '@/features/settings/context/settingsPermission';
import SettingsActions from '@/features/settings/components/actions/SettingsActions';
import { ProjectTemplatesPanel } from './components/workflows/ProjectTemplatesPanel';

export default function WorkflowsPage() {
  const t = useTranslations('settings.actions');
  const { project, customFields } = useShell();
  const { can } = usePermissions();
  const [addNew, setAddNew] = useState(false);
  if (!project) return null;
  return (
    <SectionPageView
      title={t('workflowTitle')}
      description={t('workflowDescription')}
      wide
      actions={
        can('actions', 'create') ? (
          <Button type="button" size="sm" onClick={() => setAddNew(true)}>
            {t('newWorkflow')}
          </Button>
        ) : undefined
      }
    >
      <SettingsResourceProvider resource="actions">
        <RequirePermission resource="actions" action="read">
          <SettingsActions
            project={project}
            customFields={customFields}
            requestNew={addNew}
            onNewHandled={() => setAddNew(false)}
          />
          <ProjectTemplatesPanel project={project} />
        </RequirePermission>
      </SettingsResourceProvider>
    </SectionPageView>
  );
}
