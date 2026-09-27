import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import type { AgentOrbState } from '@/utils/agentStatusOrb';

export function organizationChartState(
  agent: OrganizationAgent,
  entries: AgentActivityEntry[],
  usingTool: boolean,
): AgentOrbState {
  if (agent.runtimeState.status === 'degraded') return 'error';
  const own = entries.filter((entry) => entry.agent?.id === agent.id);
  if (own.some((entry) => entry.status === 'running' || entry.status === 'streaming'))
    return usingTool ? 'tool' : 'thinking';
  if (own.some((entry) => ['waiting', 'suspended', 'pending'].includes(entry.status)))
    return 'waiting';
  if (own[0] && ['failed', 'lost', 'sendFailed'].includes(own[0].status)) return 'error';
  return 'idle';
}
