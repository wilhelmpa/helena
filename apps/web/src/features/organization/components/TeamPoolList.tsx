'use client';

import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Text } from '@/design-system';
import { AgentSectionProvider } from '@/features/teams/context/agentSection';
import TeamAiAgents from '@/features/teams/components/ai-agents/TeamAiAgents';
import { TeamAiAgentSheet } from '@/features/teams/components/ai-agents/TeamAiAgentSheet';
import { TemplateBundleImportDialog } from '@/features/teams/components/ai-agents/TemplateBundleDialog';
import type { PoolShow } from '@/features/teams/utils/agentPool';

export type PoolCreation = { projectId?: number; asTemplate?: boolean } | null;

// Team › Liste (Auftrag 117): the agent pool — every agent of the team and the templates
// projects copy their specialists from — as one list under the Team toolbar, with the
// same search and filter. A new agent or template opens in the one overlay on the right.
export default function TeamPoolList({
  teamId,
  projectKey,
  search,
  show,
  creating,
  onCreatingChange,
  importing,
  onImportingChange,
  onlyOverlays = false,
}: {
  teamId: number;
  projectKey: string | null;
  search: string;
  show: PoolShow;
  creating: PoolCreation;
  onCreatingChange: (next: PoolCreation) => void;
  importing: boolean;
  onImportingChange: (open: boolean) => void;
  // Only the overlay of a new agent (started from the tree or the ring), no list.
  onlyOverlays?: boolean;
}) {
  const t = useTranslations('teams');
  const permissions = useTeamQuery(teamId).data?.permissions.ai_agents;
  if (!permissions) return <ListSkeleton rows={3} rowClassName="h-12" />;
  if (!permissions.read)
    return (
      <Text size="sm" tone="muted">
        {t('agents.noAccess')}
      </Text>
    );
  return (
    <AgentSectionProvider teamId={teamId} permissions={permissions}>
      {!onlyOverlays && (
        <div className="ds-team-pool">
          <TeamAiAgents search={search} show={show} projectKey={projectKey} />
        </div>
      )}
      <TeamAiAgentSheet
        open={creating != null}
        agent={null}
        projectId={creating?.projectId}
        asTemplate={creating?.asTemplate}
        onClose={() => onCreatingChange(null)}
      />
      <TemplateBundleImportDialog
        teamId={teamId}
        open={importing}
        onOpenChange={onImportingChange}
      />
    </AgentSectionProvider>
  );
}
