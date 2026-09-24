'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
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
        <div className="p-4">
          <ListSkeleton rows={3} rowClassName="h-12" />
        </div>
      ) : teamId == null ? (
        <div className="flex h-full flex-col p-4">
          <EmptyState title={t('teamScopeRequired')} description={t('teamScopeRequiredHint')}>
            <Button asChild size="sm" variant="outline">
              <Link href={manageTeamsPath()}>{t('manageTeams')}</Link>
            </Button>
          </EmptyState>
        </div>
      ) : (
        <PipelineLibrary teamId={teamId} />
      )}
    </Shell>
  );
}
