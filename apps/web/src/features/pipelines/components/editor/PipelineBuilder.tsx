'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePipelineEditor } from '../../context/pipelineEditor';
import PipelineIssueSummary from './PipelineIssueSummary';
import PipelineRolesCard from './PipelineRolesCard';
import PipelineStepInspector from './PipelineStepInspector';
import PipelineStepsCard from './PipelineStepsCard';
import PipelineTriggerCard from './PipelineTriggerCard';
import { Box, Overlay, Stack } from '@/design-system';

// The workflow top to bottom: trigger, roles and the steps, with the selected step's
// inspector beside them, or in a sheet on a phone.
export default function PipelineBuilder({ header }: { header?: ReactNode }) {
  const t = useTranslations('pipelines.inspector');
  const { selectedId, select } = usePipelineEditor();
  const isMobile = useIsMobile();

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Stack gap={4} className="min-w-0">
        {header}
        <PipelineIssueSummary />
        <PipelineTriggerCard />
        <PipelineRolesCard />
        <PipelineStepsCard />
      </Stack>
      {isMobile ? (
        selectedId !== null && (
          <Overlay
            label={t('title')}
            tabs={[{ id: 'step', label: t('title') }]}
            onClose={() => select(null)}
          >
            <PipelineStepInspector />
          </Overlay>
        )
      ) : (
        <Box as="aside" pad={4} className="sticky top-0 rounded-md border bg-card">
          <PipelineStepInspector />
        </Box>
      )}
    </div>
  );
}
