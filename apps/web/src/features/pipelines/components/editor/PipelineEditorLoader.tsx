'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import { usePipeline, useProjectPipelines } from '@/services/pipelines.service';
import { useTeamQuery } from '@/services/teams.service';
import { pipelinePath } from '@/utils/paths';
import PipelineEditor from './PipelineEditor';
import { Box } from '@/design-system';

// Loads the workflow and decides how it is edited: a template by the team's actions
// permission, a project workflow by the project's, with the project's role mapping
// for its validation.
export default function PipelineEditorLoader({
  pipelineId,
  projectKey,
}: {
  pipelineId: number;
  projectKey: string | null;
}) {
  const t = useTranslations('pipelines.editor');
  const tCommon = useTranslations('common');
  const pipeline = usePipeline(pipelineId);
  const team = useTeamQuery(pipeline.data?.projectId === null ? pipeline.data.teamId : null);
  const usage = useProjectPipelines(projectKey);
  const { can } = usePermissions();

  if (pipeline.isPending) return <ListSkeleton rows={4} rowClassName="h-14" className="p-4" />;
  if (pipeline.isError)
    return (
      <Box pad={4} className="flex h-full flex-col">
        <EmptyState title={t('loadFailed')} description={t('loadFailedHint')}>
          <Button size="sm" variant="outline" onClick={() => void pipeline.refetch()}>
            {tCommon('reload')}
          </Button>
        </EmptyState>
      </Box>
    );
  const data = pipeline.data;
  if (projectKey && data.projectId === null)
    return (
      <Box pad={4} className="flex h-full flex-col">
        <EmptyState title={t('template')} description={t('templateElsewhere')}>
          <Button asChild size="sm" variant="outline">
            <Link href={pipelinePath(data.id)}>{t('openTemplate')}</Link>
          </Button>
        </EmptyState>
      </Box>
    );
  const editable =
    data.projectId === null ? team.data?.permissions.actions.edit === true : can('actions', 'edit');
  const roles = usage.data?.find((entry) => entry.pipeline.id === data.id)?.roles;

  return <PipelineEditor pipeline={data} editable={editable} projectRoles={roles} />;
}
