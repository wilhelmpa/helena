'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import type { Pipeline } from '@/lib/api/endpoints/pipelines';
import { useStartPipelineRun } from '@/services/pipelines.service';
import PipelineTestRunForm from './PipelineTestRunForm';
import PipelineTestRunResult from './PipelineTestRunResult';

// A test run of the saved version on a task: agent steps are simulated and nothing on
// the task changes. The run is followed live once it started.
export default function PipelineTestRunDialog({
  pipeline,
  onClose,
}: {
  pipeline: Pipeline;
  onClose: () => void;
}) {
  const t = useTranslations('pipelines.testRun');
  const start = useStartPipelineRun();
  const [runId, setRunId] = useState<string | null>(null);

  return (
    <Modal title={t('title')} description={t('hint')} onClose={onClose} wide>
      {runId ? (
        <PipelineTestRunResult runId={runId} onAgain={() => setRunId(null)} />
      ) : (
        <PipelineTestRunForm
          pipeline={pipeline}
          pending={start.isPending}
          onStart={(issueId) =>
            start.mutate(
              { issueId, pipelineId: pipeline.id, dryRun: true },
              { onSuccess: (run) => setRunId(run.id) },
            )
          }
        />
      )}
    </Modal>
  );
}
