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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ProjectWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';
import {
  useProjectWorkflows,
  useUpdateProjectWorkflow,
  useWorkflowControl,
  useWorkflowRuns,
  useWorkflowScheduleControl,
  useWorkflowSchedules,
} from '@/services/controlPlaneWorkflows.service';
import { workflowRunId, workflowRunRows } from './workflowRuns';

function WorkflowRuntime({
  projectKey,
  workflow,
}: {
  projectKey: string;
  workflow: ProjectWorkflow;
}) {
  const runs = useWorkflowRuns(projectKey, workflow.id);
  const schedules = useWorkflowSchedules(projectKey, workflow.id);
  const controls = useWorkflowControl(projectKey, workflow.id);
  const scheduleControls = useWorkflowScheduleControl(projectKey, workflow.id);
  const [cron, setCron] = useState('15 8 * * 1-5');
  const [timezone, setTimezone] = useState('Europe/Berlin');
  const runRows = useMemo(() => workflowRunRows(runs.data), [runs.data]);

  return (
    <div className="space-y-5 border-t pt-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium">Workflow graph</h4>
          <Button
            size="sm"
            variant="outline"
            onClick={() => controls.start.mutate()}
            disabled={controls.start.isPending}
          >
            <Play className="size-4" /> Start dry run
          </Button>
        </div>
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {workflow.steps.map((step, index) => (
            <li key={`${workflow.id}-${index}`} className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">
                  {index + 1}
                </span>
                {step.title}
                {index < workflow.steps.length - 1 && (
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-medium">Recent runs</h4>
        {runRows.length ? (
          <div className="divide-y rounded-lg border">
            {runRows.slice(0, 20).map((run) => {
              const id = workflowRunId(run);
              return (
                <div key={id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <code className="min-w-0 flex-1 truncate">{id}</code>
                  <Badge variant="outline">{run.status}</Badge>
                  {run.status === 'suspended' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => controls.decide.mutate({ runId: id, approved: false })}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => controls.decide.mutate({ runId: id, approved: true })}
                      >
                        <ShieldCheck className="size-4" /> Approve
                      </Button>
                    </>
                  )}
                  {run.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => controls.retry.mutate(id)}>
                      <RotateCcw className="size-4" /> Retry
                    </Button>
                  )}
                  {!['success', 'failed', 'canceled', 'bailed', 'skipped'].includes(run.status) && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label="Stop run"
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
          <p className="text-xs text-muted-foreground">No runs for this project.</p>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4" /> Mastra schedules
        </h4>
        <form
          className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            scheduleControls.create.mutate({ cron, timezone });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`${workflow.id}-cron`}>Cron</Label>
            <Input
              id={`${workflow.id}-cron`}
              value={cron}
              onChange={(event) => setCron(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${workflow.id}-tz`}>Timezone</Label>
            <Input
              id={`${workflow.id}-tz`}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </div>
          <Button className="self-end" type="submit" disabled={scheduleControls.create.isPending}>
            Add schedule
          </Button>
        </form>
        {(schedules.data?.schedules ?? []).map((schedule) => (
          <div
            key={schedule.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          >
            <code className="flex-1">{schedule.cron ?? schedule.id}</code>
            <span>{schedule.timezone}</span>
            <Badge variant="outline">
              {schedule.status ?? (schedule.enabled === false ? 'paused' : 'active')}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Run now"
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
              aria-label="Pause schedule"
              onClick={() =>
                scheduleControls.change.mutate({ scheduleId: schedule.id, action: 'pause' })
              }
            >
              <Pause className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                scheduleControls.change.mutate({ scheduleId: schedule.id, action: 'delete' })
              }
            >
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ControlPlaneWorkflowPanel({ projectKey }: { projectKey: string }) {
  const workflows = useProjectWorkflows(projectKey);
  const update = useUpdateProjectWorkflow(projectKey);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Mastra control plane</h2>
        <p className="text-xs text-muted-foreground">
          Project bindings, workflow graphs, runs, approval gates and Mastra-owned schedules.
        </p>
      </div>
      {workflows.isPending ? (
        <p className="text-sm text-muted-foreground">Loading workflows…</p>
      ) : workflows.isError ? (
        <p className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          The workflow control plane is unavailable.
        </p>
      ) : (
        <div className="space-y-3">
          {workflows.data?.map((workflow) => (
            <article key={workflow.id} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setExpanded(expanded === workflow.id ? null : workflow.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{workflow.name}</h3>
                    {workflow.externalEffects && (
                      <Badge variant="secondary">Approval required</Badge>
                    )}
                    {workflow.triggers.map((trigger) => (
                      <Badge key={trigger} variant="outline">
                        {trigger}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{workflow.description}</p>
                </button>
                <div className="flex items-center gap-2">
                  <Label htmlFor={`${workflow.id}-enabled`} className="text-xs">
                    Enabled
                  </Label>
                  <Switch
                    id={`${workflow.id}-enabled`}
                    checked={workflow.assignment.enabled}
                    disabled={update.isPending}
                    onCheckedChange={(enabled) =>
                      update.mutate({
                        workflowId: workflow.id,
                        assignment: {
                          ...workflow.assignment,
                          enabled,
                          capabilityRefs: enabled
                            ? workflow.capabilityRefs
                            : workflow.assignment.capabilityRefs,
                        },
                      })
                    }
                  />
                </div>
              </div>
              {workflow.capabilityRefs.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Capabilities: {workflow.capabilityRefs.join(', ')}
                </p>
              )}
              {expanded === workflow.id && workflow.assignment.enabled && (
                <WorkflowRuntime projectKey={projectKey} workflow={workflow} />
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
