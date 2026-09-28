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
import { projectLinkTarget } from '@/utils/projectLinkTarget';

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
    const onRequest = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      const target = projectLinkTarget(href, currentProjectKey, window.location.origin);
      if (target) setTarget(target);
    };
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
      const target = projectLinkTarget(
        anchor.getAttribute('href')!,
        currentProjectKey,
        window.location.origin,
      );
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(target);
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('helena:project-link', onRequest);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('helena:project-link', onRequest);
    };
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
