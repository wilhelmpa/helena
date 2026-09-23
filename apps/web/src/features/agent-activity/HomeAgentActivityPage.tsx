'use client';

import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectsQuery } from '@/services/projects.service';
import AgentActivityTimeline from './components/AgentActivityTimeline';

// What the agents of every project the reader works in did. The agent filter lists the
// agents of the one team those projects belong to, and is left out across several.
export default function HomeAgentActivityPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('agentActivity');
  const projects = useProjectsQuery().data ?? [];
  const teamIds = new Set(projects.map((project) => project.teamId));
  const agents = useAiAgentsQuery(teamIds.size === 1 ? [...teamIds][0]! : null);

  return (
    <Shell globalHome globalTitle={tNav('agentActivity')} autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold">{tNav('agentActivity')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('homeDescription')}</p>
          </div>
          <AgentActivityTimeline
            projectKey={null}
            projectIds={projects.map((project) => project.id)}
            agents={agents.data ?? []}
          />
        </div>
      </div>
    </Shell>
  );
}
