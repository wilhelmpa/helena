'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import {
  themeServiceForTool,
  WORKSPACE_THEME_SYNCED_EVENT,
  type WorkspaceTheme,
  type WorkspaceThemeService,
} from '@/utils/workspaceTheme';
import { cn } from '@/lib/utils';

export default function WorkspaceFrame({
  url,
  title,
  active,
  tool,
}: {
  url: string;
  title: string;
  active: boolean;
  tool: WorkspaceToolId;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const reloadPending = useRef(false);
  const { resolvedTheme } = useTheme();

  const sendOpenClawTheme = useCallback(
    (theme: WorkspaceTheme) => {
      if (tool !== 'chat' || !frame.current?.contentWindow) return;
      const targetOrigin = new URL(url).origin;
      frame.current.contentWindow.postMessage({ type: 'volition:set-theme', theme }, targetOrigin);
    },
    [tool, url],
  );

  useEffect(() => {
    const service = themeServiceForTool(tool);
    if (!service) return;
    const handleTheme = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          theme?: WorkspaceTheme;
          services?: WorkspaceThemeService[];
        }>
      ).detail;
      if (!Array.isArray(detail?.services) || !detail.services.includes(service)) return;
      if (service === 'openclaw' && (detail.theme === 'light' || detail.theme === 'dark')) {
        sendOpenClawTheme(detail.theme);
        return;
      }
      if (active && frame.current) frame.current.src = url;
      else reloadPending.current = true;
    };
    window.addEventListener(WORKSPACE_THEME_SYNCED_EVENT, handleTheme);
    return () => window.removeEventListener(WORKSPACE_THEME_SYNCED_EVENT, handleTheme);
  }, [active, sendOpenClawTheme, tool, url]);

  useEffect(() => {
    if (active && reloadPending.current && frame.current) {
      reloadPending.current = false;
      frame.current.src = url;
    }
  }, [active, url]);

  return (
    <iframe
      ref={frame}
      src={url}
      title={title}
      loading="lazy"
      className={cn('min-h-0 flex-1 border-0 bg-background', !active && 'hidden')}
      allow="clipboard-read; clipboard-write"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      onLoad={() => {
        if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
          sendOpenClawTheme(resolvedTheme);
        }
      }}
    />
  );
}
