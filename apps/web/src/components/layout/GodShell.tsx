'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/auth-client';
import { useAccountPreferences } from '@/services/preferences.service';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import SectionPageSkeleton from '@/components/common/skeleton/SectionPageSkeleton';
import UserMenu from '@/components/layout/UserMenu';
import GodSidebar from '@/components/layout/GodSidebar';
import HeaderCrumbs from '@/components/layout/HeaderCrumbs';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { useGodSectionText } from '@/hooks/useSectionLabels';
import { GOD_SECTIONS } from '@/utils/godSections';
import { godPath } from '@/utils/paths';

// The shell for god mode: the instance settings sidebar and a slim header, with no
// project loaded. It is the counterpart of Shell for the project routes, but far
// smaller — nothing here needs the board, overlays, or project permissions.
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
  // 'classic' keeps language/theme/account in this header, exactly as before;
  // 'single' (the default) moves them to the sidebar footer, the same as the main
  // Shell — see SidebarUtilityRow in GodSidebar.
  const { headerLayout } = useAccountPreferences();
  const single = headerLayout === 'single';
  // The same single-row header as the main Shell: "Administrator › section", and the
  // page's actions in the header's page slot instead of a second title row.
  const god = useGodSectionText();
  const pathname = usePathname();
  const section = GOD_SECTIONS.find((s) => pathname.startsWith(godPath(s.slug)));
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  return (
    <ShellHeaderSlotCtx.Provider value={single ? headerSlot : null}>
      <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-svh overflow-hidden">
        <GodSidebar />
        <SidebarInset className="min-w-0">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-2 sm:px-3">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <div className="min-w-0 truncate text-sm font-medium">
              {section ? (
                <HeaderCrumbs
                  items={[
                    { label: t('godMode'), href: godPath(GOD_SECTIONS[0]!.slug) },
                    { label: god.section(section.slug).label },
                  ]}
                />
              ) : (
                t('godMode')
              )}
            </div>
            {single && (
              <div
                ref={setHeaderSlot}
                data-slot="app-header-page"
                className="flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden"
              />
            )}
            {!single && (
              <div className="ms-auto flex items-center gap-2">
                <LocaleToggle />
                <ThemeToggle />
                <UserMenu />
              </div>
            )}
          </header>

          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {isGod && children}
            {!isGod && sessionSettled && (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
                {t('godModeOwnerOnly')}
              </div>
            )}
            {!isGod && !sessionSettled && <SectionPageSkeleton />}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ShellHeaderSlotCtx.Provider>
  );
}
