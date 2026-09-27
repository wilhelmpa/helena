'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { WebLinksContext } from '@/context/webLinks';
import { useWebLinkNavigation } from '@/hooks/useWebLinkNavigation';
import { useWorkspaceNavigation } from '@/hooks/useWorkspaceNavigation';
import { usePathname, useRouter } from 'next/navigation';
import { useInitiativeOptionsQuery } from '@/services/initiatives.service';
import { useIssueBySeqQuery } from '@/services/issues.service';
import { useAccountPreferences } from '@/services/preferences.service';
import type { IssueOpenMode } from '@/lib/api/endpoints/userPreferences';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useOverlays } from '@/hooks/useOverlays';
import { usePermissions } from '@/hooks/usePermissions';
import { useSettingsNavGroups } from '@/hooks/useSettingsNavGroups';
import { useShellProject } from '@/hooks/useShellProject';
import { useShellRoute } from '@/hooks/useShellRoute';
import { useProjectRouteSync } from '@/hooks/useProjectRouteSync';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { usePluginPanelTools } from '@/extensions/pluginPanelTools';
import { projectPath, issuePath } from '@/utils/paths';
import { useKioskDisplay } from '@/utils/kioskDisplay';
import { createHeaderExtraStore } from '@/utils/headerExtraStore';
import { defaultsFromFilters, type NewIssueDefaults } from '@/utils/project';
import { ShellCtx, type ChatThreadRequest, type ShellContext } from '@/context/shellContext';
import { ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import type { WorkspaceLayoutChoice } from '@/context/workspaceLayout';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import ShellHeaderExtra from '@/components/layout/ShellHeaderExtra';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/layout/AppSidebar';
import AppHeader from '@/components/layout/AppHeader';
import CommandLayer from '@/components/layout/CommandLayer';
import { EmergencyStopBanner } from '@/features/agent-runtime/components/EmergencyStop';
import ShellBody from '@/components/layout/ShellBody';
import ShellHeaderTitle from '@/components/layout/ShellHeaderTitle';
import HeaderCrumbs from '@/components/layout/HeaderCrumbs';
import ShellOverlays from '@/components/layout/ShellOverlays';
import WorkspaceLayoutHost from '@/components/layout/WorkspaceLayoutHost';
import { useTranslations } from 'next-intl';

// The layout for /project/:projectKey and its children (the work items view and the
// settings pages). It owns the project data, the view editor and the
// project-level overlays, renders the sidebar + header chrome, and passes the
// project state to the active child through React context (see lib/shellContext).
export default function Shell({
  children,
  defaultSidebarOpen = true,
  globalHome = false,
  globalTitle,
  autoOpenGlobalChat = true,
}: {
  children: ReactNode;
  defaultSidebarOpen?: boolean;
  globalHome?: boolean;
  // The page name on a Home-level page; the header shows it as "Start › page".
  globalTitle?: string;
  autoOpenGlobalChat?: boolean;
}) {
  const t = useTranslations('nav');
  const tShell = useTranslations('shell');
  const router = useRouter();
  const route = useShellRoute();
  const { projectKey, routeIssueSeq } = route;

  const {
    projects,
    projectsLoaded,
    project,
    filteredProject,
    views,
    editor,
    customFields,
    canCreateIssue,
    errorMsg,
    forbidden,
    unreachable,
  } = useShellProject(projectKey, route.activeViewId);

  const initiativeOptions = useInitiativeOptionsQuery(projectKey).data ?? [];
  const { issueOpenMode, headerLayout } = useAccountPreferences();
  // What the active page put into the single-row header's middle slot (its view
  // tabs/filter bar); see useShellHeaderExtra. Unused, and always empty, in
  // 'classic' layout, where the page renders that row itself instead.
  const [headerExtra] = useState(createHeaderExtraStore);
  // The single-row header's page slot, where a page's title bar puts its actions (see
  // WorkspacePageHeader). A DOM element, set once by AppHeader's ref callback — not a
  // React element, so it never re-renders the page in a loop.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  // Below 1024px (a phone, a tablet, a narrow window) the header row has room only for
  // where you are and the app's tools, so a page's toolbar goes into its own 44px row
  // right under it instead — the same row on every page (owner, 2026-09-24: "mobile
  // muss alles richtig gut aussehen").
  const [pageBarSlot, setPageBarSlot] = useState<HTMLElement | null>(null);
  const narrow = useMediaQuery('(max-width: 1023px)');
  const pageSlot = headerLayout === 'single' ? (narrow ? pageBarSlot : headerSlot) : null;
  const overlays = useOverlays();
  // On the kiosk's two screens the tool panel fills the second one.
  const kiosk = useKioskDisplay();
  const kioskDual = kiosk === 'dual';
  // Marks the document for the dual kiosk's CSS: dialogs centre on the left screen.
  useEffect(() => {
    const root = document.documentElement;
    if (kioskDual) root.dataset.kioskDisplay = 'dual';
    else delete root.dataset.kioskDisplay;
  }, [kioskDual]);
  // Plugins' panel tools join the built-ins once the API lists them.
  usePluginPanelTools();
  // A page that already is a tool (code, inbox, chat) is not shown a second time beside
  // itself — two chats side by side, one of them not the page's.
  const pathname = usePathname();
  const routedTool =
    route.sub === 'code' || route.sub === 'inbox' || route.sub === 'chat'
      ? route.sub
      : pathname === '/chat'
        ? 'chat'
        : null;
  // How the page and the panel's tools share the room (the header's layout menu).
  const workspaceLayout = useWorkspaceLayout({
    kiosk,
    projectKey,
    defaultOpen: globalHome && autoOpenGlobalChat,
    routedTool,
  });
  const webLinks = useWebLinkNavigation(projectKey, workspaceLayout.showTool);
  const workspacePanel = workspaceLayout.panel;
  const layoutChoice: WorkspaceLayoutChoice = {
    layouts: workspaceLayout.layouts,
    current: workspaceLayout.chosenId,
    available: !workspaceLayout.phone,
    setLayout: workspaceLayout.setLayout,
    cycle: workspaceLayout.cycle,
  };
  const navigation = useWorkspaceNavigation(projectKey, defaultSidebarOpen);
  // The Shell renders the context provider, so its own permission check reads the
  // project it loaded rather than the context.
  const { can } = usePermissions(project);
  const canCreateInitiative = !!project?.project.initiativesEnabled && can('initiatives', 'create');
  const issueQuery = useIssueBySeqQuery(projectKey, routeIssueSeq);

  useProjectRouteSync({ projects, projectsLoaded, projectKey, allowEmpty: globalHome });

  const selectWorkspaceTool = workspaceLayout.selectTool;
  const {
    activeTool: activeWorkspaceTool,
    open: workspaceOpen,
    setOpen: setWorkspaceOpen,
  } = workspacePanel;

  // The panel that would show the page's own tool closes (the pinned panel of another
  // layout shows a different tool instead, see resolveWorkspaceLayout).
  useEffect(() => {
    if (routedTool && workspaceOpen && activeWorkspaceTool === routedTool) {
      setWorkspaceOpen(false);
    }
  }, [activeWorkspaceTool, routedTool, setWorkspaceOpen, workspaceOpen]);

  // The settings sections the member may open; the hotkey lands on the first of
  // them, the same entry the sidebar links to.
  const { firstHref: firstSettingsHref } = useSettingsNavGroups(projectKey, project);

  // Only the work items routes: a cycle or an initiative board carries its own
  // filters and merges them itself.
  const filterDefaults = route.onBoard
    ? defaultsFromFilters(editor.effectiveFilters, {
        cycles: project?.plannedCycles ?? [],
        initiatives: initiativeOptions,
      })
    : {};
  const addIssue = (defaults: NewIssueDefaults) =>
    overlays.setNewIssueDefaults({ ...filterDefaults, ...defaults });

  const openNewIssue = () => addIssue({});

  const toggleCoordinatorChat = () => workspaceLayout.selectTool('chat');
  const [chatThreadRequest, setChatThreadRequest] = useState<ChatThreadRequest | null>(null);

  // The issue the palette builds its issue commands for: the open detail panel
  // takes precedence over the issue page behind it.
  const currentIssueId = overlays.openIssueId ?? issueQuery.data?.id ?? null;
  // After deleting or archiving from the palette: close the panel, or leave the
  // issue page it was run from.
  const onIssueDeleted = () => {
    if (overlays.openIssueId != null) overlays.setOpenIssueId(null);
    else if (projectKey && routeIssueSeq != null) router.push(projectPath(projectKey));
  };

  useKeyboardShortcuts({
    hasProject: !!project,
    hasChat: true,
    overlayOpen: overlays.anyOpen,
    onToggleCommand: () => overlays.setShowCommand((v) => !v),
    onChangeView: editor.changeView,
    onNewIssue: () => canCreateIssue && openNewIssue(),
    onNewInitiative: () => canCreateInitiative && overlays.setShowNewInitiative(true),
    onNewProject: () => overlays.setShowNewProject(true),
    onSettings: () => firstSettingsHref && router.push(firstSettingsHref),
    onToggleChat: toggleCoordinatorChat,
    onCycleLayout: workspaceLayout.phone ? undefined : workspaceLayout.cycle,
  });

  // Every view opens an issue through this one callback, so the user's choice
  // between the side panel and a full page is applied here rather than at each call
  // site. `mode` overrides that choice for a call site that means one of them (the
  // context menu's Preview / Go to issue). The views pass the internal issue id
  // while the URL addresses an issue by its project-scoped number, so the page route
  // resolves the number first and falls back to the panel when the issue is not on
  // the loaded board.
  const openIssue = (id: number, mode: IssueOpenMode = issueOpenMode) => {
    if (mode === 'page' && projectKey) {
      const seq = project?.issues.find((i) => i.id === id)?.sequenceNumber;
      if (seq != null) {
        router.push(issuePath(projectKey, seq));
        return;
      }
    }
    // The issue the panel already shows closes it, so the card that opened the panel
    // is the one that puts it away.
    overlays.setOpenIssueId((current) => (current === id ? null : id));
  };

  const context: ShellContext = {
    workspaceTool: workspaceLayout.resolved.mainTool,
    onOpenWorkspaceTool: workspaceLayout.showTool,
    project,
    filteredProject,
    views,
    editor,
    customFields,
    onOpenIssue: openIssue,
    onAddIssue: addIssue,
    onChatWithAgent: () => workspaceLayout.showTool('chat'),
    onOpenChatThread: (agentId, threadId) => {
      setChatThreadRequest({ agentId, threadId });
      workspaceLayout.showTool('chat');
    },
    chatThreadRequest,
    onChatThreadHandled: () => setChatThreadRequest(null),
    headerLayout,
    headerExtra,
    workspaceLayout: layoutChoice,
  };

  return (
    <WebLinksContext.Provider value={webLinks}>
      <ShellCtx.Provider value={context}>
        <ShellHeaderSlotCtx.Provider value={pageSlot}>
          <SidebarProvider
            open={navigation.sidebarOpen}
            onOpenChange={navigation.setSidebarOpen}
            className="h-svh overflow-hidden"
            style={{ '--sidebar-width': '248px' } as CSSProperties}
          >
            <AppSidebar
              projects={projects}
              currentProjectKey={projectKey}
              onSelectProject={(key) => router.push(navigation.projectDestination(key))}
              onNewProject={() => overlays.setShowNewProject(true)}
              onNewView={() => {
                if (!projectKey) return;
                editor.beginNewView();
                if (!route.onBoard) router.push(projectPath(projectKey));
              }}
              onEditView={editor.beginEditView}
              onDeleteView={editor.deleteView}
            />
            <SidebarInset className="min-w-0">
              <AppHeader
                title={
                  globalHome ? (
                    globalTitle ? (
                      <HeaderCrumbs
                        items={[{ label: t('home'), href: '/' }, { label: globalTitle }]}
                      />
                    ) : (
                      t('home')
                    )
                  ) : (
                    <ShellHeaderTitle
                      route={route}
                      projectName={project?.project.name ?? t('project')}
                      issueIdentifier={issueQuery.data?.identifier ?? null}
                      issueParent={issueQuery.data?.parent ?? null}
                    />
                  )
                }
                titleLead={
                  !globalHome && route.routeIssueSeq != null && issueQuery.data
                    ? `${issueQuery.data.identifier} ${issueQuery.data.title}`
                    : null
                }
                hasProject={!!project}
                onOpenCommand={() => overlays.setShowCommand(true)}
                onNewIssue={openNewIssue}
                shownWorkspaceTools={workspaceLayout.resolved.shownTools}
                onSelectWorkspaceTool={selectWorkspaceTool}
                headerLayout={headerLayout}
                headerExtra={narrow ? null : headerExtra}
                pageSlotRef={setHeaderSlot}
                pageHidden={!workspaceLayout.resolved.pageVisible}
              />
              {headerLayout === 'single' && narrow && (
                <div
                  ref={setPageBarSlot}
                  data-slot="app-page-bar"
                  className="relative flex h-11 shrink-0 items-center gap-1 border-b border-sidebar-border px-2 empty:hidden [&:not(:has(>:not(:empty)))]:hidden"
                >
                  <ShellHeaderExtra store={headerExtra} bare />
                </div>
              )}

              <EmergencyStopBanner />

              {errorMsg && !forbidden && (
                <div className="border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                  {unreachable ? tShell('serverUnreachable') : errorMsg}
                </div>
              )}

              <WorkspaceLayoutHost layout={workspaceLayout} projectKey={projectKey}>
                <ShellBody
                  forbidden={forbidden}
                  hasProject={!!project}
                  hasError={!!errorMsg}
                  unreachable={unreachable}
                  projectsLoaded={projectsLoaded}
                  projectCount={projects.length}
                  allowNoProject={globalHome}
                >
                  {children}
                </ShellBody>
              </WorkspaceLayoutHost>
            </SidebarInset>

            <CommandLayer
              open={overlays.showCommand}
              onOpenChange={overlays.setShowCommand}
              projects={projects}
              currentProjectKey={projectKey}
              onBoard={route.onBoard}
              view={editor.view}
              currentIssueId={currentIssueId}
              onViewChange={editor.changeView}
              onNewIssue={openNewIssue}
              // Handled by the kanban board's selection provider (mounted only on the
              // board); the constant matches BOARD_SELECT_ALL_EVENT in useSelection.
              onSelectAll={() => window.dispatchEvent(new Event('board:select-all'))}
              onNewInitiative={() => overlays.setShowNewInitiative(true)}
              onNewProject={() => overlays.setShowNewProject(true)}
              onSelectProject={(key) => router.push(navigation.projectDestination(key))}
              onOpenIssue={(seq) => projectKey && router.push(issuePath(projectKey, seq))}
              onIssueDeleted={onIssueDeleted}
              onToggleChat={toggleCoordinatorChat}
            />

            <ShellOverlays project={project} projectKey={projectKey} overlays={overlays} />
          </SidebarProvider>
        </ShellHeaderSlotCtx.Provider>
      </ShellCtx.Provider>
    </WebLinksContext.Provider>
  );
}
