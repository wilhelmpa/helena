'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/api/endpoints/projects';

// A normal link never changes the selected project. The explicit button is the only
// way out of the current project, just like choosing one in the switcher.
export default function ProjectLinkSheet({
  currentProjectKey,
  projects,
}: {
  currentProjectKey: string | null;
  projects: Project[];
}) {
  const router = useRouter();
  const t = useTranslations('nav');
  const [target, setTarget] = useState<{ href: string; key: string } | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest('a[href]');
      if (!anchor || anchor.closest('[data-project-switcher]')) return;
      const url = new URL(anchor.getAttribute('href')!, window.location.href);
      if (url.origin !== window.location.origin) return;
      const match = /^\/project\/([^/]+)/.exec(url.pathname);
      if (!match) return;
      const key = decodeURIComponent(match[1]!);
      if (key === currentProjectKey) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget({ href: `${url.pathname}${url.search}${url.hash}`, key });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [currentProjectKey]);

  const name = projects.find((project) => project.key === target?.key)?.name ?? target?.key;
  return (
    <Sheet
      open={target != null}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
    >
      <SheetContent className="w-full sm:max-w-[440px]">
        <SheetHeader>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>{target?.href}</SheetDescription>
        </SheetHeader>
        <div className="px-4 text-sm text-muted-foreground">{t('projectLinkHint')}</div>
        {target && (
          <iframe
            title={name ?? target.key}
            src={target.href}
            sandbox="allow-same-origin"
            className="min-h-0 flex-1 border-0 bg-background"
          />
        )}
        <SheetFooter>
          <Button
            onClick={() => {
              if (target) router.push(target.href);
              setTarget(null);
            }}
          >
            {t('openInProject')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
