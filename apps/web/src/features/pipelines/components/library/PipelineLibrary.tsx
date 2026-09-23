'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import NameDialog from '@/components/common/overlay/NameDialog';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { useCreatePipelineTemplate } from '@/services/pipelines.service';
import { useTeamQuery } from '@/services/teams.service';
import { pipelinePath } from '@/utils/paths';
import { useNewPipeline } from '../../hooks/useNewPipeline';
import PipelineBuiltinList from './PipelineBuiltinList';
import PipelineTemplateList from './PipelineTemplateList';

export default function PipelineLibrary({ teamId }: { teamId: number }) {
  const t = useTranslations('pipelines.library');
  const tNav = useTranslations('nav');
  const router = useRouter();
  const permissions = useTeamQuery(teamId).data?.permissions.actions;
  const create = useCreatePipelineTemplate(teamId);
  const { starter } = useNewPipeline();
  const [creating, setCreating] = useState(false);

  return (
    <SectionPageView
      title={tNav('workflows')}
      description={t('hint')}
      wide
      actions={
        permissions?.create ? (
          <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            {t('newTemplate')}
          </Button>
        ) : undefined
      }
    >
      {!permissions ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <p className="text-sm text-muted-foreground">{t('noAccess')}</p>
      ) : (
        <div className="space-y-6">
          {!permissions.create && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
          <PipelineTemplateList teamId={teamId} canDelete={permissions.delete} />
          <PipelineBuiltinList teamId={teamId} canCreate={permissions.create} />
        </div>
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
