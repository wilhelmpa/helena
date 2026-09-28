'use client';

import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { AgentSectionProvider } from '@/features/teams/context/agentSection';
import { AgentSettingsBody } from '@/features/teams/components/ai-agents/TeamAiAgentSheet';

// One agent's settings as a section of the settings modal, with the team's permissions
// the agent editor reads. Saving writes through the same form as the agent sheet.
export default function AgentSettingsModalContent({
  teamId,
  agentId,
}: {
  teamId: number;
  agentId: number;
}) {
  const t = useTranslations('teams');
  const permissions = useTeamQuery(teamId).data?.permissions.ai_agents;
  const agents = useAiAgentsQuery(teamId);
  const agent = agents.data?.find((entry) => entry.id === agentId);
  if (!permissions || agents.isPending) return <ListSkeleton rows={4} rowClassName="h-12" />;
  if (!permissions.read || !agent) {
    return <p className="text-sm text-muted-foreground">{t('agents.noAccess')}</p>;
  }
  return (
    <AgentSectionProvider teamId={teamId} permissions={permissions}>
      <div className="flex min-h-[520px] flex-col">
        <AgentSettingsBody agent={agent} />
      </div>
    </AgentSectionProvider>
  );
}
