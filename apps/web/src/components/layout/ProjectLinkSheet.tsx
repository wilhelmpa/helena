'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { Button, Overlay } from '@/design-system';
import OrganizationTaskSheet from '@/components/common/organization/OrganizationTaskSheet';
import type { Project } from '@/lib/api/endpoints/projects';
import { projectLinkTarget, type ProjectLinkTarget } from '@/utils/projectLinkTarget';

// A normal link never changes the selected project (docs/ui-system.md §8). A link to a
// task of another project opens that task in the overlay over the current page; any other
// page of another project opens a small overlay that names it and offers "Im Projekt
// öffnen", the explicit way out of the current project like the switcher. Helena's pages
// cannot be framed (X-Frame-Options DENY, frame-ancestors 'none'), so nothing is embedded:
// an iframe here showed the browser's "refused to connect" page.
export default function ProjectLinkSheet({
  currentProjectKey,
  projects,
}: {
  currentProjectKey: string | null;
  projects: Project[];
}) {
  const router = useRouter();
  const t = useTranslations('nav');
  const [target, setTarget] = useState<ProjectLinkTarget | null>(null);

  useEffect(() => {
    const onRequest = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      const target = projectLinkTarget(href, currentProjectKey, window.location.origin);
      // A page that needs no sheet (Helena's own pages, the open project) is opened.
      if (target) setTarget(target);
      else router.push(href);
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
  }, [currentProjectKey, router]);

  const close = useCallback(() => setTarget(null), []);
  // A task that is not on its project's board: the page overlay instead.
  const noTask = useCallback(
    () => setTarget((current) => (current ? { href: current.href, key: current.key } : null)),
    [],
  );
  if (!target) return null;
  if (target.issue != null)
    return (
      <OrganizationTaskSheet
        key={target.href}
        projectKey={target.key}
        sequenceNumber={target.issue}
        onClose={close}
        onMissing={noTask}
      />
    );

  const name = projects.find((project) => project.key === target.key)?.name ?? target.key;
  const open = () => {
    router.push(target.href);
    close();
  };
  return (
    <Overlay
      label={name}
      tabs={[{ id: 'project', label: name }]}
      onClose={close}
      onFullscreen={open}
      closeOnOutsideClick
      className="ds-project-link"
    >
      <div className="ds-project-link-body" data-project-link>
        <p className="ds-project-link-hint">{t('projectLinkHint')}</p>
        <code className="ds-project-link-path">{target.href}</code>
        <div>
          <Button variant="primary" icon={<ArrowUpRight size={14} />} onClick={open}>
            {t('openInProject')}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
