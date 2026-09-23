'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export default function WorkspaceFrame({
  url,
  title,
  active,
  reloadToken = 0,
  className,
}: {
  url: string;
  title: string;
  active: boolean;
  reloadToken?: number;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const previousReloadToken = useRef(reloadToken);

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
