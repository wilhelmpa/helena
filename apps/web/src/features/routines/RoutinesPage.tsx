'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useProjectAgents } from '@/hooks/useProjectAgents';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import { settingsSection } from '@/utils/settingsSections';
import { RoutinesList } from './components/RoutinesList';

const section = settingsSection('schedules');

// The Schedules page of a project (/project/:projectKey/ai-team/schedules): the
// routines that hand its agents work on a cron, run by the Helena engine. "Neuer Zeitplan" is the
// page's one primary action, in the header row.
export default function RoutinesPage() {
  const t = useTranslations('routines');
  const sectionText = useSettingsSectionText()(section.slug);
  const { project } = useShell();
  const { can } = usePermissions();
  const [addNew, setAddNew] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const agents = useProjectAgents().data ?? [];
  useEffect(() => {
    if (params.get('create') !== 'schedule' || agents.length === 0) return;
    queueMicrotask(() => setAddNew(true));
    const next = new URLSearchParams(params.toString());
    next.delete('create');
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`);
  }, [params, agents.length, router, pathname]);
  if (!project) return null;
  const canCreate = agents.length > 0 && can(section.resource, 'create');
  return (
    <SectionPageView title={sectionText.label} wide>
      {canCreate ? (
        <PageToolbar>
          <PageToolbarSpacer />
          <PageActions
            primary={{
              id: 'new',
              label: t('newTitle'),
              icon: Plus,
              onClick: () => setAddNew(true),
            }}
          />
        </PageToolbar>
      ) : null}
      <RequirePermission resource={section.resource} action="read">
        <RoutinesList project={project} requestNew={addNew} onNewHandled={() => setAddNew(false)} />
      </RequirePermission>
    </SectionPageView>
  );
}
