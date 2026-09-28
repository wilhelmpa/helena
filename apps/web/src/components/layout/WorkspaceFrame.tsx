'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { attachCodeTheme } from '@/utils/codeTheme';

export default function WorkspaceFrame({
  url,
  title,
  active,
  reloadToken = 0,
  className,
  sandbox,
  helenaCode = false,
}: {
  url: string;
  title: string;
  active: boolean;
  reloadToken?: number;
  className?: string;
  // A plugin's page runs sandboxed: scripts and forms, never Helena's origin or session.
  sandbox?: string;
  helenaCode?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const { resolvedTheme } = useTheme();
  const previousReloadToken = useRef(reloadToken);

  useEffect(() => {
    if (!helenaCode) return;
    return attachCodeTheme(url, resolvedTheme === 'light' ? 'light' : 'dark');
  }, [helenaCode, resolvedTheme, url]);

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
      className={cn(
        'min-h-0 flex-1 rounded-b-xl border-0 bg-background',
        className,
        !active && 'hidden',
      )}
      style={helenaCode ? { colorScheme: resolvedTheme === 'light' ? 'light' : 'dark' } : undefined}
      onLoad={(event) => {
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
