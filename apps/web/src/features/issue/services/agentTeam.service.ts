// The Mastra agent-team runs of one issue. A stage that starts or writes its result to
// the issue changes the project's control-plane revision, which reloads them.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listIssueAgentTeamRuns, startIssueAgentTeam } from '@/lib/api/endpoints/issues';
import { qk } from '@/services/queryKeys';

export function useIssueAgentTeamRuns(issueId: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.issueAgentTeamRuns(issueId),
    queryFn: () => listIssueAgentTeamRuns(issueId),
    enabled,
  });
}

export function useStartIssueAgentTeam(issueId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => startIssueAgentTeam(issueId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.issueAgentTeamRuns(issueId) }),
  });
}
