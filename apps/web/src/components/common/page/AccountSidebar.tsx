'use client';

import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import { useAccountSectionLabel } from '@/hooks/useSectionLabels';
import { useSidebarSide } from '@/hooks/useSidebarSide';
import { useAccountPreferences } from '@/services/preferences.service';
import { useTeamsQuery } from '@/services/teams.service';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import SidebarNavItem from '@/components/layout/SidebarNavItem';
import SidebarAccountRow from '@/components/brand/SidebarAccountRow';
import SidebarBrand from '@/components/brand/SidebarBrand';
import AccountTeamSwitcher from './AccountTeamSwitcher';
import { useCurrentTeam, useTeamSections, type TeamSectionEntry } from './useTeamSections';

// The sidebar of the account area (/account): the main sidebar's twin, like the
// Administrator's. The Helena brand row, the way back, the reader's own pages
// (profile, preferences, linked accounts, security, API keys), then the team — its
// name is the group label and switches to another team — with its sections and its
// AI team. Everything that used to be a second and third rail on the teams page lives
// here, so the page itself is only the section.
export default function AccountSidebar() {
  const t = useTranslations('account.shell');
  const tNav = useTranslations('nav');
  const sectionLabel = useAccountSectionLabel();
  const pathname = usePathname();
  const side = useSidebarSide();
  const { headerLayout } = useAccountPreferences();
  const { data: teams } = useTeamsQuery();
  const team = useCurrentTeam();
  const sections = useTeamSections(team);

  const item = (entry: TeamSectionEntry) => (
    <SidebarNavItem
      key={entry.id}
      href={entry.href}
      icon={entry.icon}
      label={entry.label}
      active={pathname === entry.href}
      disabled={false}
      badge={entry.count}
    />
  );

  return (
    <Sidebar collapsible="icon" side={side}>
      <SidebarHeader className="h-12 shrink-0 justify-center px-2 py-0">
        <SidebarBrand />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarNavItem
                href="/"
                icon={ArrowLeft}
                label={tNav('backToApp')}
                active={false}
                disabled={false}
              />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t('title')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT_SECTIONS.map(({ slug, icon }) => (
                <SidebarNavItem
                  key={slug}
                  href={accountPath(slug)}
                  icon={icon}
                  label={sectionLabel(slug)}
                  active={pathname === accountPath(slug)}
                  disabled={false}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <AccountTeamSwitcher teams={teams ?? []} current={team} />
          <SidebarGroupContent>
            <SidebarMenu>{sections.team.map(item)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {sections.ai.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>{tNav('aiTeam')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{sections.ai.map(item)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {headerLayout === 'single' && (
          <>
            <SidebarSeparator />
            <SidebarAccountRow />
          </>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
