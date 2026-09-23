'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import { usePipeline, useProjectPipelines } from '@/services/pipelines.service';
import { useTeamQuery } from '@/services/teams.service';
import { pipelinePath } from '@/utils/paths';
import PipelineEditor from './PipelineEditor';

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
  const pipeline = usePipeline(pipelineId);
  const team = useTeamQuery(pipeline.data?.projectId === null ? pipeline.data.teamId : null);
  const usage = useProjectPipelines(projectKey);
  const { can } = usePermissions();

  if (pipeline.isPending) return <ListSkeleton rows={4} rowClassName="h-14" className="p-4" />;
  if (pipeline.isError) return <p className="p-4 text-sm text-destructive">{t('loadFailed')}</p>;
  const data = pipeline.data;
  if (projectKey && data.projectId === null)
    return (
      <div className="space-y-3 p-4 text-sm">
        <p className="text-muted-foreground">{t('templateElsewhere')}</p>
        <Button asChild size="sm" variant="outline">
          <Link href={pipelinePath(data.id)}>{t('openTemplate')}</Link>
        </Button>
      </div>
    );
  const editable =
    data.projectId === null ? team.data?.permissions.actions.edit === true : can('actions', 'edit');
  const roles = usage.data?.find((entry) => entry.pipeline.id === data.id)?.roles;

  return <PipelineEditor pipeline={data} editable={editable} projectRoles={roles} />;
}
