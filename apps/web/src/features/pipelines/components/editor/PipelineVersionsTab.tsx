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
    return <p className="text-sm text-muted-foreground">{t('versions.empty')}</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {versions.data.map((version) => (
        <li key={version.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
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
        </li>
      ))}
    </ul>
  );
}
