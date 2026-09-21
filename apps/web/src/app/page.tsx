'use client';

import Link from 'next/link';
import { CircleAlert, CircleCheck, Clock3, FolderKanban, MessageSquareText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import type { Project } from '@/lib/api/endpoints/projects';
import { useProjectProvisioningQuery, useProjectsQuery } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';

function ProjectCard({ project }: { project: Project }) {
  const statusCopy = useTranslations('settings.actions.runStatus');
  const provisioning = useProjectProvisioningQuery(project.key).data;
  const status = provisioning?.status;
  const StatusIcon =
    status === 'succeeded' ? CircleCheck : status === 'failed' ? CircleAlert : Clock3;

  return (
    <Link
      href={projectPath(project.key)}
      className="group flex min-h-32 flex-col rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
          <FolderKanban className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="truncate text-sm font-semibold">{project.name}</h2>
            {status ? (
              <span
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                title={statusCopy(status)}
              >
                <StatusIcon className="size-3.5" />
                {statusCopy(status)}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {project.key} · {project.teamName}
          </p>
        </div>
      </div>
      {project.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{project.description}</p>
      ) : null}
    </Link>
  );
}

export default function Home() {
  const t = useTranslations('nav');
  const projects = useProjectsQuery();
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-start gap-3">
            <MessageSquareText className="mt-0.5 size-8 shrink-0 text-muted-foreground" />
            <div>
              <h1 className="text-xl font-semibold">{t('home')}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t('globalHomeHint')}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.data?.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}
