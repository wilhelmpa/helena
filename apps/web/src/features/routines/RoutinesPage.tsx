'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectAgents } from '@/hooks/useProjectAgents';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { settingsSection } from '@/utils/settingsSections';
import { RoutinesList } from './components/RoutinesList';

const section = settingsSection('schedules');

// The Schedules page of a project (/project/:projectKey/ai-team/schedules): the
// routines that hand its agents work on a cron, run by Mastra.
export default function RoutinesPage() {
  const t = useTranslations('routines');
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  const { can } = usePermissions();
  const [addNew, setAddNew] = useState(false);
  const agents = useProjectAgents().data ?? [];
  if (!project) return null;
  return (
    <SectionPageView
      title={sectionText.label}
      description={sectionText.description}
      wide
      actions={
        agents.length > 0 && can(section.resource, 'create') ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddNew(true)}>
            <Plus className="size-3.5" />
            {t('newTitle')}
          </Button>
        ) : null
      }
    >
      <RequirePermission resource={section.resource} action="read">
        <RoutinesList project={project} requestNew={addNew} onNewHandled={() => setAddNew(false)} />
      </RequirePermission>
    </SectionPageView>
  );
}
