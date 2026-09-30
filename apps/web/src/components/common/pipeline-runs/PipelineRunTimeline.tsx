'use client';

import { Card } from '@/design-system';
import type { PipelineRun, PipelineRunStep } from '@/lib/api/endpoints/pipelines';
import ApprovalDecisionForm from '@/components/common/ApprovalDecisionForm';
import { useDecidePipelineApproval } from '@/services/pipelines.service';
import ModelFailureNote from '@/features/model-availability/components/ModelFailureNote';
import { knownFailure } from '@/features/model-availability/utils/modelFailure';
import PipelineRunControls from './PipelineRunControls';
import PipelineRunHeader from './PipelineRunHeader';
import PipelineRunStepItem from './PipelineRunStepItem';

// One run of the engine (a workflow, an agent team or a routine): its header, every
// step it executed in order with the parts of each, and the controls of a member who may
// run it. A run waiting at an approval takes the decision here too.
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
  // The parts of a step (an agent team's stages) are shown under it.
  const steps = run.steps.filter((step) => step.parentStepId === null);
  const parts = (parent: PipelineRunStep) =>
    run.steps.filter(
      (step) => step.parentStepId === parent.stepId && step.iteration === parent.iteration,
    );
  const waitingApproval =
    run.status === 'waiting' &&
    run.steps.some((step) => step.kind === 'approval' && step.status === 'waiting');

  return (
    <Card as="article" pad="tight">
      <PipelineRunHeader run={run} showIssue={showIssue} />
      {knownFailure(run.failure) ? (
        <ModelFailureNote
          failure={run.failure}
          error={run.error}
          className="text-xs text-destructive"
        />
      ) : (
        run.error && (
          <p className="text-xs text-destructive" dir="auto">
            {run.error}
          </p>
        )
      )}
      {steps.length > 0 && (
        <ol className="space-y-2 border-s ps-3">
          {steps.map((step) => (
            <PipelineRunStepItem
              key={`${step.stepId}:${step.iteration}`}
              step={step}
              parts={parts(step)}
            />
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
    </Card>
  );
}
