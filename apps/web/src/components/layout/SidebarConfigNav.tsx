import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { organizationPath, projectPath } from '@/utils/paths';
import { SidebarGroup, SidebarGroupContent, SidebarMenu } from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';

export default function SidebarConfigNav({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const disabled = !projectKey;
  const base = projectKey ? projectPath(projectKey) : '';
  const active =
    Boolean(base) &&
    [
      '/organization',
      '/workflows',
      '/cycles',
      '/ai-agents',
      '/ai-team/',
      '/members',
      '/notifications',
      '/settings/',
      '/mcp',
    ].some((segment) => pathname.startsWith(`${base}${segment}`));

  return (
    <SidebarGroup className="pt-3">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarNavItem
            href={projectKey ? organizationPath(projectKey) : '#'}
            icon={Settings}
            label={t('configuration')}
            active={active}
            disabled={disabled}
          />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
