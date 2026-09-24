'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CircleAlert, FolderKanban } from 'lucide-react';
import type { Project } from '@/lib/api/endpoints/projects';
import { ROW_CLASS, ROW_INTERACTIVE_CLASS, RowEmpty } from '@/components/common/page/RowList';
import { useProjectProvisioningQuery, useProjectsQuery } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';
import { cn } from '@/lib/utils';
import { SkeletonRows } from '../DashboardCard';
import HomeProjectCard from '../../components/home/HomeProjectCard';

// A project as a sidebar row: its name, its key in mono where the sidebar has it, and a
// red mark when setting it up failed. The row opens the project's board.
function ProjectRow({ project }: { project: Project }) {
  const statusCopy = useTranslations('settings.actions.runStatus');
  const status = useProjectProvisioningQuery(project.key).data?.status;
  return (
    <Link href={projectPath(project.key)} className={cn(ROW_CLASS, ROW_INTERACTIVE_CLASS)}>
      <FolderKanban />
      <span className="min-w-0 shrink truncate" dir="auto">
        {project.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" dir="auto">
        {project.description}
      </span>
      {status === 'failed' && (
        <CircleAlert className="size-3.5! text-status-danger!" aria-label={statusCopy(status)} />
      )}
      <span className="shrink-0 font-mono text-xs text-muted-foreground">{project.key}</span>
    </Link>
  );
}

export default function ProjectRows({ tiles = false }: { tiles?: boolean }) {
  const t = useTranslations('home');
  const projects = useProjectsQuery();
  if (projects.isPending) return <SkeletonRows count={3} />;
  const list = projects.data ?? [];
  if (list.length === 0) return <RowEmpty icon={<FolderKanban />}>{t('projects.empty')}</RowEmpty>;
  if (tiles)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
        {list.map((project) => (
          <HomeProjectCard key={project.id} project={project} />
        ))}
      </div>
    );
  return (
    <>
      {list.map((project) => (
        <ProjectRow key={project.id} project={project} />
      ))}
    </>
  );
}
