'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { Button } from '@/components/ui/button';
import TeamAiAgentsSection from '@/features/teams/components/ai-agents/TeamAiAgentsSection';
import TeamAgentSkillsSection from '@/features/teams/components/agent-skills/TeamAgentSkillsSection';
import TeamAgentToolsSection from '@/features/teams/components/agent-tools/TeamAgentToolsSection';
import TeamMcpSection from '@/features/teams/components/mcp/TeamMcpSection';
import { useTeamsQuery } from '@/services/teams.service';
import { manageTeamsPath } from '@/utils/paths';
import { soleTeamId } from './homeTeamScope';

export type HomeTeamSection = 'agents' | 'mcps' | 'tools' | 'skills';

const sections = {
  agents: TeamAiAgentsSection,
  mcps: TeamMcpSection,
  tools: TeamAgentToolsSection,
  skills: TeamAgentSkillsSection,
} satisfies Record<HomeTeamSection, React.ComponentType<{ teamId: number }>>;

const navKeys = {
  agents: 'agentPool',
  mcps: 'mcps',
  tools: 'tools',
  skills: 'skills',
} as const;

export default function HomeTeamSectionPage({ section }: { section: HomeTeamSection }) {
  const t = useTranslations('nav');
  const teams = useTeamsQuery();
  const teamId = soleTeamId(teams.data);
  const Section = sections[section];

  return (
    <Shell globalHome globalTitle={t(navKeys[section])} autoOpenGlobalChat={false}>
      {teams.isPending ? (
        <div className="p-6 text-sm text-muted-foreground">{t('loading')}</div>
      ) : teamId == null ? (
        <div className="flex h-full items-center justify-center p-6">
          <div className="max-w-md rounded-lg border bg-card p-6 text-center">
            <h1 className="text-lg font-semibold">{t('teamScopeRequired')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('teamScopeRequiredHint')}</p>
            <Button asChild className="mt-4">
              <Link href={manageTeamsPath()}>{t('manageTeams')}</Link>
            </Button>
          </div>
        </div>
      ) : (
        <Section teamId={teamId} />
      )}
    </Shell>
  );
}
