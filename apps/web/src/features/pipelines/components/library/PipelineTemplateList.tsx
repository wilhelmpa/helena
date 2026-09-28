'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
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
    <section className="min-w-0">
      <SectionLabel
        trailing={
          rows.length > 0 ? (
            <span className="font-mono text-xs tabular-nums">{rows.length}</span>
          ) : null
        }
      >
        {t('templates')}
      </SectionLabel>
      {templates.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-14" />
      ) : templates.isError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm text-destructive">
          {t('loadFailed')}
          <Button size="sm" variant="outline" onClick={() => void templates.refetch()}>
            {t('tryAgain')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('emptyHint')}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-md border bg-card">
          {rows.map((pipeline) => (
            <PipelineTemplateRow key={pipeline.id} pipeline={pipeline} canDelete={canDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}
