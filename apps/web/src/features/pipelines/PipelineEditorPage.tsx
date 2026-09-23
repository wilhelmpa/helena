'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import PipelineEditorLoader from './components/editor/PipelineEditorLoader';

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
  if (projectKey) return <PipelineEditorLoader pipelineId={pipelineId} projectKey={projectKey} />;
  return (
    <Shell globalHome globalTitle={t('workflows')} autoOpenGlobalChat={false}>
      <PipelineEditorLoader pipelineId={pipelineId} projectKey={null} />
    </Shell>
  );
}
