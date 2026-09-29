'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { attachCodeTheme } from '@/utils/codeTheme';
import { EmbedConnecting, EmbedProblem } from '@/design-system';
import { useFrameGuard } from '@/hooks/useFrameGuard';
import { usePanelToolClose } from '@/context/panelToolTab';

export default function WorkspaceFrame({
  url,
  title,
  active,
  reloadToken = 0,
  className,
  sandbox,
  helenaCode = false,
  onLoaded,
  onClose,
}: {
  url: string;
  title: string;
  active: boolean;
  reloadToken?: number;
  className?: string;
  // A plugin's page runs sandboxed: scripts and forms, never Helena's origin or session.
  sandbox?: string;
  helenaCode?: boolean;
  // The frame's page has loaded (the host may cover it until then).
  onLoaded?: () => void;
  // "Tab schließen" of the view shown when it does not answer; the panel's tab by default.
  onClose?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { resolvedTheme } = useTheme();
  // Shown only once the address answers, Ava's own view when it does not (Auftrag 116);
  // "Neu laden" asks again and loads a fresh frame.
  const guard = useFrameGuard({ url, active, reloadToken });
  const closeTab = usePanelToolClose();

  useEffect(() => {
    if (!helenaCode) return;
    return attachCodeTheme(url, resolvedTheme === 'light' ? 'light' : 'dark');
  }, [helenaCode, resolvedTheme, url]);

  if (!guard.showFrame) {
    if (!active) return null;
    return guard.state.phase === 'failed' ? (
      <EmbedProblem
        tool={title}
        reason={guard.state.reason}
        status={guard.state.status}
        retrying={guard.state.retrying}
        onReload={guard.retry}
        onClose={onClose ?? closeTab ?? undefined}
      />
    ) : (
      <EmbedConnecting tool={title} />
    );
  }

  return (
    <iframe
      key={guard.session}
      ref={frame}
      src={url}
      title={title}
      loading="lazy"
      className={cn(
        'min-h-0 flex-1 rounded-b-lg border-0 bg-background',
        className,
        !active && 'hidden',
      )}
      style={helenaCode ? { colorScheme: resolvedTheme === 'light' ? 'light' : 'dark' } : undefined}
      onLoad={(event) => {
        guard.onLoad(event.currentTarget);
        onLoaded?.();
        if (!helenaCode) return;
        try {
          const doc = event.currentTarget.contentDocument;
          if (!doc?.head || doc.getElementById('helena-code-fonts')) return;
          const style = doc.createElement('style');
          style.id = 'helena-code-fonts';
          style.textContent = `@font-face{font-family:InterVariable;src:url('/fonts/helena-inter.woff2') format('woff2');font-weight:100 900;font-display:swap}@font-face{font-family:'JetBrains Mono';src:url('/fonts/helena-jetbrains-mono-latin.woff2') format('woff2');font-weight:100 900;font-display:swap}.monaco-workbench,.monaco-workbench .part.sidebar,.monaco-workbench .part.activitybar{font-family:InterVariable,Inter,sans-serif;font-size:13px}.monaco-workbench .part.sidebar .codicon,.monaco-workbench .part.activitybar .codicon{color:#8b8595}`;
          doc.head.appendChild(style);
        } catch {
          // A deployment may serve code-server from another origin.
        }
      }}
      allow="clipboard-read; clipboard-write"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      sandbox={sandbox}
    />
  );
}
