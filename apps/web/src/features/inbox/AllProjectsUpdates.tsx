'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import type { NotificationType } from '@/lib/api/endpoints/notifications';
import { issuePath } from '@/utils/paths';
import { useNotificationsQuery } from './services/notifications.service';

const TYPE_ORDER: NotificationType[] = [
  'approval_requested',
  'mentioned',
  'assigned',
  'commented',
  'state_changed',
];

function ProjectUpdates({ project }: { project: Project }) {
  const t = useTranslations('inbox');
  const query = useNotificationsQuery(project.key, project.id, {});
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <details className="rounded-xl bg-card px-4 py-3" open>
      <summary className="cursor-pointer font-medium">
        {project.name} <span className="text-muted-foreground">{items.length}</span>
      </summary>
      <div className="mt-3 space-y-3">
        {TYPE_ORDER.map((type) => {
          const group = items.filter((item) => item.type === type);
          if (group.length === 0) return null;
          return (
            <section key={type} className="space-y-2">
              <h3 className="font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
                {t(`types.${type}`)} · {group.length}
              </h3>
              {group.map((item) => (
                <Link
                  key={item.id}
                  href={issuePath(item.projectKey, item.issueSeq)}
                  className="block rounded-lg bg-background p-3 hover:bg-accent"
                >
                  <span className="block text-xs text-muted-foreground">
                    {item.projectKey}-{item.issueSeq}
                  </span>
                  <span>{item.issueTitle}</span>
                </Link>
              ))}
            </section>
          );
        })}
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
