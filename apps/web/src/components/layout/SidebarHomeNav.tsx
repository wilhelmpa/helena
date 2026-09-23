import { Bot, BookText, FolderCog, KeyRound, Plug, Radio, Wrench } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { homeNavigation } from './homeNavigation';

const icons = {
  agentPool: Bot,
  connections: Plug,
  vault: KeyRound,
  mcps: Radio,
  tools: Wrench,
  skills: BookText,
  projectSettings: FolderCog,
} as const;

export default function SidebarHomeNav({ teamId }: { teamId: number | null }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { vaultEnabled } = runtimeEnv().workspace;

  return (
    <SidebarGroup>
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
