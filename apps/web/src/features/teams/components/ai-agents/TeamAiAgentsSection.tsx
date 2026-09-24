'use client';

import { useState } from 'react';
import { Download, Plus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { AgentSectionProvider } from '../../context/agentSection';
import TeamAiAgents from './TeamAiAgents';
import { TeamAiAgentSheet } from './TeamAiAgentSheet';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { TemplateBundleImportDialog, useTemplateBundleExport } from './TemplateBundleDialog';

// The agents of a team: created, configured and attached to the team's projects here,
// because the team owns them and their key reaches every project it attaches them to.
export default function TeamAiAgentsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const { data: team } = useTeamQuery(teamId);
  const permissions = team?.permissions.ai_agents;
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const exporting = useTemplateBundleExport(teamId);

  return (
    <SectionPageView title={t('sections.agents.title')} wide>
      <PageToolbar>
        <PageToolbarSpacer />
        <PageActions
          actions={[
            ...(permissions?.create
              ? [
                  {
                    id: 'import-templates',
                    label: t('templateBundles.importAction'),
                    icon: Upload,
                    onClick: () => setImporting(true),
                  },
                ]
              : []),
            ...(permissions?.read
              ? [
                  {
                    id: 'export-templates',
                    label: t('templateBundles.exportAction'),
                    icon: Download,
                    disabled: exporting.isPending,
                    onClick: () => exporting.mutate(),
                  },
                ]
              : []),
          ]}
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
          <TemplateBundleImportDialog
            teamId={teamId}
            open={importing}
            onOpenChange={setImporting}
          />
        </AgentSectionProvider>
      )}
    </SectionPageView>
  );
}
