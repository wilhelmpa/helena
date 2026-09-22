import { Bot, BookText, KeyRound, Plug, Radio, Users, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import { homeNavigation } from './homeNavigation';

const icons = {
  agentPool: Bot,
  connections: Plug,
  vault: KeyRound,
  mcps: Radio,
  tools: Wrench,
  skills: BookText,
  manageTeams: Users,
} as const;

export default function SidebarHomeNav({ teamId }: { teamId: number | null }) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {homeNavigation(teamId).map((item) => (
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
