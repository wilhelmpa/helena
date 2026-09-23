import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';

// Reads the approval requests again when one of the team's projects gets or decides one,
// and the waiting workflow approval steps with them. The workflow gates are left out:
// reading them asks the control plane.
export default function SidebarApprovalsRefresh({ teamId }: { teamId: number }) {
  useLiveRefresh({
    scope: revScope.approvals(teamId),
    targets: [qk.approvalsPendingCountAll, qk.approvalLists, qk.pipelineApprovals],
  });
  return null;
}
