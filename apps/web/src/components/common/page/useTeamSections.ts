'use client';

import {
  Bell,
  BookText,
  Bot,
  FolderKanban,
  Info,
  Plug,
  Radio,
  ShieldCheck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Team } from '@/lib/api/endpoints/teams';
import { teamSectionPath, type TeamSection } from '@/utils/paths';
import { useTeamQuery, useTeamsQuery } from '@/services/teams.service';

export type TeamSectionEntry = {
  id: TeamSection;
  label: string;
  icon: LucideIcon;
  href: string;
  // Shown beside the entry; the counts come with the team list.
  count?: number;
};

// The sections of one team, in two groups: the team itself (its info, projects, the
// roles they assign from, its members, what MCP clients reach, its notification
// providers) and its AI team (the integration credentials the agents run on, the
// agents, the skills they load and the tools they call). A section the reader may not
// read is left out. Shared by the account sidebar and the page titles.
export function useTeamSections(team: Team | null): {
  team: TeamSectionEntry[];
  ai: TeamSectionEntry[];
} {
  const t = useTranslations('teams.sections');
  const permissions = useTeamQuery(team?.id ?? null).data?.permissions;
  if (!team) return { team: [], ai: [] };

  const entry = (
    id: TeamSection,
    label: string,
    icon: LucideIcon,
    count?: number,
  ): TeamSectionEntry => ({ id, label, icon, count, href: teamSectionPath(team.id, id) });
  const lead = team.role === 'owner' || team.role === 'manager';

  return {
    team: [
      entry('info', t('info.title'), Info),
      entry('projects', t('projects.title'), FolderKanban, team.projectCount),
      // The roles are managed by the team's owner and managers, so the section is theirs.
      ...(lead ? [entry('roles', t('roles.title'), ShieldCheck, team.roleCount)] : []),
      entry('members', t('members.title'), Users, team.memberCount),
      entry('mcp', t('mcp.title'), Radio),
      // The notification providers are the owner's: nobody else reads or writes them.
      ...(team.role === 'owner' ? [entry('notifications', t('notifications.title'), Bell)] : []),
    ],
    ai: [
      ...(permissions?.integrations.read
        ? [entry('integrations', t('integrations.title'), Plug, team.integrationCount)]
        : []),
      ...(permissions?.ai_agents.read
        ? [entry('ai-agents', t('agents.title'), Bot, team.agentCount)]
        : []),
      ...(permissions?.agent_skills.read
        ? [entry('agent-skills', t('agentSkills.title'), BookText, team.skillCount)]
        : []),
      ...(permissions?.agent_tools.read
        ? [entry('agent-tools', t('agentTools.title'), Wrench, team.toolCount)]
        : []),
    ],
  };
}

// The team the account area is showing: the one in the URL on a team's page, else the
// reader's first team (the sidebar lists its sections everywhere in the area, so the
// team settings are one click from the profile). Null while the list loads or when
// the reader is in no team.
export function useCurrentTeam(): Team | null {
  const params = useParams<{ teamId?: string }>();
  const { data } = useTeamsQuery();
  if (!data) return null;
  const id = params.teamId ? Number(params.teamId) : null;
  return data.find((team) => team.id === id) ?? data[0] ?? null;
}
