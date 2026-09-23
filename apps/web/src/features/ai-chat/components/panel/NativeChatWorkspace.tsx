'use client';

import { useContext, useMemo } from 'react';
import { ShellCtx } from '@/context/shellContext';
import type { WorkspaceContentProps } from '@/context/workspaceContents';
import { soleTeamId } from '@/features/home/homeTeamScope';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { nativeChatProjectKey, preferredAgentUsername } from '@/utils/workspaceTools';
import { ChatPanelBody } from './ChatPanelBody';

// Project chats keep their project permission boundary. Home uses the member's sole
// team directly, so a fresh installation can talk to its global master before the
// first project exists.
export default function NativeChatWorkspace({ projectKey }: WorkspaceContentProps) {
  const config = runtimeEnv().workspace;
  const shell = useContext(ShellCtx);
  const teams = useTeamsQuery();
  const homeTeamId = projectKey ? null : soleTeamId(teams.data);
  const chatProjectKey = projectKey ? nativeChatProjectKey(config, projectKey) : null;
  const scopeKey = chatProjectKey ?? (homeTeamId == null ? null : `team:${homeTeamId}`);
  const project = useProjectQuery(chatProjectKey);
  const teamId = project.data?.project.teamId ?? homeTeamId;
  const agentsQuery = useAiAgentsQuery(teamId, project.data?.project.id);
  const desiredUsername = preferredAgentUsername(projectKey);
  const agents = useMemo(() => {
    const available = agentsQuery.data ?? [];
    const desired = available.find((agent) => agent.username === desiredUsername);
    return desired ? [desired, ...available.filter((agent) => agent.id !== desired.id)] : available;
  }, [agentsQuery.data, desiredUsername]);

  if (!scopeKey) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Home chat is waiting for the first account.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPanelBody
        projectKey={scopeKey}
        newChatAgentId={null}
        onNewChatHandled={() => undefined}
        openThreadRequest={shell?.chatThreadRequest ?? null}
        onOpenThreadHandled={shell?.onChatThreadHandled}
        agents={agents}
        agentsLoading={teams.isLoading || project.isLoading || agentsQuery.isLoading}
      />
    </div>
  );
}
