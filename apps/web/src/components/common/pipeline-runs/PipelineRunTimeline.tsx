'use client';

import type { PipelineRun } from '@/lib/api/endpoints/pipelines';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';
import { useDecidePipelineApproval } from '@/services/pipelines.service';
import PipelineRunControls from './PipelineRunControls';
import PipelineRunHeader from './PipelineRunHeader';
import PipelineRunStepItem from './PipelineRunStepItem';

// One run of a workflow: its header, every step it executed in order, and the controls
// of a member who may run workflows. A run waiting at an approval takes the decision
// here too.
export default function PipelineRunTimeline({
  run,
  canEdit,
  showIssue = false,
}: {
  run: PipelineRun;
  canEdit: boolean;
  showIssue?: boolean;
}) {
  const decide = useDecidePipelineApproval();
  const waitingApproval =
    run.status === 'waiting' &&
    run.steps.some((step) => step.kind === 'approval' && step.status === 'waiting');

  return (
    <article className="space-y-3 rounded-md border bg-card p-3">
      <PipelineRunHeader run={run} showIssue={showIssue} />
      {run.error && (
        <p className="text-xs text-destructive" dir="auto">
          {run.error}
        </p>
      )}
      {run.steps.length > 0 && (
        <ol className="space-y-2 border-s ps-3">
          {run.steps.map((step) => (
            <PipelineRunStepItem key={`${step.stepId}:${step.iteration}`} step={step} />
          ))}
        </ol>
      )}
      {canEdit && waitingApproval && (
        <ApprovalDecisionForm
          pending={decide.isPending}
          onDecide={(decision) => decide.mutate({ runId: run.id, decision })}
        />
      )}
      {canEdit && <PipelineRunControls run={run} />}
    </article>
  );
}
