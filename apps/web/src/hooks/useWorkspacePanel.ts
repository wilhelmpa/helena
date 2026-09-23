'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { WORKSPACE_TOOL_IDS } from '@/utils/workspaceTools';
import type { WorkspaceToolId } from '@/utils/workspaceTools';

export type WorkspacePanelMode = 'overlay' | 'push';

const OPEN_KEY = 'workspace:panel:open';
const TOOL_KEY = 'workspace:panel:tool';
const MODE_KEY = 'workspace:panel:mode';
const FULLSCREEN_KEY = 'workspace:panel:fullscreen';
const PROJECT_KEY = 'workspace:panel:project';
const SPLIT_KEY = 'workspace:panel:split';

const PROJECT_SCOPED_TOOLS = new Set<WorkspaceToolId>(['terminal', 'code', 'files']);

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

function isToolId(value: string | null): value is WorkspaceToolId {
  return WORKSPACE_TOOL_IDS.some((tool) => tool === value);
}

export function useWorkspacePanel({
  defaultOpen = false,
  projectKey = null,
}: { defaultOpen?: boolean; projectKey?: string | null } = {}) {
  const [open, setOpenState] = useState(false);
  const [activeTool, setActiveTool] = useState<WorkspaceToolId>('chat');
  const [mode, setMode] = useState<WorkspacePanelMode>('overlay');
  const [fullscreen, setFullscreen] = useState(false);
  const [toolSession, setToolSession] = useState(0);
  // A second tool shown beside the active one, or null for a single tool.
  const [splitTool, setSplitToolState] = useState<WorkspaceToolId | null>(null);
  const previousProjectKey = useRef(projectKey);
  const restored = useRef(false);

  useEffect(() => {
    // Restore exactly once for this mounted shell. A delayed hydration effect must
    // never overwrite a tool the user has already opened.
    if (restored.current) return;
    restored.current = true;
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      const storedTool = localStorage.getItem(TOOL_KEY);
      const tool = isToolId(storedTool) ? storedTool : 'chat';
      const staleProjectTool =
        PROJECT_SCOPED_TOOLS.has(tool) && localStorage.getItem(PROJECT_KEY) !== (projectKey ?? '');
      setOpenState(
        staleProjectTool ? false : savedOpen === null ? defaultOpen : savedOpen === 'open',
      );
      if (staleProjectTool) write(OPEN_KEY, 'closed');
      if (isToolId(storedTool)) setActiveTool(storedTool);
      setMode(localStorage.getItem(MODE_KEY) === 'push' ? 'push' : 'overlay');
      const storedSplit = localStorage.getItem(SPLIT_KEY);
      setSplitToolState(isToolId(storedSplit) ? storedSplit : null);
      setFullscreen(localStorage.getItem(FULLSCREEN_KEY) === 'true');
    } catch {
      return;
    }
  }, [defaultOpen, projectKey]);

  useEffect(() => {
    if (previousProjectKey.current === projectKey) return;
    previousProjectKey.current = projectKey;
    if (open && PROJECT_SCOPED_TOOLS.has(activeTool)) {
      setOpenState(false);
      write(OPEN_KEY, 'closed');
    }
  }, [activeTool, open, projectKey]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    write(OPEN_KEY, next ? 'open' : 'closed');
  }, []);

  const setSplitTool = useCallback((tool: WorkspaceToolId | null) => {
    setSplitToolState(tool);
    write(SPLIT_KEY, tool ?? '');
  }, []);

  const openTool = useCallback(
    (tool: WorkspaceToolId) => {
      setActiveTool(tool);
      setToolSession((current) => current + 1);
      setOpenState(true);
      write(TOOL_KEY, tool);
      write(OPEN_KEY, 'open');
      if (PROJECT_SCOPED_TOOLS.has(tool)) write(PROJECT_KEY, projectKey ?? '');
    },
    [projectKey],
  );

  const toggleTool = useCallback(
    (tool: WorkspaceToolId) => {
      if (open && activeTool === tool) {
        setOpen(false);
        return;
      }
      openTool(tool);
    },
    [activeTool, open, openTool, setOpen],
  );

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === 'overlay' ? 'push' : 'overlay';
      write(MODE_KEY, next);
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((current) => {
      const next = !current;
      write(FULLSCREEN_KEY, String(next));
      return next;
    });
  }, []);

  return {
    open,
    activeTool,
    mode,
    fullscreen,
    toolSession,
    splitTool,
    setOpen,
    setSplitTool,
    openTool,
    toggleTool,
    toggleMode,
    toggleFullscreen,
  };
}
