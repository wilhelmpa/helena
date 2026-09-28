'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { WebLinksContext } from '@/context/webLinks';
import { useWebLinkNavigation } from '@/hooks/useWebLinkNavigation';
import { useAccountPreferences } from '@/services/preferences.service';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import UserMenu from '@/components/layout/UserMenu';
import { EmergencyStopBanner } from '@/features/agent-runtime/components/EmergencyStop';
import SettingsModal from '@/features/settings/SettingsModal';
import { openSettingsModal, settingsModalRoute } from '@/features/settings/settingsModalCatalog';
import { useSession } from '@/lib/auth-client';

// The frame of an area that lives outside the project shell — the Administrator
// (/god) and the account (/account) — built exactly like the main Shell, so the three
// read as one app: the sidebar on the side, then ONE 48px header row with the sidebar
// toggle, the breadcrumb and the page's own toolbar (the page slot every
// WorkspacePageHeader/PageToolbar portals into). Below 1024px the page's toolbar moves
// into its own 44px row under the header, the same as in the main Shell. In the
// 'classic' header layout there is no page slot (pages draw their own title bar) and
// language, theme and account sit at the end of this row instead of the sidebar foot.
export default function StandaloneShell({
  defaultSidebarOpen,
  sidebar,
  title,
  children,
}: {
  defaultSidebarOpen: boolean;
  sidebar: ReactNode;
  // The breadcrumb (HeaderCrumbs) naming the area and the page.
  title: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const settingsRoute = settingsModalRoute(pathname);
  const { data: session } = useSession();
  const showSettingsRoute =
    settingsRoute && (settingsRoute.area !== 'admin' || session?.user.role === 'god');
  const showBrowser = useCallback(() => router.push('/?tool=browser'), [router]);
  const webLinks = useWebLinkNavigation(null, showBrowser);
  const { headerLayout } = useAccountPreferences();
  const single = headerLayout === 'single';
  const narrow = useMediaQuery('(max-width: 1023px)');
  // DOM elements, set by ref callbacks — never React elements in state (see the
  // "nicht klickbar" incident in c70b42e9).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [pageBarSlot, setPageBarSlot] = useState<HTMLElement | null>(null);
  const pageSlot = single ? (narrow ? pageBarSlot : headerSlot) : null;
  const titleRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(titleRef);

  useEffect(() => {
    function handleSettingsShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        openSettingsModal();
      }
    }
    window.addEventListener('keydown', handleSettingsShortcut);
    return () => window.removeEventListener('keydown', handleSettingsShortcut);
  }, []);

  return (
    <WebLinksContext.Provider value={webLinks}>
      <ShellHeaderSlotCtx.Provider value={pageSlot}>
        <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-svh overflow-hidden">
          {sidebar}
          <SidebarInset className="min-w-0">
            <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-2 sm:px-3">
              <SidebarTrigger />
              <Separator orientation="vertical" className="h-4" />
              <div
                ref={titleRef}
                className={cn(
                  'min-w-0 truncate text-sm font-medium',
                  single && !narrow ? 'max-w-[min(26rem,45vw)] shrink' : 'flex-1',
                )}
              >
                {title}
              </div>
              {single && !narrow && (
                <div
                  ref={setHeaderSlot}
                  data-slot="app-header-page"
                  className="flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden"
                />
              )}
              {!single && (
                <div className="ms-auto flex shrink-0 items-center gap-2">
                  <LocaleToggle />
                  <ThemeToggle />
                  <UserMenu />
                </div>
              )}
            </header>
            {single && narrow && (
              <div
                ref={setPageBarSlot}
                data-slot="app-page-bar"
                className="relative flex h-11 shrink-0 items-center gap-1 border-b border-sidebar-border px-2 empty:hidden"
              />
            )}
            <EmergencyStopBanner />
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              {showSettingsRoute ? <div className="settings-modal-background-page" /> : children}
            </div>
            {(!settingsRoute || showSettingsRoute) && (
              <SettingsModal routeContent={showSettingsRoute ? children : undefined} />
            )}
          </SidebarInset>
        </SidebarProvider>
      </ShellHeaderSlotCtx.Provider>
    </WebLinksContext.Provider>
  );
}
