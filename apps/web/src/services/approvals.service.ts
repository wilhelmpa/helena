import { useQuery } from '@tanstack/react-query';
import { getPendingApprovalCount, listApprovalProjects } from '@/lib/api/endpoints/approvals';
import { qk } from '@/services/queryKeys';

// Global (no projectKey) or one project's pending count, e.g. for the Home badge and
// a project's own "Approvals" nav badge. `enabled` skips the request outright, for a
// project viewer without decide permission there (no badge to show, so nothing to ask).
export const usePendingApprovalCount = (projectKey?: string, enabled = true) =>
  useQuery({
    queryKey: qk.approvalsPendingCount(projectKey),
    queryFn: () => getPendingApprovalCount(projectKey),
    enabled,
  });

// The projects the caller may decide approvals in, for the global page's project
// filter. Rarely changes within a session, so it is kept a while rather than read on
// every mount.
export const useApprovalProjects = () =>
  useQuery({
    queryKey: qk.approvalProjects,
    queryFn: listApprovalProjects,
    staleTime: 60_000,
  });
