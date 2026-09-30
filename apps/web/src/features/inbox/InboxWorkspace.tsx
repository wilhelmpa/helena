'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Users } from 'lucide-react';
import { PageSelect } from '@/components/layout/PageToolbar';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { useProjectMailAccounts } from '@/services/mail.service';
import MailInbox from './components/MailInbox';
import { resolveInboxTeamId } from './inboxTeamScope';
import { ButtonLink, EmptyState } from '@/design-system';
import { settingsPath } from '@/utils/paths';

// The mail inbox of Home's inbox page (no longer a tool of the panel, owner O106). Its
// controls, the team among them, are the page's header row (see MailInbox).
export default function InboxWorkspace({
  projectKey,
  leading,
}: {
  projectKey: string | null;
  leading?: ReactNode;
}) {
  const teamCopy = useTranslations('teams');
  const inboxCopy = useTranslations('inbox.hub');
  const teams = useTeamsQuery();
  const projects = useProjectsQuery();
  const projectAccounts = useProjectMailAccounts(projectKey ?? undefined);
  const project = projects.data?.find((item) => item.key === projectKey);
  const [teamId, setTeamId] = useState<number | null>(null);

  useEffect(() => {
    const next = resolveInboxTeamId({
      projectKey,
      projectTeamId: project?.teamId,
      currentTeamId: teamId,
      availableTeamIds: (teams.data ?? []).map((team) => team.id),
    });
    if (next !== teamId) setTeamId(next);
  }, [projectKey, teamId, teams.data, project?.teamId]);

  const projectPending = projectKey != null && (projects.isPending || projectAccounts.isPending);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {teams.isPending || projectPending ? (
        <EmptyState>{inboxCopy('loading')}</EmptyState>
      ) : projectKey && !projectAccounts.data?.length ? (
        // A symbol, one sentence and the way to fix it (owner, O62).
        <EmptyState
          icon={<Mail />}
          action={
            <ButtonLink href={settingsPath(projectKey, 'mail')} size="small">
              {inboxCopy('connectMailbox')}
            </ButtonLink>
          }
        >
          {inboxCopy('noProjectMailbox')}
        </EmptyState>
      ) : teamId == null ? (
        <EmptyState icon={<Users />}>{teamCopy('manage.empty')}</EmptyState>
      ) : (
        <MailInbox
          key={`${teamId}:${project?.id ?? 'all'}`}
          teamId={teamId}
          projectId={project?.id}
          toolbar
          leading={
            !projectKey && (teams.data?.length ?? 0) > 1 ? (
              <>
                {leading}
                <PageSelect
                  label={teamCopy('info.team')}
                  icon={Users}
                  value={String(teamId)}
                  onChange={(value) => setTeamId(Number(value))}
                  options={(teams.data ?? []).map((team) => ({
                    value: String(team.id),
                    label: team.name,
                  }))}
                />
              </>
            ) : (
              leading
            )
          }
        />
      )}
    </div>
  );
}
