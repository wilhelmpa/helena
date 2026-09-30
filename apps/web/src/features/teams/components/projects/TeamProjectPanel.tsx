'use client';

import { useTranslations } from 'next-intl';
import type { TeamProject, TeamRole } from '@/lib/api/endpoints/teams';
import { formatDate, formatDateTime } from '@/utils/dates';
import { useTeamProjectQuery } from '@/services/teams.service';
import { useSession } from '@/lib/auth-client';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Overlay, Stack } from '@/design-system';
import TeamProjectActions from './TeamProjectActions';
import TeamProjectMembers from './TeamProjectMembers';
import TeamProjectStats from './TeamProjectStats';

// One project of the team in the one overlay on the right (the same surface the role editor
// uses): what the project is and what the reader may do with it in the head, then how its
// issues stand and who can reach it. Esc closes it.
export default function TeamProjectPanel({
  teamId,
  teamName,
  teamRole,
  project,
  onClose,
}: {
  teamId: number;
  teamName: string;
  teamRole: TeamRole;
  project: TeamProject;
  onClose: () => void;
}) {
  const t = useTranslations('teams.panel');
  const { data: detail } = useTeamProjectQuery(teamId, project.id);
  const { data: session } = useSession();

  // An owner or manager of the team manages the members of every project it owns, and
  // so does an owner of the project itself; anyone else acts through the member
  // permission of their own membership, as the project's members page does. The API
  // enforces the same pair.
  const viewer = detail?.viewer ?? null;
  const runsProject = teamRole === 'owner' || teamRole === 'manager' || viewer?.role === 'owner';
  const canEdit = runsProject || viewer?.permissions.members_manage.edit === true;
  const canDelete = runsProject || viewer?.permissions.members_manage.delete === true;
  const canAdd = runsProject || viewer?.permissions.members_manage.create === true;
  const canInvite = runsProject || viewer?.permissions.members_invite.create === true;
  const canReadInvites = runsProject || viewer?.permissions.members_invite.read === true;

  return (
    <Overlay
      label={project.name}
      tabs={[{ id: 'project', label: `${project.key} · ${project.name}` }]}
      actions={
        <TeamProjectActions teamId={teamId} teamRole={teamRole} project={project} viewer={viewer} />
      }
      onClose={onClose}
      className="ds-team-project-overlay"
      width="wide"
    >
      <Stack gap={6}>
        {!detail ? (
          <ListSkeleton rows={5} rowClassName="h-12" />
        ) : (
          <>
            <section className="space-y-3">
              {project.description && (
                <p dir="auto" className="text-sm text-foreground">
                  {project.description}
                </p>
              )}
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>{t('created', { date: formatDate(project.createdAt) })}</span>
                <span>
                  {t('lastActivity', {
                    value: detail.lastActivityAt
                      ? formatDateTime(detail.lastActivityAt)
                      : t('noActivity'),
                  })}
                </span>
              </div>
              <TeamProjectStats stats={detail.stats} />
            </section>

            <TeamProjectMembers
              teamId={teamId}
              projectId={project.id}
              projectKey={project.key}
              ownerCount={project.owners.length}
              viewerId={session?.user.id}
              projectName={project.name}
              teamName={teamName}
              canEdit={canEdit}
              canDelete={canDelete}
              canAdd={canAdd}
              canInvite={canInvite}
              canGrantOwner={runsProject}
              canReadInvites={canReadInvites}
            />
          </>
        )}
      </Stack>
    </Overlay>
  );
}
