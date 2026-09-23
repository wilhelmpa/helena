'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import { useTeamsQuery } from '@/services/teams.service';
import { soleTeamId } from '@/utils/homeTeamScope';
import { manageTeamsPath } from '@/utils/paths';
import PipelineLibrary from './components/library/PipelineLibrary';

// The team's library of workflow templates in Home. Like the other team sections of
// Home it needs the reader's projects to belong to one team.
export default function HomePipelinesPage() {
  const t = useTranslations('nav');
  const teams = useTeamsQuery();
  const teamId = soleTeamId(teams.data);

  return (
    <Shell globalHome globalTitle={t('workflows')} autoOpenGlobalChat={false}>
      {teams.isPending ? (
        <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
      ) : teamId == null ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-lg border bg-card p-6 text-center">
            <h1 className="text-base font-semibold">{t('teamScopeRequired')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('teamScopeRequiredHint')}</p>
            <Button asChild className="mt-4">
              <Link href={manageTeamsPath()}>{t('manageTeams')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <PipelineLibrary teamId={teamId} />
      )}
    </Shell>
  );
}
