'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { Skeleton } from '@/components/ui/skeleton';
import ChatWorkspace from './ChatWorkspace';

function soleTeamId(teams: Array<{ id: number }> | undefined): number | null {
  return teams?.length === 1 ? teams[0]!.id : null;
}

// The chat page mounted at /chat (Home, every project) and at
// /project/:projectKey/chat (one project). Resolves the scope the new API routes take
// — a project key, or `team:<id>` for Home — the same way the tool panel's chat does,
// so a fresh installation can talk to its global master before the first project
// exists.
export default function ChatWorkspaceRoot({ projectKey }: { projectKey: string | null }) {
  const t = useTranslations('chatWorkspace');
  const teams = useTeamsQuery();
  const project = useProjectQuery(projectKey);
  const homeTeamId = projectKey ? null : soleTeamId(teams.data);
  const teamId = project.data?.project.teamId ?? homeTeamId;
  const agentsQuery = useAiAgentsQuery(teamId, project.data?.project.id);
  const agents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => agent.kind === 'external' && !agent.template),
    [agentsQuery.data],
  );
  const scopeKey = projectKey ?? (homeTeamId == null ? null : `team:${homeTeamId}`);
  const loading = teams.isLoading || project.isLoading || agentsQuery.isLoading;

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 p-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-full w-full flex-1" />
      </div>
    );
  }

  if (!scopeKey || teamId == null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {projectKey ? null : t('waitingForTeam')}
      </div>
    );
  }

  return <ChatWorkspace scopeKey={scopeKey} projectKey={projectKey} agents={agents} />;
}
