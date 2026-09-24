'use client';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ListPager from '@/components/common/ListPager';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePaging } from '@/hooks/usePaging';
import type { ProjectWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';
import { cn } from '@/lib/utils';
import { useWorkflowRuns } from '@/services/controlPlaneWorkflows.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';

function scrollIntoView(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'center' });
}

// A built-in workflow at work in the project: its steps in order, and its runs with
// every stage they executed. A member who may edit workflows cancels a run or retries a
// failed one from the stage that failed.
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
  const paging = usePaging(10);
  const runs = useWorkflowRuns(projectKey, workflow.id, paging.params);
  useLiveRefresh({
    scope: revScope.controlPlane(projectId),
    targets: [qk.controlPlaneWorkflowRuns(projectKey, workflow.id)],
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t('graph')}</h4>
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {workflow.steps.map((step, index) => (
            <li key={step.id} className="rounded-md border bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="grid size-5 place-items-center rounded-full bg-accent text-xs">
                  {index + 1}
                </span>
                {step.title}
                {index < workflow.steps.length - 1 && (
                  <ChevronRight className="ms-auto size-4 text-muted-foreground rtl:rotate-180" />
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-muted-foreground">{t('recentRuns')}</h4>
        {runs.isPending ? (
          <ListSkeleton rows={2} rowClassName="h-24" />
        ) : runs.isError ? (
          <p className="text-sm text-destructive">{t('runsUnavailable')}</p>
        ) : runs.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRuns')}</p>
        ) : (
          <>
            <div className="space-y-3">
              {runs.data.items.map((run) => (
                <div
                  key={run.id}
                  ref={run.id === markedRunId ? scrollIntoView : undefined}
                  className={cn(run.id === markedRunId && 'rounded-md ring-2 ring-ring')}
                >
                  <PipelineRunTimeline run={run} canEdit={editable} showIssue />
                </div>
              ))}
            </div>
            <ListPager paging={paging} total={runs.data.total} />
          </>
        )}
      </div>
    </div>
  );
}
