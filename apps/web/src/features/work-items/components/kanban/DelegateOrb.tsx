import Orb from '@/components/helena/Orb';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useAgentStatus } from '@/utils/helenaStatus';

export function DelegateOrb({
  teamId,
  projectId,
  userId,
}: {
  teamId: number | null;
  projectId: number;
  userId: string;
}) {
  const agents = useAiAgentsQuery(teamId, projectId).data ?? [];
  const agent = agents.find((item) => item.userId === userId);
  const status = useAgentStatus(agent?.id ?? 0, {
    runtimeStatus: agent?.runtimeState.status,
  });
  return <Orb state={status} size="small" className="shrink-0" />;
}
