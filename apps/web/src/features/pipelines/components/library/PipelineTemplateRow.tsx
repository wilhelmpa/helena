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
    <li className="flex items-start gap-3 p-3">
      <Link href={pipelinePath(pipeline.id)} className="min-w-0 flex-1 space-y-1">
        <span className="block font-medium hover:underline" dir="auto">
          {pipeline.name}
        </span>
        {pipeline.description && (
          <span className="line-clamp-2 block text-sm text-muted-foreground" dir="auto">
            {pipeline.description}
          </span>
        )}
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{labels.trigger(pipeline.definition.trigger)}</Badge>
          <span>{t('steps', { count: stepCount(pipeline.definition.steps) })}</span>
          <span>{t('version', { version: pipeline.version })}</span>
        </span>
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
          <p className="text-sm text-muted-foreground">
            {t('deleteConfirm', { name: pipeline.name })}
          </p>
        </ConfirmDialog>
      )}
    </li>
  );
}
