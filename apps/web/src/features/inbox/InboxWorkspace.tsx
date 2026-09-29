'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Users } from 'lucide-react';
import { PageSelect } from '@/components/layout/PageToolbar';
import { useProjectsQuery } from '@/services/projects.service';
import type { WorkspaceContentProps } from '@/extensions/panelTools';
import { useTeamsQuery } from '@/services/teams.service';
import { useProjectMailAccounts } from '@/services/mail.service';
import MailInbox from './components/MailInbox';
import { resolveInboxTeamId } from './inboxTeamScope';
import { Text } from '@/design-system';

// The mail inbox of the tool panel and of Home's inbox page (`page`). On the page its
// controls, the team among them, are the page's header row (see MailInbox).
export default function InboxWorkspace({
  projectKey,
  page = false,
  leading,
}: WorkspaceContentProps & { page?: boolean; leading?: ReactNode }) {
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
      {!page && !projectKey && (teams.data?.length ?? 0) > 1 ? (
        <label className="flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground">{teamCopy('info.team')}</span>
          <select
            className="ds-field ds-select-native"
            value={teamId ?? ''}
            onChange={(event) => setTeamId(Number(event.target.value))}
          >
            {teams.data?.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {teams.isPending || projectPending ? (
        <Text as="p" size="sm" tone="muted" className="p-4">
          {inboxCopy('loading')}
        </Text>
      ) : projectKey && !projectAccounts.data?.length ? (
        <Text as="p" size="sm" tone="muted" className="p-4">
          {inboxCopy('noProjectMailbox')}
        </Text>
      ) : teamId == null ? (
        <Text as="p" size="sm" tone="muted" className="p-4">
          {teamCopy('manage.empty')}
        </Text>
      ) : (
        <MailInbox
          key={`${teamId}:${project?.id ?? 'all'}`}
          teamId={teamId}
          projectId={project?.id}
          toolbar={page}
          leading={
            page && !projectKey && (teams.data?.length ?? 0) > 1 ? (
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
