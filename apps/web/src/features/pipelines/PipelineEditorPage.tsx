'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import PipelineEditorLoader from './components/editor/PipelineEditorLoader';
import { Page } from '@/design-system';

// The editor of one workflow. A template of the library opens in Home; a project's own
// workflow opens inside its project, whose Shell the project layout provides.
export default function PipelineEditorPage({
  pipelineId,
  projectKey,
}: {
  pipelineId: number;
  projectKey?: string;
}) {
  const t = useTranslations('nav');
  if (projectKey)
    return (
      <Page variant="fill" title={t('workflows')}>
        <PipelineEditorLoader pipelineId={pipelineId} projectKey={projectKey} />
      </Page>
    );
  return (
    <Shell globalHome globalTitle={t('workflows')} autoOpenGlobalChat={false}>
      <Page variant="fill" title={t('workflows')}>
        <PipelineEditorLoader pipelineId={pipelineId} projectKey={null} />
      </Page>
    </Shell>
  );
}
