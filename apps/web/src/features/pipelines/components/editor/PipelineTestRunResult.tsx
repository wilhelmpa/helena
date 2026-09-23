'use client';

import { useTranslations } from 'next-intl';
import PipelineRunTimeline from '@/components/common/pipeline-runs/PipelineRunTimeline';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { usePipelineRun } from '@/services/pipelines.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';

// The test run as it goes: every step Mastra reports moves the project's control-plane
// revision, which reads the run again.
export default function PipelineTestRunResult({
  runId,
  onAgain,
}: {
  runId: string;
  onAgain: () => void;
}) {
  const t = useTranslations('pipelines.testRun');
  const run = usePipelineRun(runId);
  useLiveRefresh({
    scope: run.data ? revScope.controlPlane(run.data.projectId) : null,
    targets: [qk.pipelineRun(runId)],
  });
  if (!run.data) return <ListSkeleton rows={2} rowClassName="h-16" />;

  return (
    <div className="space-y-3">
      <PipelineRunTimeline run={run.data} canEdit showIssue />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onAgain}>
          {t('again')}
        </Button>
      </div>
    </div>
  );
}
