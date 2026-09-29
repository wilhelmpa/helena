'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { usePipelineTemplates } from '@/services/pipelines.service';
import PipelineTemplateRow from './PipelineTemplateRow';
import { Inline, Text } from '@/design-system';

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
            <Text as="span" size="xs" className="font-mono tabular-nums">
              {rows.length}
            </Text>
          ) : null
        }
      >
        {t('templates')}
      </SectionLabel>
      {templates.isPending ? (
        <ListSkeleton rows={3} rowClassName="h-14" />
      ) : templates.isError ? (
        <Inline
          gap={3}
          padX={3}
          padY={2}
          wrap
          className="rounded-md border bg-card text-sm text-destructive"
        >
          {t('loadFailed')}
          <Button size="sm" variant="outline" onClick={() => void templates.refetch()}>
            {t('tryAgain')}
          </Button>
        </Inline>
      ) : rows.length === 0 ? (
        <Text as="p" size="sm" tone="muted" className="rounded-md border bg-card px-3 py-2">
          {t('emptyHint')}
        </Text>
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
