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

import { Box, Stack, Inline, Text, Card } from '@/design-system';

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
  const steps = useTranslations('settings.actions.controlPlane.agentTeamSteps');
  // The built-in steps in the reader's language; a plugin's in the API's words.
  const text = (key: string, fallback: string) =>
    workflow.id === 'agent-team' && steps.has(key as Parameters<typeof steps.has>[0])
      ? steps(key as Parameters<typeof steps>[0])
      : fallback;
  const paging = usePaging(10);
  const runs = useWorkflowRuns(projectKey, workflow.id, paging.params);
  useLiveRefresh({
    scope: revScope.controlPlane(projectId),
    targets: [qk.controlPlaneWorkflowRuns(projectKey, workflow.id)],
  });

  return (
    <Stack gap={4}>
      <Stack gap={2}>
        <h4 className="text-xs font-medium text-muted-foreground">{t('graph')}</h4>
        <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {workflow.steps.map((step, index) => (
            <Card tone="inset" as="li" pad="tight" key={step.id}>
              <Inline gap={2} className="flex items-center text-sm font-medium">
                <Text
                  as="span"
                  size="xs"
                  className="grid size-5 place-items-center rounded-full bg-accent"
                >
                  {index + 1}
                </Text>
                {text(`${step.id}.title`, step.title)}
                {index < workflow.steps.length - 1 && (
                  <ChevronRight className="ms-auto size-4 text-muted-foreground rtl:rotate-180" />
                )}
              </Inline>
              <Box as="p" marginTop={1}>
                <Text as="span" size="xs" tone="muted">
                  {text(`${step.id}.description`, step.description)}
                </Text>
              </Box>
            </Card>
          ))}
        </ol>
      </Stack>

      <Stack gap={2}>
        <h4 className="text-xs font-medium text-muted-foreground">{t('recentRuns')}</h4>
        {runs.isPending ? (
          <ListSkeleton rows={2} rowClassName="h-24" />
        ) : runs.isError ? (
          <Text as="p" size="sm" tone="danger">
            {t('runsUnavailable')}
          </Text>
        ) : runs.data.items.length === 0 ? (
          <Text as="p" size="sm" tone="muted">
            {t('noRuns')}
          </Text>
        ) : (
          <>
            <Stack gap={3}>
              {runs.data.items.map((run) => (
                <div
                  key={run.id}
                  ref={run.id === markedRunId ? scrollIntoView : undefined}
                  className={cn(run.id === markedRunId && 'rounded-md ring-2 ring-ring')}
                >
                  <PipelineRunTimeline run={run} canEdit={editable} showIssue />
                </div>
              ))}
            </Stack>
            <ListPager paging={paging} total={runs.data.total} />
          </>
        )}
      </Stack>
    </Stack>
  );
}
