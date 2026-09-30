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
import WorkflowSigningSecretSettings from './components/project/WorkflowSigningSecretSettings';
import { useNewPipeline } from './hooks/useNewPipeline';
import { EmptyState, Notice, Sections, SettingsGroup, Stack } from '@/design-system';

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
    <Sections as="section">
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
      <SettingsGroup
        title={t('title')}
        description={editable ? t('hint') : `${t('hint')} ${t('readOnly')}`}
      >
        <WorkflowRunLimitSettings projectKey={projectKey} editable={editable} />
        <WorkflowSigningSecretSettings projectKey={projectKey} editable={editable} />
      </SettingsGroup>
      {pipelines.isPending ? null : pipelines.isError ? (
        <Notice tone="danger">{t('loadFailed')}</Notice>
      ) : !pipelines.data.length ? (
        <EmptyState boxed>{t('empty')}</EmptyState>
      ) : (
        <Stack gap={4}>
          {pipelines.data.map((entry) => (
            <PipelineProjectRow
              key={entry.pipeline.id}
              entry={entry}
              projectKey={projectKey}
              agents={context?.agents ?? []}
              editable={editable}
            />
          ))}
        </Stack>
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
    </Sections>
  );
}
