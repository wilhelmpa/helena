'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePipelineEditor } from '../../context/pipelineEditor';
import PipelineIssueSummary from './PipelineIssueSummary';
import PipelineRolesCard from './PipelineRolesCard';
import PipelineStepInspector from './PipelineStepInspector';
import PipelineStepsCard from './PipelineStepsCard';
import PipelineTriggerCard from './PipelineTriggerCard';

// The workflow top to bottom: trigger, roles and the steps, with the selected step's
// inspector beside them, or in a sheet on a phone.
export default function PipelineBuilder({ header }: { header?: ReactNode }) {
  const t = useTranslations('pipelines.inspector');
  const { selectedId, select } = usePipelineEditor();
  const isMobile = useIsMobile();

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_20rem] lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-4">
        {header}
        <PipelineIssueSummary />
        <PipelineTriggerCard />
        <PipelineRolesCard />
        <PipelineStepsCard />
      </div>
      {isMobile ? (
        <Sheet open={selectedId !== null} onOpenChange={(open) => !open && select(null)}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{t('title')}</SheetTitle>
            </SheetHeader>
            <div className="px-4 pb-4">
              <PipelineStepInspector />
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <aside className="sticky top-0 rounded-md border bg-card p-4">
          <PipelineStepInspector />
        </aside>
      )}
    </div>
  );
}
