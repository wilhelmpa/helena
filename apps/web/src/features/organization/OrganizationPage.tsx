'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { PageSelect } from '@/components/layout/PageToolbar';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { useTeamsQuery } from '@/services/teams.service';
import OrganizationWorkspace from './components/OrganizationWorkspace';
import { useOrganizationQuery } from './services/organization.service';

// The organization of a team the reader manages: its structure, departments, goals,
// agents and projects. With several such teams the team is chosen in the header row
// and kept in the address (?team=3).
export default function OrganizationPage() {
  const t = useTranslations('organization');
  const tCommon = useTranslations('common');
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const teams = useTeamsQuery();
  const manageableTeams = useMemo(
    () => (teams.data ?? []).filter((team) => team.role === 'owner' || team.role === 'manager'),
    [teams.data],
  );
  const requested = Number(params.get('team'));
  const teamId =
    manageableTeams.find((team) => team.id === requested)?.id ?? manageableTeams[0]?.id ?? null;
  const organization = useOrganizationQuery(teamId);

  const selectTeam = (value: string) => {
    const query = new URLSearchParams(params.toString());
    query.set('team', value);
    query.delete('tab');
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  };

  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <SectionPageView title={t('title')} wide>
        {teams.isPending || (teamId != null && organization.isPending) ? (
          <ListSkeleton rows={6} rowClassName="h-8" />
        ) : manageableTeams.length === 0 ? (
          <EmptyState title={t('managerRequiredTitle')} description={t('managerRequired')} />
        ) : organization.isError ? (
          <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
            <Button size="sm" variant="outline" onClick={() => void organization.refetch()}>
              {tCommon('reload')}
            </Button>
          </EmptyState>
        ) : organization.data ? (
          <OrganizationWorkspace
            key={organization.data.teamId}
            organization={organization.data}
            toolbarEnd={
              manageableTeams.length > 1 ? (
                <PageSelect
                  label={t('fields.team')}
                  icon={Users}
                  value={String(teamId)}
                  onChange={selectTeam}
                  options={manageableTeams.map((team) => ({
                    value: String(team.id),
                    label: team.name,
                  }))}
                />
              ) : null
            }
          />
        ) : null}
      </SectionPageView>
    </Shell>
  );
}
