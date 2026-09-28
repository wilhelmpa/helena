'use client';

import { useTranslations } from 'next-intl';
import { usePipelineEditor } from '../../context/pipelineEditor';
import { ROOT_LANE } from '../../utils/editorState';
import PipelineCard from './PipelineCard';
import PipelineStepLane from './PipelineStepLane';
import { Text } from '@/design-system';

export default function PipelineStepsCard() {
  const t = useTranslations('pipelines.steps');
  const { definition } = usePipelineEditor();

  return (
    <PipelineCard title={t('title')}>
      {definition.steps.length === 0 && (
        <Text as="p" size="sm" tone="muted">
          {t('empty')}
        </Text>
      )}
      <PipelineStepLane lane={ROOT_LANE} steps={definition.steps} />
    </PipelineCard>
  );
}
