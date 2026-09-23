'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ListPager from '@/components/common/ListPager';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePaging } from '@/hooks/usePaging';
import type { Pipeline, PipelineRunStatus } from '@/lib/api/endpoints/pipelines';
import { usePipelineRuns } from '@/services/pipelines.service';
import { qk } from '@/services/queryKeys';
import { useTeamProjectOptionsQuery } from '@/services/teams.service';
import { revScope } from '@/utils/revScopes';

const ALL = 'all';
const STATUSES: PipelineRunStatus[] = [
  'pending',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'canceled',
  'rejected',
];

// The runs of the workflow, newest first. A template runs in every project of the team,
// so its runs can be narrowed to one; the list stays live for that project.
export default function PipelineRunsTab({
  pipeline,
  canEdit,
}: {
  pipeline: Pipeline;
  canEdit: boolean;
}) {
  const t = useTranslations('pipelines.runs');
  const template = pipeline.projectId === null;
  const [project, setProject] = useState(useSearchParams().get('project') ?? ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [kind, setKind] = useState<string>(ALL);
  const paging = usePaging(10);
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
  const filter = (
    value: string,
    onChange: (value: string) => void,
    label: string,
    options: [string, string][],
  ) => (
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(next);
        paging.reset();
      }}
    >
      <SelectTrigger size="sm" className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([option, text]) => (
          <SelectItem key={option} value={option}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {template &&
          filter(project, setProject, t('allProjects'), [
            [ALL, t('allProjects')],
            ...projects.map((item): [string, string] => [item.key, item.name]),
          ])}
        {filter(status, setStatus, t('allStatuses'), [
          [ALL, t('allStatuses')],
          ...STATUSES.map((value): [string, string] => [value, t(`status.${value}`)]),
        ])}
        {filter(kind, setKind, t('allRuns'), [
          [ALL, t('allRuns')],
          ['real', t('onlyRealRuns')],
          ['test', t('onlyTestRuns')],
        ])}
      </div>
      {runs.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-24" />
      ) : runs.isError ? (
        <p className="text-sm text-destructive">{t('loadFailed')}</p>
      ) : runs.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <div className="space-y-3">
            {runs.data.items.map((run) => (
              <PipelineRunTimeline key={run.id} run={run} canEdit={canEdit} showIssue />
            ))}
          </div>
          <ListPager paging={paging} total={runs.data.total} />
        </>
      )}
    </div>
  );
}
