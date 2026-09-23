import { useQuery } from '@tanstack/react-query';
import { getPendingApprovalCount, listWorkflowGates } from '@/lib/api/endpoints/approvals';
import { qk } from '@/services/queryKeys';

export const usePendingApprovalCount = () =>
  useQuery({ queryKey: qk.approvalsPendingCount, queryFn: getPendingApprovalCount });

// Reading the gates asks the control plane for the runs of every enabled workflow, so
// the answer is kept for a minute rather than read again on every mount.
export const useWorkflowGates = () =>
  useQuery({ queryKey: qk.workflowGates, queryFn: listWorkflowGates, staleTime: 60_000 });
