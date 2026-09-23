'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { useTeamsQuery } from '@/services/teams.service';
import { WorkspacePageHeader } from '@/components/layout/WorkspaceHeader';
import OrganizationWorkspace from './components/OrganizationWorkspace';
import { useOrganizationQuery } from './services/organization.service';

export default function OrganizationPage() {
  const t = useTranslations('organization');
  const teams = useTeamsQuery();
  const manageableTeams = useMemo(
    () => (teams.data ?? []).filter((team) => team.role === 'owner' || team.role === 'manager'),
    [teams.data],
  );
  const [teamId, setTeamId] = useState<number | null>(null);

  useEffect(() => {
    if (manageableTeams.length > 0 && !manageableTeams.some((team) => team.id === teamId)) {
      setTeamId(manageableTeams[0]!.id);
    }
  }, [manageableTeams, teamId]);

  const organization = useOrganizationQuery(teamId);

  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <div className="flex h-full min-h-0 flex-col">
        <WorkspacePageHeader
          title={t('title')}
          description={t('description')}
          actions={
            manageableTeams.length > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground max-sm:sr-only">{t('fields.team')}</span>
                <select
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                  value={teamId ?? ''}
                  onChange={(event) => setTeamId(Number(event.target.value))}
                >
                  {manageableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
        />

        {teams.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
        ) : manageableTeams.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('managerRequired')}</p>
        ) : organization.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
        ) : organization.data ? (
          <OrganizationWorkspace key={organization.data.teamId} organization={organization.data} />
        ) : null}
      </div>
    </Shell>
  );
}
