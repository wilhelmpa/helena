'use client';

import { useState } from 'react';
import Link from 'next/link';
import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Routine } from '@/lib/api/endpoints/routines';
import { cn } from '@/lib/utils';
import { issuePath } from '@/utils/paths';
import { formatInZone } from '../utils/schedulePreview';
import { RoutineRunsDialog } from './RoutineRunsDialog';

type RunState = 'success' | 'skipped' | 'failed' | 'canceled' | 'running';

// The engine's run states as a reader needs them; every unfinished one reads as running.
function runState(status: string): RunState {
  if (status === 'succeeded') return 'success';
  if (status === 'skipped' || status === 'failed' || status === 'canceled') return status;
  return 'running';
}

const DOT: Record<RunState, string> = {
  success: 'bg-status-success',
  skipped: 'bg-muted-foreground/40',
  failed: 'bg-status-danger',
  canceled: 'bg-muted-foreground/40',
  running: 'bg-status-running',
};

// The newest run of a routine: how it went, what it did and the task it worked on, and
// the way to every run of it.
export function RoutineLastRun({
  routine,
  canEdit = false,
}: {
  routine: Routine;
  canEdit?: boolean;
}) {
  const t = useTranslations('routines');
  const [history, setHistory] = useState(false);
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
      {run.gate && (
        <p className="text-xs text-muted-foreground" data-testid="routine-gate-result">
          {t('gateResult', {
            recommendation: t(run.gate.recommendation === 'skip' ? 'gateSkip' : 'gateRun'),
            reason: run.gate.reason,
            counts:
              Object.entries(run.gate.counts)
                .map(([name, value]) => `${name}: ${value}`)
                .join(', ') || '0',
          })}
        </p>
      )}
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
      <button
        type="button"
        className="flex min-h-8 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          setHistory(true);
        }}
      >
        <History className="size-3.5" />
        {t('history')}
      </button>
      {history && (
        <RoutineRunsDialog routine={routine} canEdit={canEdit} onClose={() => setHistory(false)} />
      )}
    </div>
  );
}
