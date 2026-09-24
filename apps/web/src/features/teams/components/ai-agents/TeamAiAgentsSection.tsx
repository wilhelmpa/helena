'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { AgentSectionProvider } from '../../context/agentSection';
import TeamAiAgents from './TeamAiAgents';
import { TeamAiAgentSheet } from './TeamAiAgentSheet';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';

// The agents of a team: created, configured and attached to the team's projects here,
// because the team owns them and their key reaches every project it attaches them to.
export default function TeamAiAgentsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const { data: team } = useTeamQuery(teamId);
  const permissions = team?.permissions.ai_agents;
  const [creating, setCreating] = useState(false);

  return (
    <SectionPageView
      title={t('sections.agents.title')}
      description={t('sections.agents.description')}
      wide
    >
      <PageToolbar>
        <PageToolbarSpacer />
        <PageActions
          primary={
            permissions?.create
              ? {
                  id: 'new',
                  label: t('agents.newAgent'),
                  icon: Plus,
                  onClick: () => setCreating(true),
                }
              : undefined
          }
        />
      </PageToolbar>
      {!permissions ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <p className="text-sm text-muted-foreground">{t('agents.noAccess')}</p>
      ) : (
        <AgentSectionProvider teamId={teamId} permissions={permissions}>
          <TeamAiAgents />
          <TeamAiAgentSheet open={creating} agent={null} onClose={() => setCreating(false)} />
        </AgentSectionProvider>
      )}
    </SectionPageView>
  );
}
