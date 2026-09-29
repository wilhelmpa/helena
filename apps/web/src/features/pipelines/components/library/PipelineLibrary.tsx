'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import SectionPageView from '@/components/common/page/SectionPageView';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useTeamQuery } from '@/services/teams.service';
import { pipelinePath } from '@/utils/paths';
import { useNewPipeline } from '../../hooks/useNewPipeline';
import PipelineBuiltinList from './PipelineBuiltinList';
import PipelineTemplateList from './PipelineTemplateList';
import AutomationKinds from './AutomationKinds';
import { Stack, Text } from '@/design-system';

// The team's library of workflow templates: its own templates, then the ones Helena
// ships to add. "Neue Vorlage" is the page's one primary action, in the header row.
export default function PipelineLibrary({ teamId }: { teamId: number }) {
  const t = useTranslations('pipelines.library');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const permissions = useTeamQuery(teamId).data?.permissions.actions;
  const create = useCreatePipelineTemplate(teamId);
  const { starter } = useNewPipeline();
  const [creating, setCreating] = useState(false);

  return (
    <SectionPageView title={tNav('workflows')} wide>
      {permissions?.create ? (
        <PageToolbar>
          <PageToolbarSpacer />
          <PageActions
            primary={{
              id: 'new',
              label: t('newTemplate'),
              icon: Plus,
              onClick: () => setCreating(true),
            }}
          />
        </PageToolbar>
      ) : null}
      {!permissions ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <EmptyState title={t('noAccessTitle')} description={t('noAccess')} />
      ) : (
        <Stack gap={6}>
          <AutomationKinds />
          <PipelineTemplateList teamId={teamId} canDelete={permissions.delete} />
          <PipelineBuiltinList teamId={teamId} canCreate={permissions.create} />
          {!permissions.create && (
            <Text as="p" size="xs" tone="muted" className="px-2">
              {t('readOnly')}
            </Text>
          )}
        </Stack>
      )}
      {creating && (
        <NameDialog
          title={t('newTemplate')}
          description={t('newTemplateDescription')}
          label={t('name')}
          maxLength={120}
          submitLabel={t('create')}
          onSubmit={async (name) => {
            const created = await create.mutateAsync(starter(name));
            router.push(pipelinePath(created.id));
          }}
          onClose={() => setCreating(false)}
        />
      )}
    </SectionPageView>
  );
}
