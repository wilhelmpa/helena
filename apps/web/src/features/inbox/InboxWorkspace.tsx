'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectsQuery } from '@/services/projects.service';
import type { WorkspaceContentProps } from '@/context/workspaceContents';
import { useTeamsQuery } from '@/services/teams.service';
import HubInboxView from './components/HubInboxView';
import { resolveInboxTeamId } from './inboxTeamScope';

export default function InboxWorkspace({ projectKey }: WorkspaceContentProps) {
  const teamCopy = useTranslations('teams');
  const inboxCopy = useTranslations('inbox.hub');
  const teams = useTeamsQuery();
  const projects = useProjectsQuery();
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

  const projectPending = projectKey != null && projects.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!projectKey && (teams.data?.length ?? 0) > 1 ? (
        <label className="flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground">{teamCopy('info.team')}</span>
          <select
            className="h-8 rounded-md border bg-background px-2"
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
        <p className="p-4 text-sm text-muted-foreground">{inboxCopy('loading')}</p>
      ) : teamId == null ? (
        <p className="p-4 text-sm text-muted-foreground">{teamCopy('manage.empty')}</p>
      ) : (
        <HubInboxView
          key={`${teamId}:${project?.id ?? 'all'}`}
          teamId={teamId}
          initialProjectId={project?.id}
        />
      )}
    </div>
  );
}
