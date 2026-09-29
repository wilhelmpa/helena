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
import { Stack, Text } from '@/design-system';

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
    <Stack as="section" gap={3} marginBottom={5} padBottom={5} className="border-b">
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
        <Text as="p" size="xs" tone="muted">
          {t('hint')}
        </Text>
        {!editable && (
          <Text as="p" size="xs" tone="muted" className="mt-1">
            {t('readOnly')}
          </Text>
        )}
      </div>
      <WorkflowRunLimitSettings projectKey={projectKey} editable={editable} />
      <WorkflowSigningSecretSettings projectKey={projectKey} editable={editable} />
      {pipelines.isPending ? null : pipelines.isError ? (
        <Text as="p" size="sm" tone="danger" className="rounded-md border bg-card px-3 py-2">
          {t('loadFailed')}
        </Text>
      ) : !pipelines.data.length ? (
        <Text as="p" size="sm" tone="muted" className="rounded-md border bg-card px-3 py-2">
          {t('empty')}
        </Text>
      ) : (
        <Stack gap={3}>
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
    </Stack>
  );
}
