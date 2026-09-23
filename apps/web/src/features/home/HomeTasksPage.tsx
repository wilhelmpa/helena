'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CrossProjectIssueFilters } from '@/lib/api/endpoints/issues';
import { useProjectsQuery } from '@/services/projects.service';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePaging } from '@/hooks/usePaging';
import Shell from '@/components/layout/Shell';
import ListPager from '@/components/common/ListPager';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SectionPageView from '@/components/common/page/SectionPageView';
import { useCrossProjectIssuesQuery } from './services/tasks.service';
import HomeTasksFilters, { type HomeTaskGrouping } from './components/tasks/HomeTasksFilters';
import HomeTaskList from './components/tasks/HomeTaskList';

// Every task of every project the reader works in, on one page. The tasks are read
// and filtered here; a task opens in its project, where it is edited.
export default function HomeTasksPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('workItems.allTasks');
  const projects = useProjectsQuery().data ?? [];
  const paging = usePaging(25);
  const [filters, setFilters] = useState<CrossProjectIssueFilters>({ stateType: 'open' });
  const [search, setSearch] = useState('');
  const [grouping, setGrouping] = useState<HomeTaskGrouping>('project');
  const q = useDebouncedValue(search.trim(), 300);

  const query = useCrossProjectIssuesQuery(paging.params, { ...filters, q: q || undefined });
  const issues = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return (
    <Shell globalHome globalTitle={tNav('allWorkItems')} autoOpenGlobalChat={false}>
      <SectionPageView
        title={tNav('allWorkItems')}
        description={t('hint')}
        widthClassName="mx-auto w-full max-w-5xl"
      >
        <div className="flex flex-col gap-4">
          <HomeTasksFilters
            projects={projects}
            filters={filters}
            onFiltersChange={(next) => {
              setFilters(next);
              paging.reset();
            }}
            search={search}
            onSearchChange={(next) => {
              setSearch(next);
              paging.reset();
            }}
            grouping={grouping}
            onGroupingChange={setGrouping}
          />
          {query.isPending ? (
            <ListSkeleton rows={5} rowClassName="h-9" />
          ) : total === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} />
          ) : (
            <>
              <HomeTaskList issues={issues} grouping={grouping} />
              <ListPager paging={paging} total={total} />
            </>
          )}
        </div>
      </SectionPageView>
    </Shell>
  );
}
