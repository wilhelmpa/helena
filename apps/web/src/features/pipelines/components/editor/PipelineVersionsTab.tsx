'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Pipeline, PipelineContext } from '@/lib/api/endpoints/pipelines';
import { usePipelineVersions } from '@/services/pipelines.service';
import { formatDateTime } from '@/utils/dates';
import PipelineVersionView from './PipelineVersionView';
import { Inline, Text, Card } from '@/design-system';

// Every saved version, newest first. Runs keep the version they started with; an older
// version opens read-only.
export default function PipelineVersionsTab({
  pipeline,
  context,
}: {
  pipeline: Pipeline;
  context: PipelineContext | undefined;
}) {
  const t = useTranslations('pipelines');
  const versions = usePipelineVersions(pipeline.id);
  const [open, setOpen] = useState<number | null>(null);

  if (open !== null)
    return (
      <PipelineVersionView
        pipeline={pipeline}
        version={open}
        context={context}
        onBack={() => setOpen(null)}
      />
    );
  if (versions.isPending) return <ListSkeleton rows={3} />;
  if (!versions.data?.length)
    return (
      <Text as="p" size="sm" tone="muted">
        {t('versions.empty')}
      </Text>
    );

  return (
    <Card as="ul" pad="none" className="divide-y overflow-hidden">
      {versions.data.map((version) => (
        <Inline as="li" gap={3} pad={3} wrap key={version.id} className="text-sm">
          <span className="font-medium">{t('editor.version', { version: version.version })}</span>
          {version.version === pipeline.version && (
            <Badge variant="secondary">{t('versions.current')}</Badge>
          )}
          <span className="text-muted-foreground">
            {formatDateTime(version.createdAt)}
            {version.createdByName &&
              ` · ${t('versions.createdBy', { name: version.createdByName })}`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto h-7"
            onClick={() => setOpen(version.version)}
          >
            {t('versions.open')}
          </Button>
        </Inline>
      ))}
    </Card>
  );
}
