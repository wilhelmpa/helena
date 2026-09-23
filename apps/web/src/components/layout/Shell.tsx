'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useWorkspaceNavigation } from '@/hooks/useWorkspaceNavigation';
import { useRouter } from 'next/navigation';
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
import { useWorkspacePanel } from '@/hooks/useWorkspacePanel';
import { projectPath, issuePath } from '@/utils/paths';
import { useKioskDisplay } from '@/utils/kioskDisplay';
import { defaultsFromFilters, type NewIssueDefaults } from '@/utils/project';
import { ShellCtx, type ChatThreadRequest, type ShellContext } from '@/context/shellContext';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import AppSidebar from '@/components/layout/AppSidebar';
import AppHeader from '@/components/layout/AppHeader';
import CommandLayer from '@/components/layout/CommandLayer';
import ShellBody from '@/components/layout/ShellBody';
import ShellHeaderTitle from '@/components/layout/ShellHeaderTitle';
import ShellOverlays from '@/components/layout/ShellOverlays';
import WorkspacePanel from '@/components/layout/WorkspacePanel';
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
  globalTitle?: ReactNode;
  autoOpenGlobalChat?: boolean;
}) {
  const t = useTranslations('nav');
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
  } = useShellProject(projectKey, route.activeViewId);

  const initiativeOptions = useInitiativeOptionsQuery(projectKey).data ?? [];
  const { issueOpenMode } = useAccountPreferences();
  const overlays = useOverlays();
  // On the kiosk's two screens the tool panel fills the second one.
  const kioskDual = useKioskDisplay() === 'dual';
  const workspacePanel = useWorkspacePanel({
    defaultOpen: globalHome && autoOpenGlobalChat,
    projectKey,
    pinned: kioskDual,
  });
  const navigation = useWorkspaceNavigation(projectKey, defaultSidebarOpen);
  // The Shell renders the context provider, so its own permission check reads the
  // project it loaded rather than the context.
  const { can } = usePermissions(project);
  const canCreateInitiative = !!project?.project.initiativesEnabled && can('initiatives', 'create');
  const issueQuery = useIssueBySeqQuery(projectKey, routeIssueSeq);

  useProjectRouteSync({ projects, projectsLoaded, projectKey, allowEmpty: globalHome });

  const selectWorkspaceTool = workspacePanel.toggleTool;
  const {
    activeTool: activeWorkspaceTool,
    open: workspaceOpen,
    setOpen: setWorkspaceOpen,
  } = workspacePanel;

  useEffect(() => {
    const routedTool = route.sub === 'code' || route.sub === 'inbox' ? route.sub : null;
    if (routedTool && workspaceOpen && activeWorkspaceTool === routedTool) {
      setWorkspaceOpen(false);
    }
  }, [activeWorkspaceTool, route.sub, setWorkspaceOpen, workspaceOpen]);

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

  const toggleCoordinatorChat = () => workspacePanel.toggleTool('chat');
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
    workspaceTool: workspacePanel.open ? workspacePanel.activeTool : null,
    onOpenWorkspaceTool: workspacePanel.openTool,
    project,
    filteredProject,
    views,
    editor,
    customFields,
    onOpenIssue: openIssue,
    onAddIssue: addIssue,
    onChatWithAgent: () => workspacePanel.openTool('chat'),
    onOpenChatThread: (agentId, threadId) => {
      setChatThreadRequest({ agentId, threadId });
      workspacePanel.openTool('chat');
    },
    chatThreadRequest,
    onChatThreadHandled: () => setChatThreadRequest(null),
  };

  return (
    <ShellCtx.Provider value={context}>
      <SidebarProvider
        open={navigation.sidebarOpen}
        onOpenChange={navigation.setSidebarOpen}
        className="h-svh overflow-hidden"
      >
        <AppSidebar
          projects={projects}
          currentProjectKey={projectKey}
          onSelectProject={(key) => router.push(navigation.projectDestination(key))}
          onNewProject={() => overlays.setShowNewProject(true)}
        />
        <SidebarInset className="min-w-0">
          <AppHeader
            title={
              globalHome ? (
                (globalTitle ?? t('home'))
              ) : (
                <ShellHeaderTitle
                  route={route}
                  projectName={project?.project.name ?? t('project')}
                  issueIdentifier={issueQuery.data?.identifier ?? null}
                  issueParent={issueQuery.data?.parent ?? null}
                />
              )
            }
            hasProject={!!project}
            onOpenCommand={() => overlays.setShowCommand(true)}
            onNewIssue={openNewIssue}
            workspaceOpen={workspacePanel.open}
            activeWorkspaceTool={workspacePanel.activeTool}
            onSelectWorkspaceTool={selectWorkspaceTool}
          />

          {errorMsg && !forbidden && (
            <div className="border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          )}

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ShellBody
                forbidden={forbidden}
                hasProject={!!project}
                hasError={!!errorMsg}
                projectsLoaded={projectsLoaded}
                projectCount={projects.length}
                allowNoProject={globalHome}
              >
                {children}
              </ShellBody>
            </div>

            <WorkspacePanel
              open={workspacePanel.open}
              activeTool={workspacePanel.activeTool}
              contextProjectKey={projectKey}
              toolSession={workspacePanel.toolSession}
              splitTool={workspacePanel.splitTool}
              onSplitToolChange={workspacePanel.setSplitTool}
              mode={workspacePanel.mode}
              fullscreen={workspacePanel.fullscreen}
              onToggleMode={workspacePanel.toggleMode}
              onToggleFullscreen={workspacePanel.toggleFullscreen}
              pinned={workspacePanel.pinned}
              onClose={() => workspacePanel.setOpen(false)}
            />
          </div>
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
    </ShellCtx.Provider>
  );
}
