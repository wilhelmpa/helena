'use client';

import { RotateCcw, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useCancelPipelineRun, useRetryPipelineRun } from '@/services/pipelines.service';

const ACTIVE = ['pending', 'running', 'waiting'];

// Cancels a run that is still going, or retries a failed one from the step that failed.
export default function PipelineRunControls({ run }: { run: { id: string; status: string } }) {
  const t = useTranslations('pipelines.runs');
  const cancel = useCancelPipelineRun();
  const retry = useRetryPipelineRun();
  const active = ACTIVE.includes(run.status);
  if (!active && run.status !== 'failed') return null;

  return (
    <div className="flex justify-end gap-2">
      {active && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-muted-foreground hover:text-foreground"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(run.id)}
        >
          <Square /> {t('cancel')}
        </Button>
      )}
      {run.status === 'failed' && (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={retry.isPending}
          onClick={() => retry.mutate(run.id)}
        >
          <RotateCcw /> {t('retry')}
        </Button>
      )}
    </div>
  );
}
