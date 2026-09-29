'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { Skeleton } from '@/components/ui/skeleton';
import { useCycleQuery } from '@/services/cycles.service';
import { useLocalBoardSettings } from '@/hooks/useLocalBoardSettings';
import { PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { FilterControl } from '@/components/layout/FilterBar';
import BoardDisplayControl from '@/features/work-items/components/BoardDisplayControl';
import CycleHeaderActions, { CycleSummary } from './components/detail/CycleHeader';
import CycleIssuesBoard, { CYCLE_BOARD_STORE_KEY } from './components/detail/CycleIssuesBoard';
import { Page } from '@/design-system';

// One cycle: the board of the issues planned into it, under one header row
// (PageToolbar): the cycle's status, range, goal and progress, the board's filter and
// display, and the cycle's menu.
export default function CycleDetailPage({ cycleId }: { cycleId: number }) {
  const t = useTranslations('cycles');
  const { project, customFields } = useShell();
  const projectKey = project?.project.key ?? null;
  const query = useCycleQuery(cycleId);
  const cycle = query.data;
  const board = useLocalBoardSettings(CYCLE_BOARD_STORE_KEY, cycleId);

  if (!project || !projectKey) return null;
  if (!cycle)
    return query.isLoading ? (
      <Skeleton className="m-4 h-8 w-64" />
    ) : (
      <p className="p-4 text-sm text-muted-foreground">{t('notFound')}</p>
    );

  return (
    <Page variant="fill">
      <PageToolbar>
        <CycleSummary cycle={cycle} />
        <PageToolbarSpacer />
        <FilterControl
          filters={board.filters}
          onChange={board.setFilters}
          project={project}
          customFields={customFields}
        />
        <BoardDisplayControl
          view={board.view}
          onViewChange={board.changeView}
          settings={board.settings}
          onSettingsChange={board.changeSettings}
          customFields={customFields}
          issueTypes={project.issueTypes}
        />
        <CycleHeaderActions cycle={cycle} projectKey={projectKey} />
      </PageToolbar>
      <CycleIssuesBoard cycle={cycle} board={board} />
    </Page>
  );
}
