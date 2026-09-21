'use client';

import { useCallback, useEffect, useState } from 'react';
import { WORKSPACE_TOOL_IDS } from '@/utils/workspaceTools';
import type { WorkspaceToolId } from '@/utils/workspaceTools';

export type WorkspacePanelMode = 'overlay' | 'push';

const OPEN_KEY = 'workspace:panel:open';
const TOOL_KEY = 'workspace:panel:tool';
const MODE_KEY = 'workspace:panel:mode';
const FULLSCREEN_KEY = 'workspace:panel:fullscreen';

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

export function useWorkspacePanel({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const [open, setOpenState] = useState(false);
  const [activeTool, setActiveTool] = useState<WorkspaceToolId>('chat');
  const [mode, setMode] = useState<WorkspacePanelMode>('overlay');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    try {
      const savedOpen = localStorage.getItem(OPEN_KEY);
      setOpenState(savedOpen === null ? defaultOpen : savedOpen === 'open');
      const storedTool = localStorage.getItem(TOOL_KEY);
      if (isToolId(storedTool)) setActiveTool(storedTool);
      setMode(localStorage.getItem(MODE_KEY) === 'push' ? 'push' : 'overlay');
      setFullscreen(localStorage.getItem(FULLSCREEN_KEY) === 'true');
    } catch {
      return;
    }
  }, [defaultOpen]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    write(OPEN_KEY, next ? 'open' : 'closed');
  }, []);

  const openTool = useCallback((tool: WorkspaceToolId) => {
    setActiveTool(tool);
    setOpenState(true);
    write(TOOL_KEY, tool);
    write(OPEN_KEY, 'open');
  }, []);

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
    setOpen,
    openTool,
    toggleTool,
    toggleMode,
    toggleFullscreen,
  };
}
