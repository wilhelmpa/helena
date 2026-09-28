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
import { Inline, Stack, Text } from '@/design-system';

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
    <Stack gap={4}>
      <Inline gap={3} wrap>
        <Button size="sm" variant="ghost" className="h-7" onClick={onBack}>
          <ArrowLeft className="rtl:rotate-180" /> {t('back')}
        </Button>
        {detail.data && (
          <Text as="p" size="sm" tone="muted">
            {t('viewing', { version, date: formatDateTime(detail.data.createdAt) })}
          </Text>
        )}
      </Inline>
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
    </Stack>
  );
}
