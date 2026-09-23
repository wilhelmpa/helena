import { useEffect, useState } from 'react';
import {
  Activity,
  AtSign,
  BookOpenText,
  BookText,
  Bot,
  Building2,
  Clock3,
  Folder,
  Inbox,
  KeyRound,
  LayoutGrid,
  ListTodo,
  MessageCircle,
  MonitorSmartphone,
  Plug,
  Radio,
  ShieldCheck,
  UsersRound,
  Workflow,
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
import { useSession } from '@/lib/auth-client';
import { usePendingApprovalCount, useWorkflowGates } from '@/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { homeNavigation, type HomeNavigationGroup } from './homeNavigation';
import SidebarApprovalsRefresh from './SidebarApprovalsRefresh';

const icons = {
  overview: LayoutGrid,
  allWorkItems: ListTodo,
  inbox: Inbox,
  chat: MessageCircle,
  files: Folder,
  approvals: ShieldCheck,
  docs: BookOpenText,
  agentPool: Bot,
  organization: Building2,
  agentActivity: Activity,
  schedules: Clock3,
  workflows: Workflow,
  skills: BookText,
  tools: Wrench,
  mcps: Radio,
  connections: Plug,
  mailAccounts: AtSign,
  credentials: KeyRound,
  devices: MonitorSmartphone,
  teamSettings: UsersRound,
} as const;

const GROUPS: HomeNavigationGroup[] = ['work', 'agents', 'globalSettings'];

// The sidebar while no project is selected: the work across every project, the
// team's agents, and the settings every project shares. A selected project shows its
// own navigation instead. `teamIds` are the teams of the reader's projects, whose
// approval requests move the approvals badge.
export default function SidebarHomeNav({
  teamId,
  teamIds,
}: {
  teamId: number | null;
  teamIds: number[];
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: session } = useSession();
  // Read after mount: the server rendered without the session.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const items = homeNavigation(teamId, mounted && session?.user.role === 'god');
  const pendingApprovals =
    (usePendingApprovalCount().data?.count ?? 0) +
    (useWorkflowGates().data?.items.length ?? 0) +
    (usePipelineApprovals().data?.length ?? 0);

  const groups = GROUPS.map((group) => {
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
                badge={item.id === 'approvals' ? pendingApprovals : undefined}
              />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  });
  return (
    <>
      {teamIds.map((id) => (
        <SidebarApprovalsRefresh key={id} teamId={id} />
      ))}
      {groups}
    </>
  );
}
