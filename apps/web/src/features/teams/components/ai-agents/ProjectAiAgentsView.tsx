'use client';

import { useState } from 'react';
import { Copy, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { AI_AGENTS_SECTION } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
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
  const sectionText = useSettingsSectionText()(section.slug);
  const permissions = useTeamQuery(teamId).data?.permissions.ai_agents;
  const [creating, setCreating] = useState(false);
  const [fromTemplate, setFromTemplate] = useState(false);
  const tSettings = useTranslations('settings.agents');
  const hasTemplates = (useAiAgentsQuery(teamId).data ?? []).some((agent) => agent.template);

  return (
    <SectionPageView title={sectionText.label} description={sectionText.description} wide>
      {permissions?.create && (
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
            <ProjectAiAgents />
            <TeamAiAgentSheet
              open={creating}
              agent={null}
              projectId={projectId}
              onClose={() => setCreating(false)}
            />
          </AgentSectionProvider>
        )}
      </RequirePermission>
    </SectionPageView>
  );
}
