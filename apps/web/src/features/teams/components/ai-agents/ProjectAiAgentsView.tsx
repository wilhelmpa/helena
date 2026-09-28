'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { qk } from '@/services/queryKeys';
import { getOrganization } from '@/lib/api/endpoints/organization';
import OrganizationChart from '@/components/common/organization/OrganizationChart';
import { AI_AGENTS_SECTION } from '@/utils/settingsSections';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { AgentSectionProvider } from '../../context/agentSection';
import ProjectAgentTemplateDialog from './ProjectAgentTemplateDialog';
import ProjectAiAgents from './ProjectAiAgents';
import { TeamAiAgentSheet } from './TeamAiAgentSheet';

const section = AI_AGENTS_SECTION;

export default function ProjectAiAgentsView({
  teamId,
  projectId,
}: {
  teamId: number;
  projectId: number;
}) {
  const t = useTranslations('teams.agents');
  const tNav = useTranslations('nav');
  const tChart = useTranslations('organization.chart');
  const permissions = useTeamQuery(teamId).data?.permissions.ai_agents;
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fromTemplate, setFromTemplate] = useState(false);
  const tSettings = useTranslations('settings.agents');
  const agentQuery = useAiAgentsQuery(teamId);
  const hasTemplates = (agentQuery.data ?? []).some((agent) => agent.template);
  const organization = useQuery({
    queryKey: [...qk.organization(teamId), 'all'],
    queryFn: () => getOrganization(teamId),
  });
  const editing = agentQuery.data?.find((agent) => agent.id === editingId) ?? null;

  return (
    <SectionPageView title={tNav('sidebarTeamDeciders')} wide>
      <span className="project-ai-agents-view" hidden />
      {fromTemplate && (
        <ProjectAgentTemplateDialog
          teamId={teamId}
          projectId={projectId}
          onClose={() => setFromTemplate(false)}
        />
      )}
      <RequirePermission resource={section.resource} action="read">
        {!permissions ? (
          <ListSkeleton rows={3} rowClassName="h-12" />
        ) : (
          <AgentSectionProvider teamId={teamId} permissions={permissions}>
            {organization.data ? (
              <OrganizationChart
                organization={organization.data}
                projectId={projectId}
                onEdit={setEditingId}
              />
            ) : organization.isPending ? (
              <ListSkeleton rows={4} rowClassName="h-12" />
            ) : (
              <p className="text-sm text-muted-foreground">{tChart('loadFailed')}</p>
            )}
            <details className="organization-extra-details mt-7">
              <summary>{tChart('manageAgents')}</summary>
              {permissions.create && (
                <PageToolbar>
                  <PageToolbarSpacer />
                  <PageActions
                    actions={
                      hasTemplates
                        ? [
                            {
                              id: 'template',
                              label: tSettings('newFromTemplate'),
                              icon: Copy,
                              onClick: () => setFromTemplate(true),
                            },
                          ]
                        : []
                    }
                    primary={{
                      id: 'new',
                      label: t('newAgent'),
                      icon: Plus,
                      onClick: () => setCreating(true),
                    }}
                  />
                </PageToolbar>
              )}
              <div className="mt-4">
                <ProjectAiAgents />
              </div>
            </details>
            <TeamAiAgentSheet
              open={creating || editingId != null}
              agent={editing}
              projectId={projectId}
              onClose={() => {
                setCreating(false);
                setEditingId(null);
              }}
            />
          </AgentSectionProvider>
        )}
      </RequirePermission>
    </SectionPageView>
  );
}
