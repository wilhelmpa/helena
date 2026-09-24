'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GanttChart, Plus, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import {
  PageActions,
  PageTabs,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { usePlannedCyclesQuery } from '@/services/cycles.service';
import { cyclesViewPath, type CyclesView } from '@/utils/paths';
import { rememberCyclesView } from './utils/cyclesView';
import { useCompletedCycles } from './hooks/useCompletedCycles';
import CyclesList from './components/list/CyclesList';
import CycleFormDialog from './components/CycleFormDialog';

// A project's cycles, grouped by the status their dates put them in, as a table or
// on a timeline. Each layout is a route of its own, and the one picked becomes the
// project's remembered layout. What is still planned loads whole — it stays a
// handful of cycles however old the project is; the finished ones only accumulate,
// so they are a paged archive of their own.
export default function CyclesPage({ view }: { view: CyclesView }) {
  const t = useTranslations('cycles');
  const { project } = useShell();
  const { can } = usePermissions();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const projectKey = project?.project.key ?? null;
  const query = usePlannedCyclesQuery(projectKey);
  const completed = useCompletedCycles(projectKey);

  if (!project || !projectKey) return null;

  const cycles = query.data ?? [];

  const changeView = (next: CyclesView) => {
    rememberCyclesView(projectKey, next);
    router.push(cyclesViewPath(projectKey, next));
  };

  const canCreate = can('cycles', 'create');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <WorkspacePageHeader title={t('title')} />
      {/* One row (docs/volition/ui-standard.md): the layouts and the one primary
          action. */}
      <PageToolbar>
        <PageTabs
          label={t('title')}
          value={view}
          onChange={changeView}
          items={[
            { value: 'table', label: t('views.table'), icon: Table2 },
            { value: 'timeline', label: t('views.timeline'), icon: GanttChart },
          ]}
        />
        <PageToolbarSpacer />
        <PageActions
          primary={
            canCreate
              ? { id: 'new', label: t('newCycle'), icon: Plus, onClick: () => setCreating(true) }
              : undefined
          }
        />
      </PageToolbar>

      <CyclesList
        cycles={cycles}
        completed={completed}
        projectKey={projectKey}
        view={view}
        isLoading={query.isLoading || completed.isLoading}
      />

      {creating && <CycleFormDialog projectKey={projectKey} onClose={() => setCreating(false)} />}
    </div>
  );
}
