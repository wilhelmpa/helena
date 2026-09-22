'use client';

import { useMemo } from 'react';
import type { WorkspaceContentProps } from '@/context/workspaceContents';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectProvisioningQuery, useProjectQuery } from '@/services/projects.service';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { coordinatorUsername, nativeChatProjectKey } from '@/utils/workspaceTools';
import { ChatPanelBody } from './ChatPanelBody';

// The workspace chat is the native It's a Plan transcript and composer, backed by the
// external OpenClaw runner. Home stores its threads in one configured anchor project,
// while a project route keeps conversations in that project. The desired coordinator
// is put first without hiding the other project agents from the selector.
export default function NativeChatWorkspace({ projectKey }: WorkspaceContentProps) {
  const config = runtimeEnv().workspace;
  const chatProjectKey = nativeChatProjectKey(config, projectKey);
  const project = useProjectQuery(chatProjectKey);
  const provisioning = useProjectProvisioningQuery(chatProjectKey);
  const resources =
    provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [];
  const agentsQuery = useAiAgentsQuery(
    project.data?.project.teamId ?? null,
    project.data?.project.id,
  );
  const desiredUsername = coordinatorUsername(config, projectKey, resources);
  const agents = useMemo(() => {
    const available = agentsQuery.data ?? [];
    const desired = available.find((agent) => agent.username === desiredUsername);
    return desired ? [desired, ...available.filter((agent) => agent.id !== desired.id)] : available;
  }, [agentsQuery.data, desiredUsername]);

  if (!chatProjectKey) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Home chat is not configured.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatPanelBody
        projectKey={chatProjectKey}
        newChatAgentId={null}
        onNewChatHandled={() => undefined}
        agents={agents}
        agentsLoading={project.isLoading || provisioning.isLoading || agentsQuery.isLoading}
      />
    </div>
  );
}
