'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { useShell } from '@/context/shellContext';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useCreateProjectPipeline,
  usePipelineContext,
  useProjectPipelines,
} from '@/services/pipelines.service';
import { qk } from '@/services/queryKeys';
import { projectPipelinePath } from '@/utils/paths';
import { revScope } from '@/utils/revScopes';
import PipelineProjectRow from './components/project/PipelineProjectRow';
import WorkflowRunLimitSettings from './components/project/WorkflowRunLimitSettings';
import { useNewPipeline } from './hooks/useNewPipeline';

// The workflow builder on a project's Workflows page: the templates of the team's
// library and the project's own workflows, each turned on or off here with the agents
// of its roles. "Workflow erstellen" is the page's one primary action, in the header row.
export default function ProjectPipelinesPanel() {
  const t = useTranslations('pipelines.project');
  const router = useRouter();
  const { project } = useShell();
  const projectKey = project?.project.key ?? '';
  const { can } = usePermissions();
  const pipelines = useProjectPipelines(projectKey);
  const context = usePipelineContext({ projectKey }).data;
  const create = useCreateProjectPipeline(projectKey);
  const { starter } = useNewPipeline();
  const [creating, setCreating] = useState(false);
  useLiveRefresh({
    scope: project ? revScope.controlPlane(project.project.id) : null,
    targets: [qk.projectPipelines(projectKey)],
  });
  if (!project) return null;
  const editable = can('actions', 'edit');

  return (
    <section className="mb-6 space-y-3 border-b pb-6">
      {can('actions', 'create') && (
        <PageToolbar>
          <PageToolbarSpacer />
          <PageActions
            primary={{
              id: 'new',
              label: t('create'),
              icon: Plus,
              onClick: () => setCreating(true),
            }}
          />
        </PageToolbar>
      )}
      <div>
        <h2 className="text-md font-medium">{t('title')}</h2>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
        {!editable && <p className="mt-1 text-xs text-muted-foreground">{t('readOnly')}</p>}
      </div>
      <WorkflowRunLimitSettings projectKey={projectKey} editable={editable} />
      {pipelines.isPending ? null : pipelines.isError ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-destructive">
          {t('loadFailed')}
        </p>
      ) : !pipelines.data.length ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {pipelines.data.map((entry) => (
            <PipelineProjectRow
              key={entry.pipeline.id}
              entry={entry}
              projectKey={projectKey}
              agents={context?.agents ?? []}
              editable={editable}
            />
          ))}
        </div>
      )}
      {creating && (
        <NameDialog
          title={t('create')}
          description={t('createDescription')}
          label={t('name')}
          maxLength={120}
          submitLabel={t('create')}
          onSubmit={async (name) => {
            const created = await create.mutateAsync(starter(name));
            router.push(projectPipelinePath(projectKey, created.id));
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </section>
  );
}
