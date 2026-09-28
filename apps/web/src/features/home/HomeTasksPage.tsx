'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { StateType } from '@/lib/api/endpoints/columns';
import type { CrossProjectIssueFilters } from '@/lib/api/endpoints/issues';
import { useProjectsQuery } from '@/services/projects.service';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePaging } from '@/hooks/usePaging';
import Shell from '@/components/layout/Shell';
import ListPager from '@/components/common/ListPager';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import SectionPageView from '@/components/common/page/SectionPageView';
import { Button } from '@/components/ui/button';
import { STATE_TYPES } from '@/utils/fieldOptions';
import { useCrossProjectIssuesQuery } from './services/tasks.service';
import HomeTasksToolbar, { type HomeTaskGrouping } from './components/tasks/HomeTasksToolbar';
import HomeTaskList from './components/tasks/HomeTaskList';

// The filters live in the address (?project=VOL&state=any&assignee=me&due=week
// &group=state), so a link can open the list filtered (Start's "Offene Aufgaben" opens
// the reader's own) and the back button returns to the same list. Without a `state` the
// list shows the open tasks; `state=any` shows every state.
function filtersOf(params: URLSearchParams): CrossProjectIssueFilters {
  const state = params.get('state');
  const due = params.get('due');
  return {
    projectKey: params.get('project') || undefined,
    stateType:
      state === 'any'
        ? undefined
        : STATE_TYPES.includes(state as StateType)
          ? (state as StateType)
          : 'open',
    assignee: params.get('assignee') || undefined,
    due: due === 'overdue' || due === 'week' ? due : undefined,
  };
}

// Every task of every project the reader works in, on one page. The tasks are read
// and filtered here; a task opens in its project, where it is edited.
export default function HomeTasksPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('workItems.allTasks');
  const tCommon = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const projects = useProjectsQuery().data ?? [];
  const paging = usePaging(25);
  const filters = filtersOf(new URLSearchParams(params.toString()));
  const grouping: HomeTaskGrouping = params.get('group') === 'state' ? 'state' : 'project';
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);

  const query = useCrossProjectIssuesQuery(paging.params, { ...filters, q: q || undefined });
  const issues = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const setParams = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    const search = next.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };

  const changeFilters = (patch: CrossProjectIssueFilters) => {
    const merged = { ...filters, ...patch };
    setParams({
      project: merged.projectKey,
      state:
        merged.stateType === 'open'
          ? undefined
          : merged.stateType === undefined
            ? 'any'
            : merged.stateType,
      assignee: merged.assignee,
      due: merged.due,
    });
    paging.reset();
  };

  return (
    <Shell
      globalHome
      globalTitle={filters.assignee === 'me' ? tNav('sidebarMyTasks') : tNav('sidebarOpenTasks')}
      autoOpenGlobalChat={false}
    >
      <SectionPageView title={tNav('allWorkItems')} wide>
        <HomeTasksToolbar
          projects={projects}
          filters={filters}
          onFiltersChange={changeFilters}
          search={search}
          onSearchChange={(next) => {
            setSearch(next);
            paging.reset();
          }}
          grouping={grouping}
          onGroupingChange={(next) => setParams({ group: next === 'state' ? 'state' : undefined })}
        />
        {query.isError ? (
          <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              {tCommon('reload')}
            </Button>
          </EmptyState>
        ) : query.isPending ? (
          <ListSkeleton rows={5} rowClassName="h-9" />
        ) : total === 0 ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} />
        ) : (
          <div className="flex flex-col gap-4">
            <HomeTaskList issues={issues} grouping={grouping} />
            <ListPager paging={paging} total={total} />
          </div>
        )}
      </SectionPageView>
    </Shell>
  );
}
