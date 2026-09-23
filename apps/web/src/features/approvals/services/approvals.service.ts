import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageParams } from '@/lib/api/core/paging';
import {
  decideApproval,
  listApprovals,
  type ApprovalDecision,
  type ApprovalListStatus,
  type WorkflowGate,
  type WorkflowGateList,
} from '@/lib/api/endpoints/approvals';
import { decideWorkflow } from '@/lib/api/endpoints/controlPlaneWorkflows';
import { qk } from '@/services/queryKeys';
import { withoutGate } from '../utils/workflowGates';

export const useApprovals = (status: ApprovalListStatus, params: PageParams) =>
  useQuery({
    queryKey: qk.approvals(status, params),
    queryFn: () => listApprovals(params, status),
  });

export function useDecideApproval() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: ApprovalDecision }) =>
      decideApproval(id, decision),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.anyApprovals }),
  });
}

export function useDecideWorkflowGate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ gate, decision }: { gate: WorkflowGate; decision: ApprovalDecision }) =>
      decideWorkflow(
        gate.projectKey,
        gate.workflowId,
        gate.runId,
        decision.approved,
        decision.note,
      ),
    onSuccess: (_, { gate }) => {
      client.setQueryData<WorkflowGateList>(qk.workflowGates, (list) => withoutGate(list, gate));
      return client.invalidateQueries({
        queryKey: qk.controlPlaneWorkflowRuns(gate.projectKey, gate.workflowId),
      });
    },
  });
}
