import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import { cn } from '@/lib/utils';
import { issuePath } from '@/utils/paths';
import { formatInZone } from '../utils/schedulePreview';

type RunState = 'success' | 'failed' | 'canceled' | 'running';

// Mastra reports more run states than a reader needs; every unfinished one reads as
// running.
function runState(status: string): RunState {
  if (status === 'success' || status === 'canceled') return status;
  if (status === 'failed' || status === 'bailed' || status === 'tripwire') return 'failed';
  return 'running';
}

const DOT: Record<RunState, string> = {
  success: 'bg-emerald-500',
  failed: 'bg-red-500',
  canceled: 'bg-muted-foreground/40',
  running: 'bg-amber-500',
};

// The newest run of a routine: how it went, what it did and the task it worked on.
export function RoutineLastRun({ routine }: { routine: Routine }) {
  const t = useTranslations('routines');
  const run = routine.lastRun;
  if (!run) return <span className="text-xs text-muted-foreground">{t('noRunsShort')}</span>;
  const state = runState(run.status);
  const identifier = run.taskNumber != null ? `${routine.projectKey}-${run.taskNumber}` : null;
  const task = (chunks: React.ReactNode) =>
    run.taskNumber != null ? (
      <Link
        href={issuePath(routine.projectKey, run.taskNumber)}
        className="font-mono text-foreground underline-offset-2 hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {chunks}
      </Link>
    ) : null;
  const outcome =
    run.skipReason === 'missed'
      ? t('outcome.missed')
      : run.outcome && identifier
        ? t.rich(`outcome.${run.outcome}`, { identifier, task })
        : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', DOT[state])} />
        <span className="text-sm">{t(`runStatus.${state}`)}</span>
      </div>
      {outcome && <p className="text-xs text-muted-foreground">{outcome}</p>}
      {state === 'failed' && run.error && (
        <p className="line-clamp-2 text-xs text-destructive" title={run.error}>
          {run.error}
        </p>
      )}
      {run.firedAt && (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {formatInZone(run.firedAt, routine.timezone)}
        </p>
      )}
    </div>
  );
}
