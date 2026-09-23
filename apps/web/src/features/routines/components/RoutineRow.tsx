import Link from 'next/link';
import { Bot, RotateCcw, SquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { aiTeamPath, issuePath } from '@/utils/paths';
import { parseScheduleInput } from '../utils/cronSchedule';
import { formatInZone } from '../utils/schedulePreview';
import { RoutineActionsMenu, type RoutineActions } from './RoutineActionsMenu';
import { RoutineLastRun } from './RoutineLastRun';

// One routine. Without `actions` the row only reads, the way Home lists the routines of
// every project.
export function RoutineRow({
  routine,
  showProject,
  actions,
}: {
  routine: Routine;
  showProject: boolean;
  actions?: RoutineActions;
}) {
  const t = useTranslations('routines');
  const cron = parseScheduleInput(routine.cron);
  return (
    <TableRow className="group/item">
      {showProject && (
        <TableCell className="px-3 py-4 align-top whitespace-normal">
          <Link
            href={aiTeamPath(routine.projectKey, 'schedules')}
            className="text-sm font-medium underline-offset-2 hover:underline"
          >
            {routine.projectName}
          </Link>
          <p className="font-mono text-xs text-muted-foreground">{routine.projectKey}</p>
        </TableCell>
      )}
      <TableCell className="px-3 py-4 align-top whitespace-normal">
        <p dir="auto" className="truncate text-sm font-medium" title={routine.instructions}>
          {routine.title}
        </p>
        <p
          className={cn(
            'mt-0.5 flex min-w-0 items-center gap-1 text-xs',
            routine.agent ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          <Bot className="size-3.5 shrink-0" />
          <span className="truncate">{routine.agent?.name ?? t('agentLeft')}</span>
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {routine.mode === 'reopen' ? (
            <RotateCcw className="size-3.5 shrink-0" />
          ) : (
            <SquarePlus className="size-3.5 shrink-0" />
          )}
          {routine.mode === 'reopen' && routine.task ? (
            <Link
              href={issuePath(routine.projectKey, routine.task.number)}
              className="truncate underline-offset-2 hover:underline"
            >
              {t('reopensTask', { identifier: `${routine.projectKey}-${routine.task.number}` })}
            </Link>
          ) : (
            <span className="truncate">
              {routine.mode === 'reopen' ? t('taskGone') : t('modeNew')}
            </span>
          )}
        </p>
      </TableCell>
      <TableCell className="px-3 py-4 align-top whitespace-normal">
        <p className="text-sm" title={routine.cron}>
          {cron.ok ? cron.description : routine.cron}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{routine.timezone}</p>
        <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {routine.nextRunAt
            ? t('nextRunAt', { time: formatInZone(routine.nextRunAt, routine.timezone) })
            : t('paused')}
        </p>
      </TableCell>
      <TableCell className="px-3 py-4 align-top whitespace-normal">
        <RoutineLastRun routine={routine} />
      </TableCell>
      <TableCell className="px-3 py-4 align-top">
        {actions?.canEdit ? (
          <Switch
            checked={routine.enabled}
            onCheckedChange={actions.onToggle}
            aria-label={t('runOnSchedule')}
          />
        ) : (
          <span className="flex items-center gap-2 text-sm">
            <span
              className={cn(
                'size-2 rounded-full',
                routine.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
              )}
            />
            {routine.enabled ? t('active') : t('paused')}
          </span>
        )}
      </TableCell>
      {actions && (
        <TableCell className="px-3 py-3 text-end align-top">
          <RoutineActionsMenu actions={actions} />
        </TableCell>
      )}
    </TableRow>
  );
}
