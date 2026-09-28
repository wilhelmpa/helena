'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import { useDeletePipeline } from '@/services/pipelines.service';
import { pipelinePath } from '@/utils/paths';
import { usePipelineLabels } from '../../hooks/usePipelineLabels';
import { stepCount } from '../../utils/editorState';
import { Inline, Text } from '@/design-system';

export default function PipelineTemplateRow({
  pipeline,
  canDelete,
}: {
  pipeline: Pipeline;
  canDelete: boolean;
}) {
  const t = useTranslations('pipelines.library');
  const labels = usePipelineLabels();
  const remove = useDeletePipeline();
  const [deleting, setDeleting] = useState(false);

  return (
    <Inline
      as="li"
      gap={2}
      padX={3}
      padY={3}
      align="start"
      className="transition-colors hover:bg-accent"
    >
      <Link href={pipelinePath(pipeline.id)} className="min-w-0 flex-1 space-y-1 text-sm">
        <span className="block font-medium" dir="auto">
          {pipeline.name}
        </span>
        {pipeline.description && (
          <span className="line-clamp-2 block text-muted-foreground" dir="auto">
            {pipeline.description}
          </span>
        )}
        <Text as="span" size="xs" tone="muted" className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{labels.trigger(pipeline.definition.trigger)}</Badge>
          <span>{t('steps', { count: stepCount(pipeline.definition.steps) })}</span>
          <span>{t('version', { version: pipeline.version })}</span>
        </Text>
      </Link>
      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          aria-label={t('delete')}
          title={t('delete')}
          onClick={() => setDeleting(true)}
        >
          <Trash2 />
        </Button>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('deleteTitle')}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await remove.mutateAsync(pipeline.id);
            setDeleting(false);
          }}
          onClose={() => setDeleting(false)}
        >
          <Text as="p" size="sm" tone="muted">
            {t('deleteConfirm', { name: pipeline.name })}
          </Text>
        </ConfirmDialog>
      )}
    </Inline>
  );
}
