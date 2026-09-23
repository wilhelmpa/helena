'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import Shell from '@/components/layout/Shell';
import ListPager from '@/components/common/ListPager';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { usePaging } from '@/hooks/usePaging';
import { useMemberRoutines } from './services/routines.service';
import { RoutinesTable } from './components/RoutinesTable';

// Every routine of every project the member may see the agents of, on one page. A
// routine is changed on the Schedules page of its project.
export default function HomeRoutinesPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('routines');
  const paging = usePaging(25);
  const query = useMemberRoutines(paging.params);
  const total = query.data?.total ?? 0;
  return (
    <Shell globalHome globalTitle={tNav('schedules')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-[1600px] space-y-4">
          <div>
            <h1 className="text-xl font-semibold">{tNav('schedules')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('homeHint')}</p>
          </div>
          {query.isError ? (
            <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                {t('tryAgain')}
              </Button>
            </EmptyState>
          ) : query.isPending ? (
            <ListSkeleton rows={4} rowClassName="h-12" />
          ) : total === 0 ? (
            <EmptyState title={t('empty')} description={t('homeEmptyHint')} />
          ) : (
            <>
              <RoutinesTable routines={query.data?.items ?? []} showProject />
              <ListPager paging={paging} total={total} />
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
