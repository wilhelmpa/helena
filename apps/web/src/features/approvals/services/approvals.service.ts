import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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

export const useApprovals = (status: ApprovalListStatus, params: PageParams, projectKey?: string) =>
  useQuery({
    queryKey: qk.approvals(status, params, projectKey),
    queryFn: () => listApprovals(params, status, projectKey),
  });

// The decided card leaves the list before a caller's own onSuccess would run, so the
// confirmation is shown here.
export function useDecideApproval() {
  const client = useQueryClient();
  const t = useTranslations('approvals');
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: ApprovalDecision }) =>
      decideApproval(id, decision),
    onSuccess: (_, { decision }) => {
      toast.success(t(decision.approved ? 'approvedToast' : 'rejectedToast'));
      return Promise.all([
        client.invalidateQueries({ queryKey: qk.approvalLists }),
        client.invalidateQueries({ queryKey: qk.approvalsPendingCountAll }),
      ]);
    },
  });
}

export function useDecideWorkflowGate() {
  const client = useQueryClient();
  const t = useTranslations('approvals');
  return useMutation({
    mutationFn: ({ gate, decision }: { gate: WorkflowGate; decision: ApprovalDecision }) =>
      decideWorkflow(
        gate.projectKey,
        gate.workflowId,
        gate.runId,
        decision.approved,
        decision.note,
      ),
    onSuccess: (_, { gate, decision }) => {
      toast.success(t(decision.approved ? 'gateApprovedToast' : 'gateRejectedToast'));
      client.setQueryData<WorkflowGateList>(qk.workflowGates, (list) => withoutGate(list, gate));
      return client.invalidateQueries({
        queryKey: qk.controlPlaneWorkflowRuns(gate.projectKey, gate.workflowId),
      });
    },
  });
}
