'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useInitiativeCountsQuery, useInitiativesQuery } from '@/services/initiatives.service';
import { INITIATIVE_SORTS, type InitiativeSort } from '@/lib/api/endpoints/initiatives';
import { initiativesTabPath, type InitiativesTab } from '@/utils/paths';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import InitiativesList from './components/list/InitiativesList';
import InitiativesPagination from './components/list/InitiativesPagination';
import InitiativeDialog from '@/components/common/overlay/InitiativeDialog';
import InitiativeTabs from './components/list/InitiativeTabs';
import { useInitiativeTabOrder } from './hooks/useInitiativeTabOrder';
import { INITIATIVE_TABS, tabCount } from './utils/tabs';

const PAGE_SIZE = 25;

// A project's initiatives, one status tab at a time. The open tab is a route of its
// own and the page and sorting are query parameters, so the list reopens as it was
// after a reload and can be shared as a link. Each tab loads its own page from the
// server, sorted and paged there; the tab counts come from a separate aggregate so
// they stay correct regardless of the current page. The tab strip is sortable by
// drag, and its order is a preference of the browser (see useInitiativeTabOrder).
export default function InitiativesPage({ tab }: { tab: InitiativesTab }) {
  const t = useTranslations('initiatives');
  const { project } = useShell();
  const { can } = usePermissions();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [creating, setCreating] = useState(false);
  const { order, reorder } = useInitiativeTabOrder();

  const projectKey = project?.project.key ?? null;
  const activeTab = INITIATIVE_TABS.find((item) => item.value === tab)!;
  const orderedTabs = order.map((value) => INITIATIVE_TABS.find((item) => item.value === value)!);

  const pageParam = Number(searchParams.get('page'));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  // A sort the server does not support is no sort at all, and a direction on its own
  // means nothing.
  const sort = INITIATIVE_SORTS.find((key) => key === searchParams.get('sort'));
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc';
  const dir = sort ? sortDir : undefined;

  const query = useInitiativesQuery(projectKey, {
    statuses: activeTab.statuses,
    sort,
    dir,
    page,
    pageSize: PAGE_SIZE,
  });
  const counts = useInitiativeCountsQuery(projectKey).data;

  if (!project) return null;

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  const tabPath = initiativesTabPath(project.project.key, tab);

  const pushQuery = (params: URLSearchParams) => {
    const search = params.toString();
    router.push(search ? `${tabPath}?${search}` : tabPath);
  };

  // A tab is its own route and carries no query, so switching one drops the page and
  // the sorting of the tab left behind.
  const changeTab = (next: InitiativesTab) => {
    router.push(initiativesTabPath(project.project.key, next));
  };

  const changePage = (next: number) => {
    const params = new URLSearchParams(searchParams);
    if (next > 1) params.set('page', String(next));
    else params.delete('page');
    pushQuery(params);
  };

  // Re-selecting the sorted column flips its direction; a new column sorts ascending.
  const changeSort = (key: InitiativeSort) => {
    const params = new URLSearchParams(searchParams);
    params.set('sort', key);
    params.set('dir', sort === key && sortDir === 'asc' ? 'desc' : 'asc');
    params.delete('page');
    pushQuery(params);
  };

  const canCreate = can('initiatives', 'create');

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <WorkspacePageHeader title={t('title')} />
      {/* One row (docs/volition/ui-standard.md): the status tabs, sortable by drag, and
          the page's one primary action. */}
      <PageToolbar>
        <InitiativeTabs
          label={t('title')}
          value={tab}
          items={orderedTabs.map((item) => ({
            value: item.value,
            label: t(`tabs.${item.value}`),
            count: tabCount(counts, item.value),
          }))}
          onSelect={changeTab}
          onReorder={reorder}
        />
        <PageToolbarSpacer />
        <PageActions
          primary={
            canCreate
              ? {
                  id: 'new',
                  label: t('newInitiative'),
                  icon: Plus,
                  onClick: () => setCreating(true),
                }
              : undefined
          }
        />
      </PageToolbar>

      <InitiativesList
        initiatives={items}
        project={project}
        isLoading={query.isLoading}
        statusTab={activeTab.value === 'all' ? undefined : activeTab.value}
        sort={sort}
        dir={dir}
        onSort={changeSort}
      />

      <InitiativesPagination page={page} pageSize={PAGE_SIZE} total={total} onPage={changePage} />

      {creating && projectKey && (
        <InitiativeDialog projectKey={projectKey} onClose={() => setCreating(false)} />
      )}
    </div>
  );
}
