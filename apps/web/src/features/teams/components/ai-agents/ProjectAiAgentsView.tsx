'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import { AI_AGENTS_SECTION } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
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

  return (
    <SectionPageView
      title={sectionText.label}
      description={sectionText.description}
      wide
      actions={
        permissions?.create ? (
          <div className="flex items-center gap-2">
            <ProjectAgentTemplateDialog teamId={teamId} projectId={projectId} />
            <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              {t('newAgent')}
            </Button>
          </div>
        ) : undefined
      }
    >
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
