'use client';

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import type { Pipeline, PipelineContext } from '@/lib/api/endpoints/pipelines';
import { usePipelineVersion } from '@/services/pipelines.service';
import { formatDateTime } from '@/utils/dates';
import { PipelineEditorProvider } from '../../context/pipelineEditor';
import PipelineBuilder from './PipelineBuilder';

// One saved version in the builder, read-only.
export default function PipelineVersionView({
  pipeline,
  version,
  context,
  onBack,
}: {
  pipeline: Pipeline;
  version: number;
  context: PipelineContext | undefined;
  onBack: () => void;
}) {
  const t = useTranslations('pipelines.versions');
  const detail = usePipelineVersion(pipeline.id, version);
  const [selectedId, select] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" className="h-7" onClick={onBack}>
          <ArrowLeft className="rtl:rotate-180" /> {t('back')}
        </Button>
        {detail.data && (
          <p className="text-sm text-muted-foreground">
            {t('viewing', { version, date: formatDateTime(detail.data.createdAt) })}
          </p>
        )}
      </div>
      {detail.data ? (
        <PipelineEditorProvider
          value={{
            definition: detail.data.definition,
            template: pipeline.projectId === null,
            context,
            issues: [],
            editable: false,
            selectedId,
            select,
            change: () => {},
          }}
        >
          <PipelineBuilder />
        </PipelineEditorProvider>
      ) : (
        <ListSkeleton rows={4} rowClassName="h-14" />
      )}
    </div>
  );
}
