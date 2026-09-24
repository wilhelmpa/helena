'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { issuePath, projectPath } from '@/utils/paths';
import type { useOverlays } from '@/hooks/useOverlays';
import NewProjectModal from '@/components/layout/NewProjectModal';
import NewTeamModal from '@/features/teams/components/NewTeamModal';
import InitiativeDialog from '@/components/common/overlay/InitiativeDialog';
import NewIssueModal from '@/features/issue/components/create/NewIssueModal';
import IssueDetail from '@/features/issue/components/detail/IssueDetail';

// The project-level overlays the Shell mounts above its content. Each renders only
// while its overlay state says it is open.
export default function ShellOverlays({
  project,
  projectKey,
  overlays,
}: {
  project: ProjectDetail | null;
  projectKey: string | null;
  overlays: ReturnType<typeof useOverlays>;
}) {
  const router = useRouter();
  const t = useTranslations('issue.create');

  return (
    <>
      {overlays.showNewProject && (
        <NewProjectModal
          onClose={() => overlays.setShowNewProject(false)}
          onCreated={(key) => {
            overlays.setShowNewProject(false);
            router.push(projectPath(key));
          }}
        />
      )}

      {overlays.showNewTeam && <NewTeamModal onClose={() => overlays.setShowNewTeam(false)} />}

      {projectKey && overlays.showNewInitiative && (
        <InitiativeDialog
          projectKey={projectKey}
          onClose={() => overlays.setShowNewInitiative(false)}
        />
      )}

      {project && overlays.newIssueDefaults != null && (
        <NewIssueModal
          project={project}
          defaults={overlays.newIssueDefaults}
          onClose={() => overlays.setNewIssueDefaults(null)}
          onCreated={(created) => {
            overlays.setNewIssueDefaults(null);
            // Wherever the task was started (a note, the board, the palette), it says
            // it exists and leads to it.
            toast.success(t('created', { identifier: created.identifier }), {
              action: { label: t('open'), onClick: () => overlays.setOpenIssueId(created.id) },
            });
          }}
        />
      )}

      {project && overlays.openIssueId != null && (
        <IssueDetail
          project={project}
          issueId={overlays.openIssueId}
          onClose={() => overlays.setOpenIssueId(null)}
          onExpand={(seq) => {
            // Prefer the number the panel loaded; fall back to the board issue.
            const n =
              seq ??
              project.issues.find((i) => i.id === overlays.openIssueId)?.sequenceNumber ??
              null;
            if (projectKey && n != null) router.push(issuePath(projectKey, n));
            overlays.setOpenIssueId(null);
          }}
        />
      )}
    </>
  );
}
