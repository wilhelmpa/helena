'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { useProjectAgents } from '@/hooks/useProjectAgents';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SectionPageView from '@/components/common/page/SectionPageView';
import AgentActivityTimeline from './components/AgentActivityTimeline';

export default function ProjectAgentActivityPage() {
  const t = useTranslations('agentActivity');
  const { project } = useShell();
  const agents = useProjectAgents();
  if (!project) return null;

  return (
    <SectionPageView title={t('title')} description={t('projectDescription')}>
      <RequirePermission resource="ai_agents" action="read">
        <AgentActivityTimeline
          projectKey={project.project.key}
          projectIds={[project.project.id]}
          agents={agents.data ?? []}
        />
      </RequirePermission>
    </SectionPageView>
  );
}
