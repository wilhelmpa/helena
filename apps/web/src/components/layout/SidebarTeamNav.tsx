import { Bot, BookText, Building2, KeyRound, Plug, Radio, UsersRound, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { homeNavigation } from './homeNavigation';

const icons = {
  agentPool: Bot,
  organization: Building2,
  connections: Plug,
  vault: KeyRound,
  mcps: Radio,
  tools: Wrench,
  skills: BookText,
  teamSettings: UsersRound,
} as const;

// What belongs to the team rather than one project: its agents and how they are
// organized, the skills, tools and MCP servers they share, the connections and secrets,
// and the team's own settings. Shown whether a project is selected or not.
export default function SidebarTeamNav({ teamId }: { teamId: number | null }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { vaultEnabled } = runtimeEnv().workspace;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('groups.team')}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {homeNavigation(teamId, vaultEnabled).map((item) => (
            <SidebarNavItem
              key={item.id}
              href={item.href}
              icon={icons[item.id]}
              label={t(item.id)}
              active={pathname === item.href || pathname.startsWith(item.href + '/')}
              disabled={false}
            />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
