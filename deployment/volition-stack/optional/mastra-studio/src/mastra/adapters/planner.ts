import type { WorkEnvelope, WorkflowId } from '../contracts.ts';

export type PlannerOperation = 'classify' | 'research' | 'draft' | 'audit' | 'file';

export interface PlannerRequest {
  operation: PlannerOperation;
  workflowId: WorkflowId;
  envelope: WorkEnvelope;
  instructions: string;
}

export interface PlannerResult {
  mode: 'dry-run';
  summary: string;
  artifacts: Array<{ type: 'note' | 'draft' | 'report'; title: string }>;
}

export interface PlannerAdapter {
  plan(request: PlannerRequest): Promise<PlannerResult>;
}

export const dryRunPlannerAdapter: PlannerAdapter = {
  async plan(request) {
    return {
      mode: 'dry-run',
      summary: `${request.operation} planned for ${request.workflowId}; no executor call was made`,
      artifacts: [{ type: 'report', title: `${request.workflowId} dry-run plan` }],
    };
  },
};
