'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import { pipelinesPath, workflowsPath } from '@/utils/paths';

export default function PipelineEditorMeta({
  pipeline,
  dirty,
}: {
  pipeline: Pipeline;
  dirty: boolean;
}) {
  const t = useTranslations('pipelines.editor');
  const back = pipeline.projectKey ? workflowsPath(pipeline.projectKey) : pipelinesPath();

  return (
    <span className="flex flex-wrap items-center gap-x-2">
      <Link href={back} className="hover:text-foreground hover:underline">
        {t('back')}
      </Link>
      <span>·</span>
      <span>{pipeline.projectId === null ? t('template') : t('projectWorkflow')}</span>
      <span>·</span>
      <span>{t('version', { version: pipeline.version })}</span>
      {dirty && (
        <>
          <span>·</span>
          <span className="text-foreground">{t('unsaved')}</span>
        </>
      )}
    </span>
  );
}
