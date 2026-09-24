'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { projectPath } from '@/utils/paths';
import { useTeam, useTeamProjectsQuery } from '@/services/teams.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import { useSearchTerm } from '@/hooks/useSearchTerm';
import NewProjectModal from '@/components/layout/NewProjectModal';
import TeamProjectPanel from './TeamProjectPanel';
import TeamProjectsTable from './TeamProjectsTable';
import {
  PageActions,
  PageSearch,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';

// The projects the team owns, one row each, opening in a side panel. Owners and
// managers run them, so only they create one; a plain member only reads them.
export default function TeamProjectsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const router = useRouter();
  const team = useTeam(teamId);
  const paging = usePaging();
  const { search, setSearch, term } = useSearchTerm();
  const { data } = useTeamProjectsQuery(teamId, { search: term, ...paging.params });
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const canCreate = team != null && team.role !== 'member';
  const projects = data?.items ?? [];
  const total = data?.total ?? 0;
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  function onSearchChange(next: string) {
    setSearch(next);
    paging.reset();
  }

  return (
    <SectionPageView
      title={t('sections.projects.title')}
      description={t('sections.projects.description')}
      wide
    >
      <PageToolbar>
        <PageToolbarSpacer />
        <PageSearch
          value={search}
          onChange={onSearchChange}
          placeholder={t('panel.searchProjects')}
        />
        <PageActions
          primary={
            canCreate
              ? {
                  id: 'new',
                  label: t('panel.newProject'),
                  icon: Plus,
                  onClick: () => setCreating(true),
                }
              : undefined
          }
        />
      </PageToolbar>
      <div className="space-y-4">
        {!data ? (
          <ListSkeleton rows={4} rowClassName="h-12" />
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {term === undefined
              ? t('panel.noProjects')
              : t('panel.noProjectsMatch', { query: term })}
          </p>
        ) : (
          <TeamProjectsTable projects={projects} onSelect={setSelectedId} />
        )}
        {total > 0 && <ListPager paging={paging} total={total} />}
      </div>

      {creating && (
        <NewProjectModal
          teamId={teamId}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            router.push(projectPath(key));
          }}
        />
      )}

      {selected && team && (
        <TeamProjectPanel
          teamId={teamId}
          teamName={team.name}
          teamRole={team.role}
          project={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </SectionPageView>
  );
}
