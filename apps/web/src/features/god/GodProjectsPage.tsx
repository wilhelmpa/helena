'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { usePaging } from '@/hooks/usePaging';
import ListPager from '@/components/common/ListPager';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageSearch, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import GodSectionPage from './components/GodSectionPage';
import GodProjectDetailPanel from './components/projects/GodProjectDetailPanel';
import GodProjectsTable from './components/projects/GodProjectsTable';
import { useInstanceProjectsQuery } from './services/god.service';

// The instance project directory: one row per project with what it holds, and a side
// panel showing every member and the permissions their membership resolves to. Like
// the user directory, search and paging run on the server, so the list never holds
// every project.
export default function GodProjectsPage() {
  const t = useTranslations('god.projects');
  const [search, setSearch] = useState('');
  const paging = usePaging(25);
  const [selected, setSelected] = useState<number | null>(null);

  // Typing refetches, so wait for a pause instead of firing per keystroke.
  const debouncedSearch = useDebouncedValue(search, 300);

  const projectsQuery = useInstanceProjectsQuery({ search: debouncedSearch, ...paging.params });
  const projects = projectsQuery.data?.items ?? [];
  const total = projectsQuery.data?.total ?? 0;

  return (
    <GodSectionPage slug="projects" widthClassName="max-w-none">
      <div className="space-y-4">
        <PageToolbar>
          <PageToolbarSpacer />
          <PageSearch
            value={search}
            onChange={(value) => {
              setSearch(value);
              paging.reset();
            }}
            placeholder={t('searchPlaceholder')}
          />
        </PageToolbar>

        {projectsQuery.isPending ? (
          <ListSkeleton rows={6} rowClassName="h-12" />
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <>
            <GodProjectsTable projects={projects} onSelect={setSelected} />
            <ListPager paging={paging} total={total} />
          </>
        )}
      </div>

      {selected !== null && (
        <GodProjectDetailPanel projectId={selected} onClose={() => setSelected(null)} />
      )}
    </GodSectionPage>
  );
}
