'use client';

import { useTranslations } from 'next-intl';
import { CalendarClock } from 'lucide-react';
import type { Routine } from '@/lib/api/endpoints/routines';
import { RowEmpty, RowLink } from '@/components/common/page/RowList';
import { useMemberRoutines } from '@/features/routines/services/routines.service';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { formatDateTime, formatDuration } from '@/utils/dates';
import { schedulesPath } from '@/utils/paths';
import { SkeletonRows } from '../DashboardCard';

const PAGE = { page: 1, pageSize: 50 };

// The routines that fire next, across the reader's projects, soonest first.
export function useNextRoutines(): { routines: Routine[]; total: number; isPending: boolean } {
  const query = useMemberRoutines(PAGE);
  const routines = (query.data?.items ?? [])
    .filter((routine) => routine.enabled && routine.nextRunAt)
    .sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!));
  return { routines, total: query.data?.total ?? 0, isPending: query.isPending };
}

// A routine that fires next: its name, the project and agent, and how long until it
// fires (the exact time on hover). The row opens the schedules page.
export default function ScheduleRows({ limit }: { limit: number }) {
  const t = useTranslations('home');
  const { routines, isPending } = useNextRoutines();
  const now = useNow(60_000);
  if (isPending) return <SkeletonRows count={Math.min(3, limit)} />;
  if (routines.length === 0)
    return <RowEmpty icon={<CalendarClock />}>{t('schedules.empty')}</RowEmpty>;
  return (
    <>
      {routines.slice(0, limit).map((routine) => {
        const at = Date.parse(routine.nextRunAt!);
        return (
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
                {now === null ? '' : t('in', { time: formatDuration(Math.max(0, at - now)) })}
              </span>
            }
          />
        );
      })}
    </>
  );
}
