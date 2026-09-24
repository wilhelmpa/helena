'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CircleDot, FlaskConical, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Pipeline, PipelineRunStatus } from '@/lib/api/endpoints/pipelines';
import { useTeamProjectOptionsQuery } from '@/services/teams.service';
import { PageFilterMenu, type PageFilter } from '@/features/home/components/toolbar/PageFilterMenu';

export const ALL_RUNS = 'all';
export const RUN_STATUSES: PipelineRunStatus[] = [
  'pending',
  'running',
  'waiting',
  'succeeded',
  'failed',
  'canceled',
  'rejected',
];

export type RunFilters = { project: string; status: string; kind: string };

// The run filters live in the address (?tab=runs&project=VOL&status=failed&kind=test),
// so the editor's header row can hold them while the Läufe view reads them.
export function useRunFilters(): [RunFilters, (patch: Partial<RunFilters>) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters: RunFilters = {
    project: params.get('project') ?? ALL_RUNS,
    status: params.get('status') ?? ALL_RUNS,
    kind: params.get('kind') ?? ALL_RUNS,
  };
  const set = (patch: Partial<RunFilters>) => {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === ALL_RUNS) query.delete(key);
      else query.set(key, value);
    }
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  return [filters, set];
}

// The Läufe view's filters in the header row: a template's project, the status and
// real or test runs.
export default function PipelineRunsFilter({ pipeline }: { pipeline: Pipeline }) {
  const t = useTranslations('pipelines.runs');
  const [filters, set] = useRunFilters();
  const template = pipeline.projectId === null;
  const projects = useTeamProjectOptionsQuery(pipeline.teamId).data ?? [];

  const items: PageFilter[] = [
    ...(template
      ? [
          {
            id: 'project',
            label: t('filterProject'),
            icon: FolderKanban,
            value: filters.project,
            defaultValue: ALL_RUNS,
            onChange: (value: string) => set({ project: value }),
            options: [
              { value: ALL_RUNS, label: t('allProjects') },
              ...projects.map((item) => ({ value: item.key, label: item.name })),
            ],
          },
        ]
      : []),
    {
      id: 'status',
      label: t('filterStatus'),
      icon: CircleDot,
      value: filters.status,
      defaultValue: ALL_RUNS,
      onChange: (value) => set({ status: value }),
      options: [
        { value: ALL_RUNS, label: t('allStatuses') },
        ...RUN_STATUSES.map((value) => ({ value, label: t(`status.${value}`) })),
      ],
    },
    {
      id: 'kind',
      label: t('filterKind'),
      icon: FlaskConical,
      value: filters.kind,
      defaultValue: ALL_RUNS,
      onChange: (value) => set({ kind: value }),
      options: [
        { value: ALL_RUNS, label: t('allRuns') },
        { value: 'real', label: t('onlyRealRuns') },
        { value: 'test', label: t('onlyTestRuns') },
      ],
    },
  ];

  return (
    <PageFilterMenu
      label={t('filter')}
      resetLabel={t('filterReset')}
      filters={items}
      onReset={() => set({ project: ALL_RUNS, status: ALL_RUNS, kind: ALL_RUNS })}
    />
  );
}
