'use client';

import { useTranslations } from 'next-intl';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { usePipelineTemplates } from '@/services/pipelines.service';
import PipelineTemplateRow from './PipelineTemplateRow';
import { Workflow } from 'lucide-react';
import { EmptyState, Text, Card } from '@/design-system';

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
        <Card layout="row" pad="tight" className="flex-wrap text-sm text-destructive">
          {t('loadFailed')}
          <Button size="sm" variant="outline" onClick={() => void templates.refetch()}>
            {t('tryAgain')}
          </Button>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Workflow />} fill={false}>
          {t('emptyHint')}
        </EmptyState>
      ) : (
        <Card as="ul" pad="none" className="divide-y overflow-hidden">
          {rows.map((pipeline) => (
            <PipelineTemplateRow key={pipeline.id} pipeline={pipeline} canDelete={canDelete} />
          ))}
        </Card>
      )}
    </section>
  );
}
