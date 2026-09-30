'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import ListPager from '@/components/common/ListPager';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePaging } from '@/hooks/usePaging';
import type { Pipeline, PipelineRunStatus } from '@/lib/api/endpoints/pipelines';
import { usePipelineRuns } from '@/services/pipelines.service';
import { qk } from '@/services/queryKeys';
import { useTeamProjectOptionsQuery } from '@/services/teams.service';
import { revScope } from '@/utils/revScopes';
import { ALL_RUNS as ALL, useRunFilters } from './PipelineRunsFilter';
import { Stack, EmptyState, Notice } from '@/design-system';

// The runs of the workflow, newest first. A template runs in every project of the team,
// so its runs can be narrowed to one; the list stays live for that project. The filters
// are in the editor's header row (PipelineRunsFilter) and the address.
export default function PipelineRunsTab({
  pipeline,
  canEdit,
}: {
  pipeline: Pipeline;
  canEdit: boolean;
}) {
  const t = useTranslations('pipelines.runs');
  const template = pipeline.projectId === null;
  const [{ project, status, kind }] = useRunFilters();
  const paging = usePaging(10);
  const { reset } = paging;
  useEffect(() => reset(), [project, status, kind, reset]);
  const projects = useTeamProjectOptionsQuery(pipeline.teamId).data ?? [];
  const runs = usePipelineRuns(pipeline.id, paging.params, {
    projectKey: template && project !== ALL ? project : undefined,
    status: status === ALL ? undefined : (status as PipelineRunStatus),
    dryRun: kind === ALL ? undefined : kind === 'test',
  });
  const liveProject = pipeline.projectId ?? projects.find((item) => item.key === project)?.id;
  useLiveRefresh({
    scope: liveProject ? revScope.controlPlane(liveProject) : null,
    targets: [qk.anyPipelineRuns],
  });
  return (
    <Stack gap={4}>
      {runs.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-24" />
      ) : runs.isError ? (
        <Notice tone="danger">{t('loadFailed')}</Notice>
      ) : runs.data.items.length === 0 ? (
        <EmptyState boxed fill={false}>
          {t('empty')}
        </EmptyState>
      ) : (
        <>
          <Stack gap={3}>
            {runs.data.items.map((run) => (
              <PipelineRunTimeline key={run.id} run={run} canEdit={canEdit} showIssue />
            ))}
          </Stack>
          <ListPager paging={paging} total={runs.data.total} />
        </>
      )}
    </Stack>
  );
}
