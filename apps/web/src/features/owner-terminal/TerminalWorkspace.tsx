'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import WorkspaceFrame from '@/components/layout/WorkspaceFrame';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { workspaceTools } from '@/utils/workspaceTools';
import type { WorkspaceContentProps } from '@/extensions/panelTools';
import OwnerTerminalPanel from './OwnerTerminalPanel';
import { attachTerminalClipboard } from './utils/terminalClipboard';
import { terminalClipboardToasts } from './utils/terminalClipboardToasts';
import { attachTerminalTheme } from '@/utils/terminalTheme';

// The "terminal" tool in the Werkzeug-Panel: the owner terminal in Home, the
// existing project terminal (a plain iframe, unchanged) everywhere else. See
// docs/volition-design-owner-terminals.md's Nachtrag ("Home-Terminal =
// Owner-Terminal"). Registered as a panel tool in extensions/panelTools.tsx.
export default function TerminalWorkspace({ projectKey }: WorkspaceContentProps) {
  const t = useTranslations('nav.workspace');
  const tTerminal = useTranslations('ownerTerminal');
  const { resolvedTheme } = useTheme();
  const workspaceConfig = runtimeEnv().workspace;
  const provisioning = useProjectProvisioningQuery(projectKey);
  const area = useRef<HTMLDivElement | null>(null);
  // The frame appears only once the terminal answers (WorkspaceFrame), and again after a
  // reconnect: each load attaches copy, paste and the theme to the frame now there.
  const [loads, setLoads] = useState(0);
  const resources = useMemo(
    () =>
      provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [],
    [provisioning.data],
  );
  const url = projectKey ? workspaceTools(workspaceConfig, projectKey, resources).terminal.url : '';
  // The terminal (xterm in the frame) fits itself on its window's resize event; the panel
  // resizing or the frame coming back from hidden does not always fire it, so the frame is
  // told to fit whenever the area changes (owner, 2026-09-24: "das Terminal überall groß
  // und responsive"). Copy and paste are wired up here as well (utils/terminalClipboard.ts).
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    const fit = () => {
      try {
        node.querySelector('iframe')?.contentWindow?.dispatchEvent(new Event('resize'));
      } catch {
        // Another origin or not loaded yet: its own load fits it.
      }
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    const frame = node.querySelector('iframe');
    const notes = terminalClipboardToasts({
      copied: tTerminal('clipboard.copied'),
      pressToCopy: (keys) => tTerminal('clipboard.pressToCopy', { keys }),
    });
    const detach = frame ? attachTerminalClipboard(frame, notes.copied, notes.pending) : undefined;
    const detachTheme = frame
      ? attachTerminalTheme(frame, resolvedTheme === 'light' ? 'light' : 'dark')
      : undefined;
    return () => {
      observer.disconnect();
      detach?.();
      detachTheme?.();
    };
  }, [projectKey, url, tTerminal, resolvedTheme, loads]);

  if (!projectKey) return <OwnerTerminalPanel />;
  if (!url) return null;
  return (
    <div ref={area} className="flex h-full min-h-0 flex-1 flex-col">
      <WorkspaceFrame
        url={url}
        title={t('terminal')}
        active
        className="flex-1"
        onLoaded={() => setLoads((value) => value + 1)}
      />
    </div>
  );
}
