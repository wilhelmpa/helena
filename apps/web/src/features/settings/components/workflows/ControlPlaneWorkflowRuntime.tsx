'use client';

import { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import type { ProjectWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';
import {
  useWorkflowControl,
  useWorkflowRuns,
  useWorkflowScheduleControl,
  useWorkflowSchedules,
} from '@/services/controlPlaneWorkflows.service';
import { cn } from '@/lib/utils';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import { workflowRunId, workflowRunRows } from './workflowRuns';

function scrollIntoView(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'center' });
}

export default function ControlPlaneWorkflowRuntime({
  projectId,
  projectKey,
  workflow,
  editable,
  markedRunId = null,
}: {
  projectId: number;
  projectKey: string;
  workflow: ProjectWorkflow;
  editable: boolean;
  markedRunId?: string | null;
}) {
  const t = useTranslations('settings.actions.controlPlane');
  const runs = useWorkflowRuns(projectKey, workflow.id);
  const schedules = useWorkflowSchedules(projectKey, workflow.id);
  const controls = useWorkflowControl(projectKey, workflow.id);
  const scheduleControls = useWorkflowScheduleControl(projectKey, workflow.id);
  const [cron, setCron] = useState('15 8 * * 1-5');
  const [timezone, setTimezone] = useState('Europe/Berlin');
  const runRows = useMemo(() => workflowRunRows(runs.data), [runs.data]);
  useLiveRefresh({
    scope: revScope.controlPlane(projectId),
    targets: [
      qk.controlPlaneWorkflowRuns(projectKey, workflow.id),
      qk.controlPlaneWorkflowSchedules(projectKey, workflow.id),
    ],
  });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('graph')}</h4>
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workflow.steps.map((step, index) => (
            <li
              key={step.id ?? `${workflow.id}-${index}`}
              className="rounded-lg border bg-muted/20 p-3"
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">
                  {index + 1}
                </span>
                {step.title}
                {index < workflow.steps.length - 1 && (
                  <ChevronRight className="ms-auto size-4 text-muted-foreground" />
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('recentRuns')}</h4>
        {runRows.length ? (
          <div className="divide-y rounded-lg border">
            {runRows.slice(0, 20).map((run) => {
              const id = workflowRunId(run);
              return (
                <div
                  key={id}
                  ref={id === markedRunId ? scrollIntoView : undefined}
                  className={cn(
                    'flex flex-wrap items-center gap-2 px-3 py-2 text-xs',
                    id === markedRunId && 'bg-accent',
                  )}
                >
                  <code className="min-w-0 flex-1 truncate">{id}</code>
                  <Badge variant="outline">{run.status}</Badge>
                  {editable && run.status === 'suspended' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => controls.decide.mutate({ runId: id, approved: false })}
                      >
                        {t('reject')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => controls.decide.mutate({ runId: id, approved: true })}
                      >
                        <ShieldCheck className="size-4" /> {t('approve')}
                      </Button>
                    </>
                  )}
                  {editable && run.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => controls.retry.mutate(id)}>
                      <RotateCcw className="size-4" /> {t('retry')}
                    </Button>
                  )}
                  {editable &&
                    !['success', 'failed', 'canceled', 'bailed', 'skipped'].includes(
                      run.status,
                    ) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t('stopRun')}
                        onClick={() => controls.cancel.mutate(id)}
                      >
                        <Square className="size-4" />
                      </Button>
                    )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('noRuns')}</p>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4" /> {t('schedules')}
        </h4>
        {editable && (
          <form
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              scheduleControls.create.mutate({ cron, timezone });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor={`${workflow.id}-cron`}>{t('cron')}</Label>
              <Input
                id={`${workflow.id}-cron`}
                value={cron}
                onChange={(event) => setCron(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${workflow.id}-tz`}>{t('timezone')}</Label>
              <Input
                id={`${workflow.id}-tz`}
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </div>
            <Button className="self-end" type="submit" disabled={scheduleControls.create.isPending}>
              {t('addSchedule')}
            </Button>
          </form>
        )}
        {(schedules.data?.schedules ?? []).map((schedule) => {
          const paused = schedule.status === 'paused' || schedule.enabled === false;
          return (
            <div
              key={schedule.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs"
            >
              <code className="flex-1">{schedule.cron ?? schedule.id}</code>
              <span>{schedule.timezone}</span>
              <Badge variant="outline">{schedule.status ?? (paused ? 'paused' : 'active')}</Badge>
              {editable && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={t('runNow')}
                    onClick={() =>
                      scheduleControls.change.mutate({ scheduleId: schedule.id, action: 'run' })
                    }
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={paused ? t('resumeSchedule') : t('pauseSchedule')}
                    onClick={() =>
                      scheduleControls.change.mutate({
                        scheduleId: schedule.id,
                        action: paused ? 'resume' : 'pause',
                      })
                    }
                  >
                    {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      scheduleControls.change.mutate({ scheduleId: schedule.id, action: 'delete' })
                    }
                  >
                    {t('delete')}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
