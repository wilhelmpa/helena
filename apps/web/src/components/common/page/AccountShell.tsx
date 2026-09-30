'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ACCOUNT_SECTIONS, accountPath } from '@/utils/accountSections';
import { useAccountSectionLabel } from '@/hooks/useSectionLabels';
import AccountSidebar from './AccountSidebar';
import StandaloneShell from './StandaloneShell';
import { useCurrentTeam, useTeamSections } from './useTeamSections';

// The frame of the account area (/account/*): the account sidebar and the app's one
// header bar — the page's name ("Profil", or a team's section) — with the page's
// toolbar beside it. See StandaloneShell.
export default function AccountShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('account.shell');
  const sectionLabel = useAccountSectionLabel();
  const pathname = usePathname();
  const team = useCurrentTeam();
  const sections = useTeamSections(team);

  const account = ACCOUNT_SECTIONS.find(({ slug }) => pathname === accountPath(slug));
  const teamSection = [...sections.team, ...sections.ai].find((entry) => entry.href === pathname);
  const title = account
    ? sectionLabel(account.slug)
    : team && teamSection
      ? teamSection.label
      : t('title');

  return (
    <StandaloneShell
      defaultSidebarOpen={defaultSidebarOpen}
      sidebar={<AccountSidebar />}
      title={title}
    >
      {children}
    </StandaloneShell>
  );
}
