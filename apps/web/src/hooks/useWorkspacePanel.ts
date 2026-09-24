'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { panelTool } from '@/extensions/panelTools';

export type WorkspacePanelMode = 'overlay' | 'push';

const OPEN_KEY = 'workspace:panel:open';
const TOOL_KEY = 'workspace:panel:tool';
const MODE_KEY = 'workspace:panel:mode';
const PROJECT_KEY = 'workspace:panel:project';

// A project's own tool (its terminal, its code) closes when the project changes.
const projectScoped = (tool: WorkspaceToolId) => panelTool(tool)?.projectScoped === true;

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

// A registered panel tool, or a plugin's, whose registration arrives with the API's list
// of plugin UI slots after the page loaded.
function isToolId(value: string | null): value is WorkspaceToolId {
  return !!value && (!!panelTool(value) || value.startsWith('plugin:'));
}

// A pinned panel stays open beside the page, as on the kiosk's second screen and in every
// workspace layout but the standard one: it cannot be closed or float over the page. How
// the panel shares the room with the page (a second tool beside it, the whole window) is
// the workspace layout's business (hooks/useWorkspaceLayout).
export function useWorkspacePanel({
  defaultOpen = false,
  projectKey = null,
  pinned = false,
}: { defaultOpen?: boolean; projectKey?: string | null; pinned?: boolean } = {}) {
  const [open, setOpenState] = useState(false);
  const [activeTool, setActiveTool] = useState<WorkspaceToolId>('chat');
  const [mode, setMode] = useState<WorkspacePanelMode>('overlay');
  const [toolSession, setToolSession] = useState(0);
  const previousProjectKey = useRef(projectKey);
  const restored = useRef(false);

  useEffect(() => {
    // Restore exactly once for this mounted shell. A delayed hydration effect must
    // never overwrite a tool the user has already opened.
    if (restored.current) return;
    restored.current = true;
    // A link can open a tool: ?tool=browser (Home's browser overview, a handover card in
    // Freigaben). The parameter is taken off the address again, so a reload does not reopen it.
    const linked = new URLSearchParams(window.location.search).get('tool');
    if (isToolId(linked)) {
      const url = new URL(window.location.href);
      url.searchParams.delete('tool');
      window.history.replaceState(window.history.state, '', url);
      setActiveTool(linked);
      setOpenState(true);
      write(TOOL_KEY, linked);
      write(OPEN_KEY, 'open');
      if (projectScoped(linked)) write(PROJECT_KEY, projectKey ?? '');
      try {
        setMode(localStorage.getItem(MODE_KEY) === 'push' ? 'push' : 'overlay');
      } catch {
        // Storage off: the defaults stay.
      }
      return;
    }
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      const storedTool = localStorage.getItem(TOOL_KEY);
      const tool = isToolId(storedTool) ? storedTool : 'chat';
      const staleProjectTool =
        projectScoped(tool) && localStorage.getItem(PROJECT_KEY) !== (projectKey ?? '');
      // Home opens the chat beside the page on first visit — on a desktop. On a phone
      // the panel covers the whole page, so Home starts on Home there.
      const roomBeside =
        typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches;
      setOpenState(
        staleProjectTool
          ? false
          : savedOpen === null
            ? defaultOpen && roomBeside
            : savedOpen === 'open',
      );
      if (staleProjectTool) write(OPEN_KEY, 'closed');
      if (isToolId(storedTool)) setActiveTool(storedTool);
      setMode(localStorage.getItem(MODE_KEY) === 'push' ? 'push' : 'overlay');
    } catch {
      return;
    }
  }, [defaultOpen, projectKey]);

  useEffect(() => {
    if (previousProjectKey.current === projectKey) return;
    previousProjectKey.current = projectKey;
    if (open && projectScoped(activeTool)) {
      setOpenState(false);
      write(OPEN_KEY, 'closed');
    }
  }, [activeTool, open, projectKey]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    write(OPEN_KEY, next ? 'open' : 'closed');
  }, []);

  const openTool = useCallback(
    (tool: WorkspaceToolId) => {
      setActiveTool(tool);
      setToolSession((current) => current + 1);
      setOpenState(true);
      write(TOOL_KEY, tool);
      write(OPEN_KEY, 'open');
      if (projectScoped(tool)) write(PROJECT_KEY, projectKey ?? '');
    },
    [projectKey],
  );

  const toggleTool = useCallback(
    (tool: WorkspaceToolId) => {
      if (open && activeTool === tool && !pinned) {
        setOpen(false);
        return;
      }
      openTool(tool);
    },
    [activeTool, open, openTool, pinned, setOpen],
  );

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === 'overlay' ? 'push' : 'overlay';
      write(MODE_KEY, next);
      return next;
    });
  }, []);

  return {
    open: pinned || open,
    activeTool,
    mode: pinned ? ('push' as const) : mode,
    pinned,
    toolSession,
    setOpen,
    openTool,
    toggleTool,
    toggleMode,
  };
}
