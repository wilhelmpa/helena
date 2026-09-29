'use client';

import { useMemo } from 'react';
import { useProjectQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { preferredAgentUsername } from '@/utils/workspaceTools';
import { soleTeamId } from '@/utils/homeTeamScope';
import { contextAgents } from '../utils/contextAgents';

// The scope the chat API routes take — a project key, or `team:<id>` for Home — and the
// agents a chat can be started with: the scope's external agents, the project's own
// preferred one first (the same agent the project's terminal and browser tools open
// on). A pool template runs nowhere and can never answer, so it is not offered at all
// (the pool's own decision for every picker). Shared by the full-page chat
// (ChatWorkspaceRoot) and the tool panel's (panel/NativeChatWorkspace), so a fresh
// installation talks to its global master before the first project exists in both the
// same way.
export function useChatWorkspaceScope(
  projectKey: string | null,
  contextProjectKey?: string | null,
) {
  const teams = useTeamsQuery();
  const project = useProjectQuery(projectKey);
  const homeTeamId = projectKey ? null : soleTeamId(teams.data);
  const teamId = project.data?.project.teamId ?? homeTeamId;
  const agentsQuery = useAiAgentsQuery(teamId, project.data?.project.id);
  // The place the chat is opened from: its own project, or — for Helena's panel — the
  // project the page behind it belongs to (owner, 28.09., O41).
  const place = projectKey ?? contextProjectKey ?? null;
  const desiredUsername = preferredAgentUsername(place);
  const agents = useMemo(
    () =>
      contextAgents(
        (agentsQuery.data ?? []).filter((agent) => !agent.template),
        place,
        desiredUsername,
      ),
    [agentsQuery.data, desiredUsername, place],
  );
  const scopeKey = projectKey ?? (homeTeamId == null ? null : `team:${homeTeamId}`);
  const loading = teams.isLoading || project.isLoading || agentsQuery.isLoading;

  return { scopeKey, teamId, agents, loading };
}
