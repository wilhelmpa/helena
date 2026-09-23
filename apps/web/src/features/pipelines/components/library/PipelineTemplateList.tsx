'use client';

import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { usePipelineTemplates } from '@/services/pipelines.service';
import PipelineTemplateRow from './PipelineTemplateRow';

export default function PipelineTemplateList({
  teamId,
  canDelete,
}: {
  teamId: number;
  canDelete: boolean;
}) {
  const t = useTranslations('pipelines.library');
  const templates = usePipelineTemplates(teamId);
  const rows = templates.data ?? [];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t('templates')}</h2>
      {templates.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-14" />
      ) : templates.isError ? (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {t('loadFailed')}
          <Button size="sm" variant="outline" onClick={() => void templates.refetch()}>
            {t('tryAgain')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-4 text-sm">
          <p className="font-medium">{t('empty')}</p>
          <p className="text-muted-foreground">{t('emptyHint')}</p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((pipeline) => (
            <PipelineTemplateRow key={pipeline.id} pipeline={pipeline} canDelete={canDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}
