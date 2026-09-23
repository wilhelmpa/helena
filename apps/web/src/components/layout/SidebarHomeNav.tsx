import {
  Activity,
  Bot,
  BookText,
  Building2,
  Inbox,
  KeyRound,
  LayoutGrid,
  ListTodo,
  Plug,
  Radio,
  UsersRound,
  Wrench,
} from 'lucide-react';
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
import { homeNavigation, type HomeNavigationGroup } from './homeNavigation';

const icons = {
  overview: LayoutGrid,
  allWorkItems: ListTodo,
  inbox: Inbox,
  agentPool: Bot,
  organization: Building2,
  agentActivity: Activity,
  skills: BookText,
  tools: Wrench,
  mcps: Radio,
  connections: Plug,
  vault: KeyRound,
  teamSettings: UsersRound,
} as const;

const GROUPS: HomeNavigationGroup[] = ['work', 'agents', 'globalSettings'];

// The sidebar while no project is selected: the work across every project, the
// team's agents, and the settings every project shares. A selected project shows its
// own navigation instead.
export default function SidebarHomeNav({ teamId }: { teamId: number | null }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { vaultEnabled } = runtimeEnv().workspace;
  const items = homeNavigation(teamId, vaultEnabled);

  return GROUPS.map((group) => {
    const groupItems = items.filter((item) => item.group === group);
    if (groupItems.length === 0) return null;
    return (
      <SidebarGroup key={group}>
        <SidebarGroupLabel>{t(`groups.${group}`)}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {groupItems.map((item) => (
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
  });
}
