'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { EmptyState } from '@/components/common/page/EmptyState';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Button } from '@/components/ui/button';
import TeamAiAgentsSection from '@/features/teams/components/ai-agents/TeamAiAgentsSection';
import TeamAgentSkillsSection from '@/features/teams/components/agent-skills/TeamAgentSkillsSection';
import TeamAgentToolsSection from '@/features/teams/components/agent-tools/TeamAgentToolsSection';
import TeamMcpSection from '@/features/teams/components/mcp/TeamMcpSection';
import TeamCredentialsSection from '@/features/teams/components/credentials/TeamCredentialsSection';
import { useTeamsQuery } from '@/services/teams.service';
import { manageTeamsPath } from '@/utils/paths';
import { soleTeamId } from '@/utils/homeTeamScope';

export type HomeTeamSection = 'agents' | 'mcps' | 'tools' | 'skills' | 'credentials';

const sections = {
  agents: TeamAiAgentsSection,
  mcps: TeamMcpSection,
  tools: TeamAgentToolsSection,
  skills: TeamAgentSkillsSection,
  credentials: TeamCredentialsSection,
} satisfies Record<HomeTeamSection, React.ComponentType<{ teamId: number }>>;

const navKeys = {
  agents: 'agentPool',
  mcps: 'mcps',
  tools: 'tools',
  skills: 'skills',
  credentials: 'credentials',
} as const;

export default function HomeTeamSectionPage({ section }: { section: HomeTeamSection }) {
  const t = useTranslations('nav');
  const teams = useTeamsQuery();
  const teamId = soleTeamId(teams.data);
  const Section = sections[section];

  return (
    <Shell globalHome globalTitle={t(navKeys[section])} autoOpenGlobalChat={false}>
      {teams.isPending ? (
        <div className="p-4">
          <ListSkeleton rows={3} rowClassName="h-12" />
        </div>
      ) : teamId == null ? (
        <div className="flex h-full flex-col p-4">
          <EmptyState title={t('teamScopeRequired')} description={t('teamScopeRequiredHint')}>
            <Button asChild size="sm" variant="outline">
              <Link href={manageTeamsPath()}>{t('projectSettings')}</Link>
            </Button>
          </EmptyState>
        </div>
      ) : (
        <Section teamId={teamId} />
      )}
    </Shell>
  );
}
