'use client';

import { useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';
import type { Routine } from '@/lib/api/endpoints/routines';
import { RowEmpty, RowLink } from '@/components/common/page/RowList';
import { useMemberRoutines } from '@/features/routines/services/routines.service';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { formatDateTime, formatDuration } from '@/utils/dates';
import { schedulesPath } from '@/utils/paths';
import { DashboardSection, SkeletonRows } from '../DashboardParts';

const PAGE = { page: 1, pageSize: 50 };
const SHOWN = 4;

// The routines that fire next, across the reader's projects, soonest first.
export function useNextRoutines(): { routines: Routine[]; isPending: boolean } {
  const query = useMemberRoutines(PAGE);
  const routines = (query.data?.items ?? [])
    .filter((routine) => routine.enabled && routine.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!));
  return { routines, isPending: query.isPending };
}

// "Als Nächstes": what the routines do next (name, project and agent, how long until it
// fires, the exact time on hover). A row opens the schedules.
export default function SchedulesSection() {
  const t = useTranslations('home');
  const { routines, isPending } = useNextRoutines();
  const now = useNow(60_000);
  return (
    <DashboardSection
      label={t('widgets.schedules')}
      href={schedulesPath()}
      hrefLabel={t('links.schedules')}
    >
      {isPending ? (
        <SkeletonRows count={3} />
      ) : routines.length === 0 ? (
        <RowEmpty icon={<CalendarClock />}>{t('schedules.empty')}</RowEmpty>
      ) : (
        routines.slice(0, SHOWN).map((routine) => (
          <RowLink
            key={routine.id}
            href={schedulesPath()}
            icon={<CalendarClock />}
            title={routine.title}
            detail={[routine.projectKey, routine.agent?.name].filter(Boolean).join(' · ')}
            trailing={
              <span
                className="text-xs text-muted-foreground tabular-nums"
                title={formatDateTime(routine.nextRunAt!)}
              >
                {now === null
                  ? ''
                  : t('in', {
                      time: formatDuration(Math.max(0, Date.parse(routine.nextRunAt!) - now)),
                    })}
              </span>
            }
          />
        ))
      )}
    </DashboardSection>
  );
}
