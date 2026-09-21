'use client';

import { useShell } from '@/context/shellContext';
import { useTeamQuery } from '@/services/teams.service';
import { AI_AGENTS_SECTION } from '@/utils/settingsSections';
import { useSettingsSectionText } from '@/hooks/useSectionLabels';
import SectionPageView from '@/components/common/page/SectionPageView';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { AgentSectionProvider } from '../../context/agentSection';
import ProjectAiAgents from './ProjectAiAgents';

const section = AI_AGENTS_SECTION;

// The AI agents page (/project/:projectKey/ai-agents), a top-level nav item. Agents
// are created and attached in team settings; their role and instructions are assigned
// here for the active project.
export default function ProjectAiAgentsSection() {
  const { project } = useShell();
  if (!project) return null;
  return <AgentsSection teamId={project.project.teamId} />;
}

function AgentsSection({ teamId }: { teamId: number }) {
  const sectionText = useSettingsSectionText()(section.slug);
  const permissions = useTeamQuery(teamId).data?.permissions.ai_agents;

  return (
    <SectionPageView title={sectionText.label} description={sectionText.description} wide>
      <RequirePermission resource={section.resource} action="read">
        {!permissions ? (
          <ListSkeleton rows={3} rowClassName="h-12" />
        ) : (
          <AgentSectionProvider teamId={teamId} permissions={permissions}>
            <ProjectAiAgents />
          </AgentSectionProvider>
        )}
      </RequirePermission>
    </SectionPageView>
  );
}
