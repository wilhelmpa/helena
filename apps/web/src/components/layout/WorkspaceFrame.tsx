'use client';

import { useEffect, useRef } from 'react';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import {
  themeServiceForTool,
  WORKSPACE_THEME_SYNCED_EVENT,
  type WorkspaceThemeService,
} from '@/utils/workspaceTheme';
import { cn } from '@/lib/utils';

export default function WorkspaceFrame({
  url,
  title,
  active,
  tool,
  reloadToken = 0,
  className,
}: {
  url: string;
  title: string;
  active: boolean;
  tool: WorkspaceToolId;
  reloadToken?: number;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const reloadPending = useRef(false);
  const previousReloadToken = useRef(reloadToken);
  useEffect(() => {
    const service = themeServiceForTool(tool);
    if (!service) return;
    const handleTheme = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          services?: WorkspaceThemeService[];
        }>
      ).detail;
      if (!Array.isArray(detail?.services) || !detail.services.includes(service)) return;
      if (active && frame.current) frame.current.src = url;
      else reloadPending.current = true;
    };
    window.addEventListener(WORKSPACE_THEME_SYNCED_EVENT, handleTheme);
    return () => window.removeEventListener(WORKSPACE_THEME_SYNCED_EVENT, handleTheme);
  }, [active, tool, url]);

  useEffect(() => {
    if (active && reloadPending.current && frame.current) {
      reloadPending.current = false;
      frame.current.src = url;
    }
  }, [active, url]);

  useEffect(() => {
    if (previousReloadToken.current === reloadToken) return;
    previousReloadToken.current = reloadToken;
    if (frame.current) frame.current.src = url;
  }, [reloadToken, url]);

  return (
    <iframe
      ref={frame}
      src={url}
      title={title}
      loading="lazy"
      className={cn('min-h-0 flex-1 border-0 bg-background', className, !active && 'hidden')}
      allow="clipboard-read; clipboard-write"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
