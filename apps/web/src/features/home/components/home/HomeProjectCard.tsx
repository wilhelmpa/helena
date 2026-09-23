import Link from 'next/link';
import { CircleAlert, CircleCheck, Clock3, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';

export default function HomeProjectCard({ project }: { project: Project }) {
  const statusCopy = useTranslations('settings.actions.runStatus');
  const provisioning = useProjectProvisioningQuery(project.key).data;
  const status = provisioning?.status;
  const StatusIcon =
    status === 'succeeded' ? CircleCheck : status === 'failed' ? CircleAlert : Clock3;

  return (
    <Link
      href={projectPath(project.key)}
      className="group flex min-h-32 min-w-0 flex-col rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:text-foreground">
          <FolderKanban className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold" dir="auto">
              {project.name}
            </h2>
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
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {project.key} · {project.teamName}
          </p>
        </div>
      </div>
      {project.description ? (
        <p className="mt-3 line-clamp-2 text-sm break-words text-muted-foreground" dir="auto">
          {project.description}
        </p>
      ) : null}
    </Link>
  );
}
