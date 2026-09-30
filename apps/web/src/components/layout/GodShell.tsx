'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import StandaloneShell from '@/components/common/page/StandaloneShell';
import SectionPageSkeleton from '@/components/common/skeleton/SectionPageSkeleton';
import GodSidebar from '@/components/layout/GodSidebar';
import { useGodSectionText } from '@/hooks/useSectionLabels';
import { GOD_SECTIONS } from '@/utils/godSections';
import { godPath } from '@/utils/paths';

// The shell for the Administrator (/god): the instance settings sidebar and the same
// single-row header as the main Shell ("Administrator › section", then the page's
// toolbar), with no project loaded — see StandaloneShell.
//
// Access is by the global role: only the instance owner ("god") sees the pages. The
// API enforces the same on every /god route, so this check is about what to render,
// not about security.
export default function GodShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('nav');
  const { data: session, isPending } = useSession();
  // The session can already be in the store on hydration while the server rendered
  // without it, so the role is only read after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && session?.user.role === 'god';
  const sessionSettled = mounted && !isPending;
  const god = useGodSectionText();
  const pathname = usePathname();
  const section = GOD_SECTIONS.find((s) => pathname.startsWith(godPath(s.slug)));

  return (
    <StandaloneShell
      defaultSidebarOpen={defaultSidebarOpen}
      sidebar={<GodSidebar />}
      title={section ? god.section(section.slug).label : t('godMode')}
    >
      {isGod && children}
      {!isGod && sessionSettled && (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {t('godModeOwnerOnly')}
        </div>
      )}
      {!isGod && !sessionSettled && <SectionPageSkeleton />}
    </StandaloneShell>
  );
}
