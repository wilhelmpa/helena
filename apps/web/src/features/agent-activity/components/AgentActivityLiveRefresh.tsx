import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';

// Refetches a timeline when a run of the project changes or a workflow run reports
// back. One per project, so Home can watch several.
export default function AgentActivityLiveRefresh({
  projectId,
  projectKey,
}: {
  projectId: number;
  projectKey: string | null;
}) {
  const targets = [qk.agentActivityAll(projectKey)];
  useLiveRefresh({ scope: revScope.agentRuns(projectId), targets });
  useLiveRefresh({ scope: revScope.controlPlane(projectId), targets });
  return null;
}
