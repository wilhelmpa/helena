import Link from 'next/link';
import { CircleAlert, CircleCheck, Clock3, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import { projectPath } from '@/utils/paths';
import { Inline, Text } from '@/design-system';

// A project on Start, inside the "Projekte" section: one compact cell that opens the
// project's board. Name and key on the first line (the key in mono, as in the sidebar), the
// team and the setup state on the second, the description as one muted line. The whole
// cell is the link; hover fills it with the sidebar's accent, the way a sidebar row answers.
export default function HomeProjectCard({ project }: { project: Project }) {
  const statusCopy = useTranslations('settings.actions.runStatus');
  const provisioning = useProjectProvisioningQuery(project.key).data;
  const status = provisioning?.status;
  const StatusIcon =
    status === 'succeeded' ? CircleCheck : status === 'failed' ? CircleAlert : Clock3;

  return (
    <Link
      href={projectPath(project.key)}
      className="group flex min-w-0 flex-col gap-1 rounded-md px-2 py-2 transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <Inline gap={2} className="min-w-0">
        <FolderKanban className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
        <h3 className="min-w-0 truncate text-sm font-medium" dir="auto">
          {project.name}
        </h3>
        <Text as="span" size="xs" tone="muted" className="ms-auto shrink-0 font-mono">
          {project.key}
        </Text>
      </Inline>
      <Inline gap={2} padStart={5} className="min-w-0 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{project.teamName}</span>
        {status ? (
          <span
            className={
              status === 'failed'
                ? 'flex shrink-0 items-center gap-1 text-status-danger'
                : 'flex shrink-0 items-center gap-1'
            }
            title={statusCopy(status)}
          >
            <StatusIcon className="size-3" />
            {statusCopy(status)}
          </span>
        ) : null}
      </Inline>
      {project.description ? (
        <Text as="p" size="xs" tone="muted" className="truncate ps-6" dir="auto">
          {project.description}
        </Text>
      ) : null}
    </Link>
  );
}
