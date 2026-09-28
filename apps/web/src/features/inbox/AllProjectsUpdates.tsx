'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { issuePath } from '@/utils/paths';
import { useNotificationsQuery } from './services/notifications.service';

function ProjectUpdates({ project }: { project: Project }) {
  const t = useTranslations('inbox');
  const query = useNotificationsQuery(project.key, project.id, {});
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <details className="rounded-xl bg-card px-4 py-3" open>
      <summary className="cursor-pointer font-medium">
        {project.name} <span className="text-muted-foreground">{items.length}</span>
      </summary>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <Link
            key={item.id}
            href={issuePath(item.projectKey, item.issueSeq)}
            className="block rounded-lg bg-background p-3 hover:bg-accent"
          >
            <span className="block text-xs text-muted-foreground">
              {t(`types.${item.type}`)} · {item.projectKey}-{item.issueSeq}
            </span>
            <span>{item.issueTitle}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}

export default function AllProjectsUpdates({ projects }: { projects: Project[] }) {
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      {projects.map((project) => (
        <ProjectUpdates key={project.id} project={project} />
      ))}
    </div>
  );
}
