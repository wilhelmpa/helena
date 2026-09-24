'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import { useIntegrationCatalogQuery } from '@/services/integrations.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import { ToolConfigDialog } from './ToolConfigDialog';
import TeamAgentTools from './TeamAgentTools';
import TeamMcpServers from './TeamMcpServers';
import { ToolSectionHeader } from './ToolSectionHeader';

// The tools of a team: the MCP servers its Hermes agents start, and the external
// integrations the agents of its projects call, each bound to one of the team's
// credentials.
export default function TeamAgentToolsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const { data: team } = useTeamQuery(teamId);
  const permissions = team?.permissions.agent_tools;
  // The catalog names the tools and their integrations, so it is fetched for anyone
  // who may read the list or add a tool.
  const canSee = !!permissions && (permissions.read || permissions.create);
  const catalog = useIntegrationCatalogQuery(canSee ? teamId : null).data ?? [];
  const [creating, setCreating] = useState(false);

  return (
    <SectionPageView
      title={t('sections.agentTools.title')}
      wide
    >
      {!permissions ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <p className="text-sm text-muted-foreground">{t('tools.noAccess')}</p>
      ) : (
        <div className="space-y-6">
          <TeamMcpServers
            teamId={teamId}
            canManage={team?.role === 'owner' || team?.role === 'manager'}
          />
          <section className="space-y-3">
            <ToolSectionHeader
              title={t('tools.title')}
              hint={t('tools.hint')}
              action={
                permissions.create ? (
                  <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                    <Plus className="size-3.5" />
                    {t('tools.add')}
                  </Button>
                ) : undefined
              }
            />
            <TeamAgentTools teamId={teamId} catalog={catalog} permissions={permissions} />
          </section>
        </div>
      )}

      {creating && team && (
        <ToolConfigDialog
          teamId={teamId}
          teamName={team.name}
          catalog={catalog}
          onClose={() => setCreating(false)}
        />
      )}
    </SectionPageView>
  );
}
