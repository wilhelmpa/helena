'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { WebLinksContext } from '@/context/webLinks';
import { useWebLinkNavigation } from '@/hooks/useWebLinkNavigation';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { PageHeader, type Crumb } from '@/design-system';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { EmergencyStopBanner } from '@/features/agent-runtime/components/EmergencyStop';
import SettingsModal from '@/features/settings/SettingsModal';
import { openSettingsModal, settingsModalRoute } from '@/features/settings/settingsModalCatalog';

// The frame of an area that lives outside the project shell — the Administrator
// (/god) and the account (/account) — built exactly like the main Shell, so the three
// read as one app: the sidebar on the side, then the app's ONE 56px header bar (PageHeader:
// the sidebar toggle, the breadcrumb ending in the page's name, the page's own toolbar and its
// main action; below 900px the toolbar folds under the breadcrumb).
export default function StandaloneShell({
  defaultSidebarOpen,
  sidebar,
  title,
  crumbs,
  children,
}: {
  defaultSidebarOpen: boolean;
  sidebar: ReactNode;
  // The page's name, the last part of the header's breadcrumb (owner 30.09., O104).
  title: string;
  // Where the page sits, before its name.
  crumbs?: Crumb[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Every page of the account area and the Administrator is a section of the settings
  // modal now: its old URL opens the modal over the page the user came from, so this
  // frame shows nothing of its own while it forwards (SettingsModal).
  const settingsRoute = settingsModalRoute(pathname);
  const showBrowser = useCallback(() => router.push('/?tool=browser'), [router]);
  const webLinks = useWebLinkNavigation(null, showBrowser);
  // DOM elements, set by ref callbacks — never React elements in state (see the
  // "nicht klickbar" incident in c70b42e9).
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [pageBarSlot, setPageBarSlot] = useState<HTMLElement | null>(null);
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
      <ShellHeaderSlotCtx.Provider value={pageBarSlot}>
        <ShellHeaderActionsSlotCtx.Provider value={headerSlot}>
          <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-svh overflow-hidden">
            {sidebar}
            <SidebarInset className="min-w-0">
              <PageHeader
                crumbs={crumbs}
                title={title}
                titleRef={titleRef}
                actionsRef={setHeaderSlot}
                barRef={setPageBarSlot}
                lead={<SidebarTrigger />}
              />
              <EmergencyStopBanner />
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                {settingsRoute ? null : children}
              </div>
              <SettingsModal />
            </SidebarInset>
          </SidebarProvider>
        </ShellHeaderActionsSlotCtx.Provider>
      </ShellHeaderSlotCtx.Provider>
    </WebLinksContext.Provider>
  );
}
